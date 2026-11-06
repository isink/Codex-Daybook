const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const YAML=require('yaml');
const {dateParts,safeTitle,parseNote,ensureFolder,ensureDaily,attachmentKey}=require('./core');
const {prepareAttachments}=require('./attachments');
const {routing,vaultPath}=require('./settings');

const START='<!-- workbuddy-sync:start -->';
const END='<!-- workbuddy-sync:end -->';
const SESSION_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES=64*1024*1024;
class StateWriteError extends Error {}

const ATTACHMENT_FOLDER='Attachments/WorkBuddy';
function defaults(){return {enabled:false,consent:false,sourceFolder:'',noteFolder:'WorkBuddy Conversations',attachmentFolder:ATTACHMENT_FOLDER,sessions:{}};}
function validate(config){
  if(!config||typeof config!=='object'||typeof config.enabled!=='boolean'||typeof config.consent!=='boolean'||!config.sessions||typeof config.sessions!=='object'||Array.isArray(config.sessions))throw Error('Invalid WorkBuddy sync settings.');
  if(typeof config.sourceFolder!=='string'||/[\r\n\0]/.test(config.sourceFolder)||config.sourceFolder&&!path.isAbsolute(config.sourceFolder))throw Error('WorkBuddy data folder must be an absolute path.');
  const noteFolder=vaultPath(config.noteFolder);
  // Settings saved before images were imported have no attachment folder yet.
  const attachmentFolder=vaultPath(config.attachmentFolder||ATTACHMENT_FOLDER);
  for(const [id,record] of Object.entries(config.sessions)){
    if(!SESSION_ID.test(id)||!record||typeof record!=='object'||Array.isArray(record))throw Error('Invalid WorkBuddy session mapping.');
    if(record.notePath)vaultPath(record.notePath);
    if(record.route?.noteFolder)vaultPath(record.route.noteFolder);
    if(record.attachmentDir)vaultPath(record.attachmentDir);
  }
  return {...config,noteFolder,attachmentFolder};
}
function sourceFolder(config=defaults()){return config.sourceFolder||path.join(os.homedir(),'.workbuddy','projects');}

function uniquePaths(values){
  const seen=new Set();
  return values.filter(value=>{
    if(typeof value!=='string'||!value.trim())return false;
    const normalized=path.resolve(value.trim());
    const key=process.platform==='win32'?normalized.toLowerCase():normalized;
    if(seen.has(key))return false;
    seen.add(key);return true;
  }).map(value=>path.resolve(value.trim()));
}

/**
 * Known WorkBuddy conversation locations. WorkBuddy itself uses
 * WORKBUDDY_CONFIG_DIR when set and otherwise stores projects under the
 * current user's data folder. The additional app-data roots cover desktop
 * installs that relocate their data without making us crawl the whole disk.
 */
function sourceCandidates(config=defaults(),options={}){
  const home=options.home||os.homedir(),env=options.env||process.env;
  const roots=[env.WORKBUDDY_CONFIG_DIR,env.CODEBUDDY_CONFIG_DIR,env.CODEBUDDY_DATA_ROOT].filter(Boolean);
  const dataName=env.WORKBUDDY_DATA_FOLDER_NAME?.trim()||'.workbuddy';
  roots.push(path.join(home,dataName),path.join(home,'.workbuddy'),path.join(home,'.codebuddy'));
  if(env.APPDATA)roots.push(path.join(env.APPDATA,'WorkBuddy'),path.join(env.APPDATA,'.workbuddy'));
  if(env.LOCALAPPDATA)roots.push(path.join(env.LOCALAPPDATA,'WorkBuddy'),path.join(env.LOCALAPPDATA,'.workbuddy'));
  if((options.platform||process.platform)==='darwin')roots.push(path.join(home,'Library','Application Support','WorkBuddy'),path.join(home,'Library','Application Support','com.tencent.workbuddy.mac'));
  return uniquePaths([config.sourceFolder,...roots.flatMap(root=>[root,path.join(root,'projects')])]);
}

async function listFiles(root){
  let projects;
  try{projects=await fs.readdir(root,{withFileTypes:true});}
  catch(error){if(error.code==='ENOENT')throw Error('WorkBuddy local conversation folder was not found.');throw error;}
  const files=[];
  for(const project of projects){
    if(!project.isDirectory())continue;
    const directory=path.join(root,project.name);
    const entries=await fs.readdir(directory,{withFileTypes:true});
    for(const entry of entries){
      if(!entry.isFile()||!entry.name.endsWith('.jsonl'))continue;
      const id=entry.name.slice(0,-6);
      if(SESSION_ID.test(id))files.push({id,path:path.join(directory,entry.name)});
    }
  }
  return files;
}

