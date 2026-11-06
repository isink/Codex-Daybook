require('./setup');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const wb=require('../src/workbuddy');
const {defaults:codexDefaults}=require('../src/settings');
const {parseNote}=require('../src/core');

const ID=['123e4567','e89b','42d3','a456','426614174000'].join('-');
const SECOND=['123e4567','e89b','42d3','a456','426614174001'].join('-');
const start=1790766807301;
const event=(type,fields={})=>({type,sessionId:ID,...fields});
const user=(id,text,at)=>event('message',{id,role:'user',timestamp:at,content:[{type:'input_text',text:`<system-reminder>PRIVATE_CONTEXT</system-reminder>\n<user_query>${text}</user_query>`}]});
const answer=(id,text,at,status='completed')=>event('message',{id,role:'assistant',status,timestamp:at,content:[{type:'output_text',text}]});
const jsonl=events=>events.map(x=>JSON.stringify(x)).join('\n')+'\n';
const route={timeZone:'Asia/Shanghai',noteFolder:'WorkBuddy Conversations',dailyFolder:'Daily',day:'2026-09-30',dailyTrackEnabled:false};

test('imports only visible user queries and completed replies, excluding reasoning, tools and the pending turn',()=>{
  const source=jsonl([
    user('u1','visible question',start),
    event('reasoning',{content:[{type:'text',text:'HIDDEN_REASONING'}]}),
    event('tool-use',{content:'HIDDEN_TOOL'}),
    answer('a1','finished answer',start+1000),
    user('u2','unfinished question',start+2000),
    answer('a2','UNFINISHED_ANSWER',start+3000,'working')
  ]);
  const conversation=wb.parseConversation(source,ID);
  assert.equal(conversation.pairs.length,1);
  assert.equal(conversation.pairs[0].question,'visible question');
  assert.equal(conversation.pairs[0].answer,'finished answer');
  const rendered=wb.renderTranscript(conversation,'Asia/Shanghai');
  for(const hidden of ['PRIVATE_CONTEXT','HIDDEN_REASONING','HIDDEN_TOOL','unfinished question','UNFINISHED_ANSWER'])assert.ok(!rendered.includes(hidden));
  assert.match(rendered,/finished answer/);
});

test('an unfamiliar user envelope or a mismatched session fails closed',()=>{
  assert.throws(()=>wb.userText([{type:'input_text',text:'<system-reminder>SECRET</system-reminder>user text'}]),/envelope changed/);
  assert.throws(()=>wb.parseConversation(jsonl([user('u1','visible',start),answer('a1','done',start+1),event('message',{sessionId:SECOND,id:'u2',role:'user',timestamp:start+2,content:[]})]),ID),/does not match/);
  assert.throws(()=>wb.parseConversation('{bad json}',ID),/incomplete or invalid/);
});

test('WorkBuddy 5.7 image messages import, with the image named instead of its private path',()=>{
  const blob={type:'image_blob_ref',blob_id:'abc',mime:'image/jpeg',size:1,blob_path:'/home/me/.workbuddy/blobs/ab/abc.jpg',original_filename:'Screenshot 1.png'};
  const parts=[
    {type:'input_text',text:'<system-reminder>PRIVATE_CONTEXT</system-reminder>\n<user_query>看看这张 @image#1:"Screenshot 1.png"</user_query>'},
    blob,
    {type:'input_text',text:'<image_local_path>/home/me/.workbuddy/clipboard-images/c.jpg</image_local_path>'},
  ];
  const text=wb.userText(parts);
  assert.equal(text,'看看这张 （附件未导入：Screenshot 1.png）');
  for(const hidden of ['PRIVATE_CONTEXT','clipboard-images','blobs'])assert.ok(!text.includes(hidden));
  // An image the question does not mention is still listed once.
  const unmentioned=wb.userText([{type:'input_text',text:'<user_query>看图</user_query>'},blob]);
  assert.equal(unmentioned,'看图\n\n（附件未导入：Screenshot 1.png）');
  // Text after the query that is not just an image path still stops the import.
  assert.throws(()=>wb.userText([parts[0],{type:'input_text',text:'<image_local_path>/a.jpg</image_local_path> extra'}]),/envelope changed/);
});

test('updating a note preserves custom metadata and personal text, and refuses a foreign ID',()=>{
  const conversation={id:ID,title:'Test task',createdAt:start/1000,pairs:[{id:'u1',question:'hello',answer:'answer',askedAt:start,answeredAt:start+1000}]};
  const transcript=wb.renderTranscript(conversation,route.timeZone);
  const original=wb.newNote(conversation,transcript,route,start+2000).replace('type: workbuddy-conversation','type: workbuddy-conversation\nreview_status: important')+'\nMy own follow-up\n';
  const updated=wb.updateNote(original,{...conversation,title:'Renamed task'},transcript+'\n\nNew answer',route,start+3000);
  assert.equal(parseNote(updated).doc.get('review_status'),'important');
  assert.ok(updated.endsWith('My own follow-up\n'));
  assert.match(updated,/New answer/);
  assert.ok(!updated.includes('PRIVATE_CONTEXT'));
  assert.equal(wb.updateNote(updated,{...conversation,title:'Renamed task'},transcript+'\n\nNew answer',route,start+4000),updated);
  assert.throws(()=>wb.updateNote(original,{...conversation,id:SECOND},transcript,route,start+3000),/another conversation/);
});

