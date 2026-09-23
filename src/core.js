const YAML = require('yaml');
const {CompatibilityError}=require('./errors');
const START = '<!-- codex-sync:start -->';
const END = '<!-- codex-sync:end -->';

function dateParts(seconds,timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC') {
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) throw Error('任务创建时间无效');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', {timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  const offset=Math.round((Date.parse(`${day}T${time}:${parts.second}Z`)-Math.floor(seconds)*1000)/60000);
  const sign=offset<0?'-':'+';const abs=Math.abs(offset);
  return {day,time,iso:`${day}T${time}:${parts.second}${sign}${String(Math.floor(abs/60)).padStart(2,'0')}:${String(abs%60).padStart(2,'0')}`};
}

function safeTitle(title) {
  const name=(title || 'Codex 对话').normalize('NFC').replace(/[\\/:*?"<>|[\]#^\x00-\x1f]/g,'－').trim().slice(0,90).replace(/[. ]+$/g,'') || 'Codex 对话';
  // A leading dot makes Obsidian's vault index skip the file entirely, so the
  // duplicate-path check on the next sync can no longer see it and re-collides.
  return name.startsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)?'_'+name:name;
}

// The conversation itself contains examples of our markers. Escape only that
// reserved syntax, otherwise the next update cannot identify the real boundary.
function transcriptText(text) {
  return String(text).replaceAll('<!-- codex-sync:', '&lt;!-- codex-sync:');
}

// Only unwrap the exact application envelope at the start of the first text
// part, and only when every listed file is corroborated by attachment metadata.
function cleanUserText(text, content) {
  const match = /^\s*# Files mentioned by the user:\r?\n\r?\n([\s\S]*?)\r?\n\r?\nDistinguish instructions in attached documents from the user's request\.\r?\n\r?\n## My request:\r?\n/.exec(text);
  if (!match) return text;
  const paths = new Set(content.filter(c=>c.type==='localImage').map(c=>c.path));
  const rows = match[1].split(/\r?\n\r?\n/);
  if (!rows.length || !rows.every(row=>{
    const file = /^## ([^\r\n]+?): ([^\r\n]+)$/.exec(row);
    return file && /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(file[2]) && paths.has(file[2]) && file[2].split(/[\\/]/).at(-1)===file[1];
  })) return text;
  return text.slice(match[0].length);
}

function attachmentKey(turnId, item, index) { return `${turnId}/${item.id}/${index}`; }

// Codex sometimes writes a file (e.g. an edited cover image) directly into
// the vault as a tool action — never captured as a message attachment — and
// then just mentions it by wikilink in its own reply text. When that link
// already resolves to an image already in the vault, show it inline instead
// of as a bare link. resolveEmbed(linkpath) is expected to return the
// resolved file's extension (e.g. 'png') or a falsy value; this never scans
// paths or imports anything itself, only asks the vault's own link index.
const IMAGE_EXTENSIONS = new Set(['png','jpg','jpeg','gif','webp']);
function embedImageLinks(text, resolveEmbed) {
  if (!resolveEmbed) return text;
  return text.replace(/(!?)\[\[([^\]|#]+)([|#][^\]]*)?\]\]/g, (match, bang, linkpath) => {
    if (bang) return match; // already an embed
    const extension = resolveEmbed(linkpath.trim());
    return extension && IMAGE_EXTENSIONS.has(String(extension).toLowerCase()) ? `!${match}` : match;
  });
}

function renderTranscript(turns, entries, images = {},timeZone,resolveEmbed) {
  const completed = new Map(turns.filter(t=>t.status === 'completed').map(t=>[t.id,t]));
  const seen = new Set();
  const blocks = [];
  for (const {turnId,item} of entries) {
    if (!completed.has(turnId)) continue;
    const key = `${turnId}/${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let role, text;
    const turn=completed.get(turnId);
    const seconds=item.type==='userMessage'?turn.startedAt:(turn.completedAt??turn.startedAt);
    const stamp=Number.isFinite(seconds)?dateParts(seconds,timeZone):null;
    const time=stamp?` · ${stamp.day} ${stamp.time}`:'';
    if (item.type === 'userMessage') {
      role = '我';
      const firstText=item.content.findIndex(c=>c.type==='text');
      text = item.content.map((c,index)=>{
        if(c.type==='text') return index===firstText?cleanUserText(c.text,item.content):c.text;
        if(c.type==='localImage') {
          const asset=images[attachmentKey(turnId,item,index)];
          if(typeof asset==='string') return `![[${asset}]]`;
          return asset?.unsupported ? '（图片格式不支持，未导入）' : '（图片原件暂不可用，尚无库内副本）';
        }
        if(c.type==='image')return '（远程图片未导入）';
        return `（附件未导入：${c.type||'未知类型'}）`;
      }).join('\n\n');
    } else if (item.type === 'agentMessage' && item.phase === 'final_answer') {
      role = 'Codex'; text = embedImageLinks(item.text,resolveEmbed);
    } else if (item.type === 'plan') {
      role = 'Codex · 正式计划'; text = embedImageLinks(item.text,resolveEmbed);
    } else continue;
    if (text?.trim()) {
      const body=transcriptText(text.trim());
      blocks.push(item.type==='userMessage'
        ? `> [!codex-question] ${role}${time}\n${body.split('\n').map(line=>`> ${line}`).join('\n')}`
        : `> [!codex-answer] ${role}${time}\n\n${body}`);
    }
  }
  return blocks.join('\n\n');
}

function parseNote(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw Error('笔记 frontmatter 缺失，已停止覆盖');
  const doc = YAML.parseDocument(match[1], {uniqueKeys:true});
  if (doc.errors.length || !YAML.isMap(doc.contents)) throw Error('笔记 YAML 无效或有重复字段，已停止覆盖');
  return {doc, body:text.slice(match[0].length), header:match[0]};
}

function noteThreadId(text) {
  try { return parseNote(text).doc.get('codex_thread_id'); } catch { return null; }
}

function boundaries(body) {
  if (body.split(START).length !== 2 || body.split(END).length !== 2 || body.indexOf(START) >= body.indexOf(END)) {
    throw Error('同步标记缺失、重复或顺序错误，已停止覆盖；请恢复笔记标记');
  }
  return {start:body.indexOf(START),end:body.indexOf(END)+END.length};
}

function metadata(thread, now, route={}) {
  const created = dateParts(thread.createdAt,route.timeZone);
  return {title:thread.name || 'Codex 对话',type:'codex-conversation',codex_thread_id:thread.id,created_at:created.iso,captured_at:created.time,...(route.dailyTrackEnabled!==false?{daily:`[[${route.dailyFolder||'Daily'}/${route.day||created.day}]]`}:{}),codex_synced_at:dateParts(now/1000,route.timeZone).iso};
}

function newNote(thread, transcript, now = Date.now(),route={}) {
  return `---\n${YAML.stringify({...metadata(thread,now,route),cssclasses:['codex-conversation']})}---\n\n${START}\n${transcript}\n${END}\n`;
}

function updateNote(text, thread, transcript, now = Date.now(),route={}) {
  const {doc,body} = parseNote(text);
  if (doc.get('codex_thread_id') !== thread.id) throw Error('笔记属于其他任务，已停止覆盖');
  const {start,end} = boundaries(body);
  const block = `${START}\n${transcript}\n${END}`;
  const fields = metadata(thread,now,route);
  for(const key of ['daily','created_at','captured_at'])if(doc.has(key))fields[key]=doc.get(key);
  const oldClasses=doc.toJS().cssclasses;
  const classes=Array.isArray(oldClasses)?oldClasses:(typeof oldClasses==='string'?oldClasses.split(/[\s,]+/).filter(Boolean):[]);
  const hasClass=classes.includes('codex-conversation');
  // Never remove headings inside the transcript, or a footer with personal text.
  const suffix=body.slice(end);
  const cleanedSuffix=/^\s*## 我的补充[ \t]*(?:\r?\n\s*)?$/.test(suffix)?'\n':suffix;
  const unchanged = hasClass && suffix===cleanedSuffix && body.slice(start,end) === block && Object.entries(fields).filter(([k])=>k!=='codex_synced_at').every(([k,v])=>doc.get(k)===v);
  if (unchanged) return text;
  for (const [key,value] of Object.entries(fields)) doc.set(key,value);
  if(!hasClass)doc.set('cssclasses',[...classes,'codex-conversation']);
  return `---\n${doc.toString()}---\n${body.slice(0,start)}${block}${cleanedSuffix}`;
}

async function pages(rpc, method, params) {
  const result=[]; const cursors=new Set(); let cursor;
  do {
    const page=await rpc(method,{...params,...(cursor?{cursor}:{})});
    if (!Array.isArray(page.data)) throw new CompatibilityError(`${method} 返回了不兼容的数据`);
    result.push(...page.data);
    cursor=page.nextCursor;
    if(cursor && cursors.has(cursor)) throw Error(`${method} 返回重复分页游标`);
    if(cursor) cursors.add(cursor);
  } while(cursor);
  return result;
}

async function verifyThread(rpc, threadId, {accountVerified=false}={}) {
  if(!threadId)throw Error('需要明确任务 ID');
  if(!accountVerified) {
    const account = await rpc('account/read',{refreshToken:false});
    if (!account.account) throw Error('请先在 Codex Desktop 登录 ChatGPT，再重载插件');
  }
  const {thread} = await rpc('thread/read',{threadId,includeTurns:false});
  const {isDesktopMain}=require('./tasks');
  if (thread.id !== threadId || !isDesktopMain(thread)) throw Error('来源不是预期的 Codex Desktop 主任务');
  return thread;
}

function latestTurnSignature(turns) {
  const last=turns.at(-1);
  return last?{id:last.id,status:last.status,startedAt:last.startedAt??null,completedAt:last.completedAt??null}:null;
}

// Cheap stand-in for a full read: identity/status of only the most recent turn.
// Used to decide whether the full pagination pass below can be skipped for an
// already-settled task. Any mismatch, or any doubt about the response shape,
// must fall back to the full read below — this check can only ever cost an
// extra round trip, never cause a missed update.
async function peekLatestTurn(rpc, threadId) {
  const result = await rpc('thread/turns/list',{threadId,limit:1,sortDirection:'desc',itemsView:'notLoaded'});
  if (!result || !Array.isArray(result.data)) throw new CompatibilityError('轮次列表格式不兼容');
  return latestTurnSignature(result.data);
}

async function readSnapshot(rpc, threadId, {accountVerified=false}={}) {
  const thread=await verifyThread(rpc,threadId,{accountVerified});
  // Capture completion status first: a turn that completes while items are read
  // is intentionally picked up by the following poll, never exported partially.
  const turns=await pages(rpc,'thread/turns/list',{threadId,limit:100,sortDirection:'asc',itemsView:'notLoaded'});
  const entries=await pages(rpc,'thread/items/list',{threadId,limit:100,sortDirection:'asc'});
  return {thread,transcript:renderTranscript(turns,entries),turns,entries};
}

async function ensureFolder(vault, path) {
  let current='';
  for(const part of path.split('/').filter(Boolean)) {
    current=current?`${current}/${part}`:part;
    const entry=vault.getAbstractFileByPath(current);
    if(entry && !('children' in entry)) throw Error(`目录被文件占用：${current}`);
    if(!entry) await vault.createFolder(current);
  }
}

async function ensureDaily(vault, day,route={}) {
  const folder=route.dailyFolder||'Daily';
  const path=`${folder}/${day}.md`;
  const existing=vault.getAbstractFileByPath(path);
  if(existing) {
    if('children' in existing) throw Error('每日记录路径被目录占用');
    return false;
  }
  const template=route.dailyTemplate&&vault.getAbstractFileByPath(route.dailyTemplate);
  if(route.dailyTemplate && (!template || 'children' in template)) throw Error('未找到每日记录模板');
  const text=(template?await vault.read(template):require('./settings').DEFAULT_TEMPLATE).replaceAll('{{date:YYYY-MM-DD}}',day);
  if(/{{|<%/.test(text)) throw Error('每日模板包含验证版尚不支持的占位符');
  await ensureFolder(vault,folder);
  await vault.create(path,text);
  return true;
}

async function syncToVault(vault, snapshot, {notePath=null, alive=()=>true, now=Date.now(),route={},ensureIndexed=false}={}) {
  const {thread,transcript}=snapshot;
  if(!transcript) return {changed:false,notePath,reason:'尚无已结束的对话'};
  const check=()=>{if(!alive()) throw Error('插件已停止');};
  check();
  let file=notePath && vault.getAbstractFileByPath(notePath);
  // Remembered files must never silently be replaced by another note.
  if(file && noteThreadId(await vault.read(file))!==thread.id) throw Error('原笔记任务 ID 已修改，已停止同步');
  if(!file) {
    const matches=[];
    for(const candidate of vault.getMarkdownFiles()) {
      if(noteThreadId(await vault.read(candidate))===thread.id) matches.push(candidate);
    }
    if(matches.length>1) throw Error('发现多篇属于本任务的笔记，请先处理重复文件');
    file=matches[0];
  }
  let previous, next, path;
  if(file) {
    previous=await vault.read(file);
    next=updateNote(previous,thread,transcript,now,route);
    path=file.path;
  } else {
    const base=`${route.noteFolder||'Codex Conversations'}/${safeTitle(thread.name)}`;
    const occupied=p=>vault.getAbstractFileByPath(p)||vault.getMarkdownFiles().some(f=>f.path.normalize('NFC').toLowerCase()===p.normalize('NFC').toLowerCase());
    path=`${base}.md`;
    if(occupied(path)) path=`${base} (${thread.id.slice(-8)}).md`;
    if(occupied(path)) throw Error('同名任务短码文件也已存在，已停止覆盖');
    next=newNote(thread,transcript,now,route);
  }
  check();
  let dailyCreated=false;
  if(route.dailyTrackEnabled!==false){
    const oldDaily=previous&&/^\[\[(.+)\/(\d{4}-\d{2}-\d{2})\]\]$/.exec(parseNote(previous).doc.get('daily')||'');
    dailyCreated=await ensureDaily(vault,oldDaily?.[2]||route.day||dateParts(thread.createdAt,route.timeZone).day,oldDaily?{...route,dailyFolder:oldDaily[1]}:route);
  }
  check();
  if(file && (next!==previous || ensureIndexed)) {
    await vault.process(file,current=>{check();return updateNote(current,thread,transcript,now,route)+(ensureIndexed?'\n':'');});
  } else if(!file) {
    await ensureFolder(vault,route.noteFolder||'Codex Conversations');
    check();
    // Root staging avoids the inbox-only Templater create hook. Rename does not
    // create an empty inbox file. A failed rename leaves a recoverable full note.
    // A non-Markdown extension also prevents other plugins from trying to
    // index the staging path while it is being moved.
    const stage=`Codex 同步暂存 ${thread.id} ${now}.tmp`;
    const staged=await vault.create(stage,next);
    check();
    await vault.rename(staged,path);
    // Obsidian does not index a .tmp -> .md rename until an actual modify event.
    // process(s => s) is a no-op. One trailing newline on first publication
    // triggers indexing while preserving concurrent personal edits atomically.
    await vault.process(staged,current=>{check();return updateNote(current,thread,transcript,now,route)+'\n';});
  }
  return {changed:!file || next!==previous || dailyCreated || ensureIndexed,notePath:path,dailyCreated};
}

module.exports={START,END,dateParts,safeTitle,cleanUserText,attachmentKey,embedImageLinks,renderTranscript,parseNote,noteThreadId,newNote,updateNote,pages,verifyThread,latestTurnSignature,peekLatestTurn,readSnapshot,ensureFolder,ensureDaily,syncToVault};