// WorkBuddy 5.7 follows an attached image with an input_text that only carries
// the image's local path for the model; it is not part of what the user typed.
const IMAGE_PATH_ONLY=/^\s*<image_local_path>[^<>]*<\/image_local_path>\s*$/;
// The question refers to attached images as @image#1:"name.png".
const IMAGE_MENTION=/@image#\d+:"([^"\r\n]*)"/g;
const attachmentNote=name=>`（附件未导入：${String(name).replace(/[<>\r\n]/g,'')}）`;
const BLOB_NAME=/^[0-9a-f]{16,128}\.(png|jpe?g|gif|webp)$/i;
/**
 * WorkBuddy's own copy of an attached image, or null. Only a file named after its
 * blob ID inside a `blobs/<prefix>/` folder is accepted, so a message can never make
 * the plugin read some other file on the computer.
 */
function blobPath(part){
  const file=part?.blob_path;
  if(typeof file!=='string'||!path.isAbsolute(file)||typeof part.blob_id!=='string')return null;
  const name=path.basename(file),prefix=path.dirname(file);
  if(!BLOB_NAME.test(name)||!name.startsWith(part.blob_id+'.')||path.basename(path.dirname(prefix))!=='blobs'||!part.blob_id.startsWith(path.basename(prefix)))return null;
  return path.normalize(file)===file?file:null;
}
/** The images a user message attached, in order, with the placeholder text that stands for each. */
function userImages(parts){
  if(!Array.isArray(parts))return [];
  return parts.filter(part=>part?.type==='image_blob_ref').map((part,index)=>({index,path:blobPath(part),placeholder:attachmentNote(part.original_filename||'image_blob_ref')}));
}
function userText(parts){
  if(!Array.isArray(parts))throw Error('WorkBuddy user message format changed.');
  const raw=parts.filter(part=>part?.type==='input_text'&&typeof part.text==='string'&&!IMAGE_PATH_ONLY.test(part.text)).map(part=>part.text).join('\n');
  // WorkBuddy 5.6.2 prepends private app context to the input_text. Only the
  // final user_query element is shown in its UI. Never publish the envelope.
  const matches=[...raw.matchAll(/<user_query>([\s\S]*?)<\/user_query>/g)];
  if(matches.length!==1||!/^\s*$/.test(raw.slice(matches[0].index+matches[0][0].length)))throw Error('WorkBuddy user-message envelope changed; import stopped.');
  const mentioned=new Set();
  const value=matches[0][1].replace(IMAGE_MENTION,(_,name)=>{mentioned.add(name);return attachmentNote(name||'图片');}).trim();
  if(!value)throw Error('WorkBuddy user message is empty.');
  // Images already named in the question are not listed a second time.
  const extras=parts.filter(part=>part?.type!=='input_text'&&!(part?.type==='image_blob_ref'&&mentioned.has(part.original_filename)))
    .map(part=>attachmentNote(part?.type==='image_blob_ref'&&part.original_filename?part.original_filename:part?.type||'未知类型'));
  return [value,...extras].join('\n\n');
}
function assistantText(parts){
  if(!Array.isArray(parts))throw Error('WorkBuddy assistant message format changed.');
  return parts.filter(part=>part?.type==='output_text'&&typeof part.text==='string').map(part=>part.text).join('\n\n').trim();
}
function parseConversation(source,id){
  if(!SESSION_ID.test(id))throw Error('Invalid WorkBuddy session ID.');
  const messages=new Map();let title='';
  for(const line of source.split(/\r?\n/)){
    if(!line.trim())continue;
    let event;try{event=JSON.parse(line);}catch{throw Error('WorkBuddy conversation file is incomplete or invalid.');}
    if(!event||typeof event!=='object')throw Error('WorkBuddy conversation event is invalid.');
    if(event.sessionId&&event.sessionId!==id)throw Error('WorkBuddy conversation ID does not match its file.');
    if(event.type==='ai-title'&&typeof event.aiTitle==='string'&&event.aiTitle.trim())title=event.aiTitle.trim();
    if(event.type!=='message')continue;
    if(!['user','assistant'].includes(event.role))continue;
    if(typeof event.id!=='string'||!Number.isFinite(event.timestamp))throw Error('WorkBuddy message ID or time is invalid.');
    // Some event logs update a message under the same ID. Keep its final form
    // in the original order so progress snapshots do not become extra turns.
    messages.set(event.id,event);
  }
  const pairs=[];let pending=null;
  const flush=()=>{if(pending?.answer)pairs.push(pending);pending=null;};
  for(const event of messages.values()){
    if(event.role==='user'){
      flush();
      pending={id:event.id,question:userText(event.content),askedAt:event.timestamp,images:userImages(event.content)};
    }else if(pending&&event.status==='completed'){
      const answer=assistantText(event.content);
      if(answer){pending.answer=answer;pending.answeredAt=event.timestamp;}
    }
  }
  flush();
  const first=[...messages.values()].find(event=>event.role==='user');
  if(!first)return {id,title,pairs:[],createdAt:null};
  // A question that starts with an image is titled by the image's file name.
  const fallback=userText(first.content).replace(/（附件未导入：([^）]*)）/g,'$1').split('\n')[0].trim();
  return {id,title:title||fallback.slice(0,80),pairs,createdAt:first.timestamp/1000};
}