function vault(){
  const files=new Map();
  return {files,
    getAbstractFileByPath:p=>files.get(p)||null,
    getMarkdownFiles:()=>[...files.values()].filter(f=>f.path.endsWith('.md')),
    createFolder:async p=>{files.set(p,{path:p,children:[]});},
    create:async(p,text)=>{assert.ok(!files.has(p));const file={path:p,text};files.set(p,file);return file;},
    read:async file=>file.text,
    process:async(file,change)=>{file.text=change(file.text);return file.text;},
    rename:async(file,p)=>{files.delete(file.path);file.path=p;files.set(p,file);},
    createBinary:async(p,bytes)=>{const file={path:p,bytes:Buffer.from(bytes)};files.set(p,file);return file;}
  };
}
test('local source sync is idempotent, preserves edits and keeps its last copy when the source becomes invalid',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'daybook-workbuddy-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const project=path.join(root,'a-project');await fs.mkdir(project);
  const source=path.join(project,ID+'.jsonl');
  await fs.writeFile(source,jsonl([user('u1','first question',start),answer('a1','first answer',start+1000)]));
  const store=vault();let state={settings:{...codexDefaults(),dailyTrackEnabled:false,timeZone:'Asia/Shanghai'},workbuddy:{...wb.defaults(),consent:true,enabled:true,sourceFolder:root}};
  const persist=async next=>{state=JSON.parse(JSON.stringify(next));};
  const run=()=>wb.syncBatch({vault:store,state,persist,now:()=>start+3000});
  const first=await run();assert.equal(first.report.changed,1);
  const record=state.workbuddy.sessions[ID];assert.ok(record.notePath.endsWith('.md'));
  const note=store.getAbstractFileByPath(record.notePath);
  assert.match(note.text,/first question/);assert.match(note.text,/first answer/);assert.ok(!note.text.includes('PRIVATE_CONTEXT'));
  assert.equal((await run()).report.changed,0);
  note.text+='\nPersonal note\n';
  await fs.writeFile(source,jsonl([user('u1','first question',start),answer('a1','first answer',start+1000),user('u2','second question',start+2000),answer('a2','second answer',start+3000)]));
  assert.equal((await run()).report.changed,1);
  assert.match(note.text,/second answer/);assert.ok(note.text.endsWith('Personal note\n'));
  assert.equal([...store.files.values()].filter(f=>f.path.endsWith('.md')).length,1);
  const preserved=note.text;
  await fs.writeFile(source,jsonl([event('message',{id:'u3',role:'user',timestamp:start+4000,content:[{type:'input_text',text:'<system-reminder>SECRET</system-reminder>oops'}]})]));
  assert.equal((await run()).report.errors.length,1);
  assert.equal(note.text,preserved);
});

test('access consent is required and a failed state write stops the batch',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'daybook-workbuddy-state-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const project=path.join(root,'a-project');await fs.mkdir(project);
  for(const id of [ID,SECOND]){
    const source=jsonl([user('u1','visible question',start),answer('a1','visible answer',start+1000)].map(e=>({...e,sessionId:id})));
    await fs.writeFile(path.join(project,id+'.jsonl'),source);
  }
  const store=vault();
  const state={settings:{...codexDefaults(),dailyTrackEnabled:false,timeZone:'Asia/Shanghai'},workbuddy:{...wb.defaults(),enabled:true,sourceFolder:root}};
  await assert.rejects(wb.syncBatch({vault:store,state,persist:async()=>{}}),/not enabled/);
  assert.equal(store.files.size,0);
  state.workbuddy.consent=true;
  let writes=0;
  await assert.rejects(wb.syncBatch({vault:store,state,persist:async()=>{writes++;throw Error('disk full');},now:()=>start+3000}),/Could not save WorkBuddy sync state/);
  assert.equal(writes,1);
  assert.equal([...store.files.values()].filter(f=>f.path.endsWith('.md')).length,1);
});

test('only a blob-named file inside a blobs folder is accepted as an image source',()=>{
  const id='2bab4f92bc6483df';
  const ok={type:'image_blob_ref',blob_id:id,blob_path:`/home/me/.workbuddy/blobs/2b/${id}.jpg`};
  assert.equal(wb.blobPath(ok),ok.blob_path);
  for(const bad of [
    {...ok,blob_path:'/home/me/.ssh/id_rsa'},
    {...ok,blob_path:`/home/me/.workbuddy/blobs/2b/../../../.ssh/${id}.jpg`},
    {...ok,blob_path:`/home/me/.workbuddy/other/2b/${id}.jpg`},
    {...ok,blob_path:`/home/me/.workbuddy/blobs/zz/${id}.jpg`},
    {...ok,blob_path:`.workbuddy/blobs/2b/${id}.jpg`},
    {...ok,blob_path:`/home/me/.workbuddy/blobs/2b/${id}.txt`},
  ])assert.equal(wb.blobPath(bad),null,bad.blob_path);
});