/** Key of a question's image in the attachment mapping. */
const imageKey=(pair,image)=>attachmentKey(pair.id,{id:'workbuddy'},image.index);
/** The question with each copied image shown in place of its placeholder. */
function questionWithImages(pair,images){
  let text=pair.question;
  for(const image of pair.images||[]){
    const asset=images[imageKey(pair,image)];
    if(typeof asset==='string')text=text.replace(image.placeholder,`![[${asset}]]`);
  }
  return text;
}
function renderTranscript(conversation,timeZone,images={}){
  const safe=value=>String(value).replaceAll('<!-- workbuddy-sync:','&lt;!-- workbuddy-sync:');
  const stamp=ms=>{const d=dateParts(ms/1000,timeZone);return `${d.day} ${d.time}`;};
  return conversation.pairs.map(pair=>[
    `> [!workbuddy-question] 我 · ${stamp(pair.askedAt)}\n${safe(questionWithImages(pair,images)).split('\n').map(line=>`> ${line}`).join('\n')}`,
    `> [!workbuddy-answer] WorkBuddy · ${stamp(pair.answeredAt)}\n\n${safe(pair.answer)}`
  ].join('\n\n')).join('\n\n');
}
function noteId(source){try{return parseNote(source).doc.get('workbuddy_session_id');}catch{return null;}}
async function findNote(vault,id,notePath){
  const file=notePath&&vault.getAbstractFileByPath(notePath);
  if(file&&noteId(await vault.read(file))!==id)throw Error('WorkBuddy note ID changed; update stopped.');
  if(file)return file;
  const matches=[];
  for(const candidate of vault.getMarkdownFiles())if(noteId(await vault.read(candidate))===id)matches.push(candidate);
  if(matches.length>1)throw Error('More than one note belongs to this WorkBuddy conversation.');
  return matches[0]||null;
}
function metadata(conversation,route,now){
  const created=dateParts(conversation.createdAt,route.timeZone);
  return {title:conversation.title,type:'workbuddy-conversation',source:'workbuddy',workbuddy_session_id:conversation.id,created_at:created.iso,captured_at:created.time,...(route.dailyTrackEnabled?{daily:`[[${route.dailyFolder}/${route.day}]]`}:{}),workbuddy_synced_at:dateParts(now/1000,route.timeZone).iso};
}
function newNote(conversation,transcript,route,now){
  return `---\n${YAML.stringify({...metadata(conversation,route,now),cssclasses:['workbuddy-conversation']})}---\n\n${START}\n${transcript}\n${END}\n`;
}
function updateNote(text,conversation,transcript,route,now){
  const {doc,body}=parseNote(text);
  if(doc.get('workbuddy_session_id')!==conversation.id)throw Error('WorkBuddy note belongs to another conversation.');
  const start=body.indexOf(START),end=body.indexOf(END);
  if(start<0||end<start||body.indexOf(START,start+START.length)>=0||body.indexOf(END,end+END.length)>=0)throw Error('WorkBuddy note sync markers are invalid.');
  const block=`${START}\n${transcript}\n${END}`;
  const fields=metadata(conversation,route,now);
  for(const key of ['daily','created_at','captured_at'])if(doc.has(key))fields[key]=doc.get(key);
  const existing=doc.toJS().cssclasses;
  const classes=Array.isArray(existing)?existing:(typeof existing==='string'?existing.split(/[\s,]+/).filter(Boolean):[]);
  const hasClass=classes.includes('workbuddy-conversation');
  const same=hasClass&&body.slice(start,end+END.length)===block&&Object.entries(fields).filter(([key])=>key!=='workbuddy_synced_at').every(([key,value])=>doc.get(key)===value);
  if(same)return text;
  for(const [key,value] of Object.entries(fields))doc.set(key,value);
  if(!hasClass)doc.set('cssclasses',[...classes,'workbuddy-conversation']);
  return `---\n${doc.toString()}---\n${body.slice(0,start)}${block}${body.slice(end+END.length)}`;
}
/** File name (without .md) a new note gets; also names its image folder. */
function noteName(conversation){return `${safeTitle(conversation.title)} (wb-${conversation.id.slice(-8)})`;}

/**
 * Copies the images of completed turns into the vault with the same rules as Codex
 * images: content-hashed names, kept across syncs, never re-read once copied.
 */
async function copyImages(vault,conversation,record,attachmentFolder,alive){
  const content=new Map();
  for(const pair of conversation.pairs)for(const image of pair.images||[]){
    if(!content.has(pair.id))content.set(pair.id,[]);
    content.get(pair.id)[image.index]={type:'localImage',path:image.path||`missing:${pair.id}/${image.index}`};
  }
  if(!content.size)return {images:{},mapping:record.images||{},dir:record.attachmentDir};
  const dir=record.attachmentDir||`${attachmentFolder}/${record.notePath?record.notePath.split('/').pop().replace(/\.md$/,''):noteName(conversation)}`;
  const snapshot={
    thread:{id:conversation.id},
    turns:[...content.keys()].map(id=>({id,status:'completed'})),
    entries:[...content].map(([turnId,parts])=>({turnId,item:{type:'userMessage',id:'workbuddy',content:Array.from(parts,part=>part||{type:'none'})}})),
  };
  const prepared=await prepareAttachments(vault,snapshot,record.images||{},{alive,folder:dir});
  return {images:prepared.images,mapping:prepared.mapping,dir};
}

async function writeNote(vault,conversation,route,notePath,now,alive=()=>true,images={}){
  if(!conversation.pairs.length)return {notePath,changed:false};
  const check=()=>{if(!alive())throw Error('Plugin stopped.');};
  const transcript=renderTranscript(conversation,route.timeZone,images);
  let file=await findNote(vault,conversation.id,notePath);
  let next,previous,target;
  if(file){previous=await vault.read(file);next=updateNote(previous,conversation,transcript,route,now);target=file.path;}
  else{
    target=`${route.noteFolder}/${noteName(conversation)}.md`;
    if(vault.getAbstractFileByPath(target))throw Error('WorkBuddy note path is occupied.');
    next=newNote(conversation,transcript,route,now);
  }
  check();
  if(route.dailyTrackEnabled){
    const oldDaily=previous&&/^\[\[(.+)\/(\d{4}-\d{2}-\d{2})\]\]$/.exec(parseNote(previous).doc.get('daily')||'');
    await ensureDaily(vault,oldDaily?.[2]||route.day,oldDaily?{...route,dailyFolder:oldDaily[1]}:route);
  }
  check();
  if(file&&next!==previous)await vault.process(file,current=>{check();return updateNote(current,conversation,transcript,route,now);});
  else if(!file){
    await ensureFolder(vault,route.noteFolder);
    const stage=`WorkBuddy 同步暂存 ${conversation.id} ${now}.tmp`;
    const staged=await vault.create(stage,next);
    check();await vault.rename(staged,target);
    await vault.process(staged,current=>{check();return updateNote(current,conversation,transcript,route,now)+'\n';});
  }
  return {notePath:target,changed:!file||next!==previous};
}