test('attached images are copied into the vault once and shown in the question',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'daybook-workbuddy-images-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const project=path.join(root,'projects','a-project');await fs.mkdir(project,{recursive:true});
  const blobId='2bab4f92bc6483df75a1';
  const blobDir=path.join(root,'blobs','2b');await fs.mkdir(blobDir,{recursive:true});
  const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  await fs.writeFile(path.join(blobDir,blobId+'.png'),png);
  const imageMessage=(id,blobPath,at)=>event('message',{id,role:'user',timestamp:at,content:[
    {type:'input_text',text:'<system-reminder>PRIVATE_CONTEXT</system-reminder>\n<user_query>看看 @image#1:"Shot.png"</user_query>'},
    {type:'image_blob_ref',blob_id:blobId,mime:'image/png',size:png.length,blob_path:blobPath,original_filename:'Shot.png'},
    {type:'input_text',text:'<image_local_path>/tmp/clipboard.png</image_local_path>'},
  ]});
  const source=path.join(project,ID+'.jsonl');
  await fs.writeFile(source,jsonl([imageMessage('u1',path.join(blobDir,blobId+'.png'),start),answer('a1','这是一张截图',start+1000)]));
  const store=vault();
  let state={settings:{...codexDefaults(),dailyTrackEnabled:false,timeZone:'Asia/Shanghai'},workbuddy:{...wb.defaults(),consent:true,enabled:true,sourceFolder:path.join(root,'projects')}};
  const persist=async next=>{state=JSON.parse(JSON.stringify(next));};
  const run=()=>wb.syncBatch({vault:store,state,persist,now:()=>start+3000});
  const first=await run();
  assert.deepEqual(first.report.errors,[]);
  const record=state.workbuddy.sessions[ID];
  const noteName=record.notePath.split('/').pop().replace(/\.md$/,'');
  assert.equal(record.attachmentDir,`Attachments/WorkBuddy/${noteName}`);
  const images=[...store.files.values()].filter(f=>f.bytes);
  assert.equal(images.length,1);
  assert.match(images[0].path,new RegExp(`^Attachments/WorkBuddy/.+/[a-f0-9]{64}\\.png$`));
  const note=store.getAbstractFileByPath(record.notePath);
  assert.ok(note.text.includes(`> 看看 ![[${images[0].path}]]`));
  for(const hidden of ['附件未导入','clipboard','blobs','PRIVATE_CONTEXT'])assert.ok(!note.text.includes(hidden),hidden);

  // A later turn re-syncs the note without copying the image again.
  await fs.writeFile(source,jsonl([imageMessage('u1',path.join(blobDir,blobId+'.png'),start),answer('a1','这是一张截图',start+1000),user('u2','再问一句',start+2000),answer('a2','好的',start+2500)]));
  await fs.rm(path.join(blobDir,blobId+'.png'));
  assert.equal((await run()).report.changed,1);
  assert.equal([...store.files.values()].filter(f=>f.bytes).length,1);
  assert.ok(note.text.includes(`![[${images[0].path}]]`),'a copied image survives its original being removed');
  assert.match(note.text,/好的/);
});

test('an image whose original is gone or outside the blob store keeps its placeholder',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'daybook-workbuddy-noimage-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const project=path.join(root,'a-project');await fs.mkdir(project);
  const message=event('message',{id:'u1',role:'user',timestamp:start,content:[
    {type:'input_text',text:'<user_query>看 @image#1:"Gone.png"</user_query>'},
    {type:'image_blob_ref',blob_id:'aaaabbbbccccdddd',blob_path:'/nowhere/blobs/aa/aaaabbbbccccdddd.png',original_filename:'Gone.png'},
  ]});
  await fs.writeFile(path.join(project,ID+'.jsonl'),jsonl([message,answer('a1','看不到图',start+1000)]));
  const store=vault();
  let state={settings:{...codexDefaults(),dailyTrackEnabled:false,timeZone:'Asia/Shanghai'},workbuddy:{...wb.defaults(),consent:true,enabled:true,sourceFolder:root}};
  const result=await wb.syncBatch({vault:store,state,persist:async next=>{state=next;},now:()=>start+3000});
  assert.deepEqual(result.report.errors,[]);
  const note=store.getAbstractFileByPath(state.workbuddy.sessions[ID].notePath);
  assert.match(note.text,/> 看 （附件未导入：Gone\.png）/);
  assert.equal([...store.files.values()].filter(f=>f.bytes).length,0);
});

test('settings saved before images were supported get the default images folder',()=>{
  const {attachmentFolder,...old}=wb.defaults();
  assert.equal(attachmentFolder,'Attachments/WorkBuddy');
  assert.equal(wb.validate(old).attachmentFolder,'Attachments/WorkBuddy');
  assert.throws(()=>wb.validate({...old,attachmentFolder:'../outside'}));
});