async function readConversation(file){
  const stat=await fs.stat(file.path);
  if(!stat.isFile()||stat.size>MAX_BYTES)throw Error('WorkBuddy conversation is too large or not a file.');
  const source=await fs.readFile(file.path,'utf8');
  return {conversation:parseConversation(source,file.id),size:stat.size,mtimeMs:stat.mtimeMs};
}
async function checkSource(config=defaults()){
  const checked=validate(config);
  if(!checked.consent)throw Error('Allow local WorkBuddy access first.');
  const files=await listFiles(sourceFolder(checked));
  for(const file of files){
    try{const {conversation}=await readConversation(file);if(conversation.pairs.length)return {files:files.length,sampleId:file.id,pairs:conversation.pairs.length};}catch{/* Another session may be in progress. */}
  }
  throw Error('No compatible completed local WorkBuddy conversation was found.');
}
async function scanSources(config=defaults(),options={}){
  const checked=validate(config);
  if(!checked.consent)throw Error('Allow local WorkBuddy access first.');
  let sawFiles=false;
  for(const root of sourceCandidates(checked,options)){
    let files;
    try{files=await listFiles(root);}catch(error){
      if(error.message==='WorkBuddy local conversation folder was not found.'||['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code))continue;
      throw error;
    }
    if(!files.length)continue;
    sawFiles=true;
    for(const file of files){
      try{
        const {conversation}=await readConversation(file);
        if(conversation.pairs.length)return {folder:root,files:files.length,sampleId:file.id,pairs:conversation.pairs.length};
      }catch{/* Another session may be in progress or use an unsupported format. */}
    }
  }
  if(sawFiles)throw Error('WorkBuddy data was found, but no compatible completed local conversation could be verified. Check the WorkBuddy version or finish a local task.');
  throw Error('No WorkBuddy data folder was found in the standard locations. Create or complete a local WorkBuddy task, or enter the folder manually.');
}
async function syncBatch({vault,state,persist,alive=()=>true,now=Date.now}){
  const config=validate(state.workbuddy||defaults());
  if(!config.enabled||!config.consent)throw Error('WorkBuddy sync is not enabled.');
  const files=await listFiles(sourceFolder(config));
  let current=state;const report={found:files.length,changed:0,errors:[]};
  const save=async next=>{try{await persist(next);}catch(error){throw new StateWriteError('Could not save WorkBuddy sync state.',{cause:error});}current=next;};
  for(const file of files){
    if(!alive())throw Error('Plugin stopped.');
    const record=current.workbuddy.sessions[file.id]||{};
    try{
      const stat=await fs.stat(file.path);
      if(record.size===stat.size&&record.mtimeMs===stat.mtimeMs&&record.notePath&&vault.getAbstractFileByPath(record.notePath))continue;
      if(record.size===stat.size&&record.mtimeMs===stat.mtimeMs&&record.notePath&&!vault.getAbstractFileByPath(record.notePath)){
        const moved=await findNote(vault,file.id,record.notePath);
        if(moved)await save({...current,workbuddy:{...current.workbuddy,sessions:{...current.workbuddy.sessions,[file.id]:{...record,notePath:moved.path}}}});
        continue; // User-deleted notes stay deleted until the source changes.
      }
      const {conversation,size,mtimeMs}=await readConversation(file);
      if(!conversation.pairs.length)continue;
      const route=record.route||{...routing(current.settings,{createdAt:conversation.createdAt}),noteFolder:current.workbuddy.noteFolder};
      const fingerprint=crypto.createHash('sha256').update(JSON.stringify([conversation.title,conversation.pairs])).digest('hex');
      const copied=await copyImages(vault,conversation,record,current.workbuddy.attachmentFolder||ATTACHMENT_FOLDER,alive);
      const result=await writeNote(vault,conversation,route,record.notePath,now(),alive,copied.images);
      if(!alive())throw Error('Plugin stopped.');
      const nextRecord={...record,name:conversation.title,notePath:result.notePath,route,fingerprint,size,mtimeMs,...(copied.dir?{attachmentDir:copied.dir,images:copied.mapping}:{})};
      const next={...current,workbuddy:{...current.workbuddy,sessions:{...current.workbuddy.sessions,[file.id]:nextRecord}}};
      await save(next);
      if(result.changed)report.changed++;
    }catch(error){if(error instanceof StateWriteError)throw error;report.errors.push({id:file.id,message:error.message});}
  }
  return {state:current,report};
}
module.exports={START,END,defaults,validate,sourceFolder,sourceCandidates,listFiles,userText,userImages,blobPath,copyImages,assistantText,parseConversation,renderTranscript,noteId,newNote,updateNote,writeNote,readConversation,checkSource,scanSources,syncBatch};
