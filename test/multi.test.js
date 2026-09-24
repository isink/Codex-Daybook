require('./setup');
const THREAD_ID='fixture-main-task';
const test=require('node:test');
const assert=require('node:assert/strict');
const {migrateState,discoverTasks,isDesktopMain,allAttachments}=require('../src/tasks');
const {syncBatch,StateWriteError}=require('../src/batch');
const {parseNote,newNote}=require('../src/core');
const {defaults}=require('../src/settings');
const since=1789398000;
const task=(id,createdAt=since+1,extra={})=>({id,createdAt,name:'同名任务',originator:'Codex Desktop',source:'vscode',parentThreadId:null,ephemeral:false,...extra});
// These fixtures simulate an already-migrated, pre-existing installation
// (they hand syncBatch a raw schemaVersion:2 shape directly, bypassing
// upgradeState()) — daily track defaults to true for that population, per
// upgradeState()'s pre-3 migration path, unlike a genuinely fresh install.
const initial=()=>({schemaVersion:2,discoveryStartedAt:since,threads:{},settings:{...defaults(),dailyTrackEnabled:true}});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');

class Vault {
  constructor(){this.files=new Map([['Templates',{path:'Templates',children:[]}],['Templates/每日记录.md',{path:'Templates/每日记录.md',text:'---\ndate: "{{date:YYYY-MM-DD}}"\n---\n'}]]);this.writes=0;}
  getAbstractFileByPath(p){return this.files.get(p)||null;}
  getMarkdownFiles(){return [...this.files.values()].filter(f=>f.path.endsWith('.md'));}
  async createFolder(p){this.files.set(p,{path:p,children:[]});this.writes++;}
  async create(p,text){assert.ok(!this.files.has(p));const f={path:p,text};this.files.set(p,f);this.writes++;return f;}
  createBinary(p,b){return this.create(p,Buffer.from(b));}
  async read(f){return f.text;}
  async process(f,update){f.text=update(f.text);this.writes++;return f.text;}
  async rename(f,p){assert.ok(!this.files.has(p));this.files.delete(f.path);f.path=p;this.files.set(p,f);this.writes++;}
}
function backend(threads,{images=false}={}) {
  const calls=[],fail=new Set(),active=new Set();let discoveryFails=false;
  const rpc=async(method,params)=>{
    calls.push({method,params});
    if(method==='account/read')return {account:{type:'chatgpt'}};
    if(method==='thread/list'){
      if(discoveryFails)throw Error('列表不可用');
      return {data:threads.filter(t=>Boolean(t.archived)===params.archived).sort((a,b)=>b.createdAt-a.createdAt),nextCursor:null};
    }
    const t=threads.find(t=>t.id===params.threadId);
    if(!t || fail.has(params.threadId))throw Error('来源不可用');
    if(method==='thread/read')return {thread:t};
    if(method==='thread/turns/list')return {data:[{id:'turn',status:active.has(t.id)?'inProgress':'completed',startedAt:t.createdAt,completedAt:t.createdAt+1}],nextCursor:null};
    if(method==='thread/items/list')return {data:[{turnId:'turn',item:{id:'user',type:'userMessage',content:[{type:'text',text:'问题 '+t.id},...(images?[{type:'localImage',path:require('node:path').resolve(require('node:os').tmpdir(),'fixture.png')}]:[])]}},{turnId:'turn',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'答复 '+t.id}}],nextCursor:null};
    throw Error('unexpected RPC '+method);
  };
  return {rpc,calls,fail,active,setDiscoveryFailure:value=>{discoveryFails=value;}};
}
async function run(vault,b,state,options={}) {
  let persisted=state;let saves=0;
  const result=await syncBatch({vault,rpc:b.rpc,state,persist:async next=>{persisted=JSON.parse(JSON.stringify(next));saves++;},now:()=>1789488000000,readLocal:async()=>png,...options});
  return {...result,persisted,saves};
}
test('case-insensitive title collisions get distinct notes; changed defaults do not move enrolled tasks',async()=>{
  const {defaults}=require('../src/settings');const vault=new Vault();const b=backend([task('lower',since+1,{name:'example'}),task('upper',since+2,{name:'Example'})],{images:true});
  const first=await run(vault,b,{...initial(),settings:defaults()});assert.equal(first.report.errors.length,0);
  assert.notEqual(first.state.threads.lower.notePath.toLowerCase(),first.state.threads.upper.notePath.toLowerCase());
  const paths=Object.values(first.state.threads).map(t=>t.notePath);const writes=vault.writes;
  const second=await run(vault,b,{...first.state,settings:{...defaults(),noteFolder:'Elsewhere',dailyFolder:'NewDaily',attachmentFolder:'NewAssets',timeZone:'America/New_York'}});
  assert.equal(second.report.changed,0);assert.equal(second.report.copiedImages,0);assert.equal(vault.writes,writes);assert.deepEqual(Object.values(second.state.threads).map(t=>t.notePath),paths);
});
test('incompatible discovery source schema aborts before any note writes',async()=>{
  const vault=new Vault(),writes=vault.writes;const b=backend([task('new')]);const rpc=async(m,p)=>m==='thread/list'?{data:[{id:'bad',createdAt:since+1}],nextCursor:null}:b.rpc(m,p);
  await assert.rejects(()=>syncBatch({vault,rpc,state:initial(),persist:async()=>{}}),/不兼容/);assert.equal(vault.writes,writes);
});
test('missing local files are not counted as existing notes and unavailable mappings are retained',async()=>{
  const vault=new Vault();const b=backend([task('gone')]);const first=await run(vault,b,initial());const record=first.state.threads.gone;
  vault.files.delete(record.notePath);b.fail.add('gone');const writes=vault.writes;
  const next=await run(vault,b,first.state);assert.equal(next.report.notes,0);assert.equal(next.report.errors[0].kind,'source');assert.deepEqual(next.state.threads.gone,record);assert.equal(vault.writes,writes);
});

test('migration preserves the old task and image mapping, fixes cutoff once, refuses invalid config',()=>{
  const legacy={threadId:THREAD_ID,notePath:'Codex Conversations/原笔记.md',attachments:{key:{source:'/tmp/a.png',path:'Attachments/saved.png'}},lastSuccess:'old'};
  const before=JSON.stringify(legacy);const state=migrateState(legacy,since*1000+123);
  assert.equal(state.discoveryStartedAt,since+1);assert.deepEqual(state.threads[THREAD_ID].attachments,legacy.attachments);
  assert.equal(state.threads[THREAD_ID].notePath,legacy.notePath);assert.equal(JSON.stringify(legacy),before);
  const restart=migrateState(JSON.parse(JSON.stringify(state)),(since+9999)*1000);
  assert.equal(restart.discoveryStartedAt,since+1);
  assert.deepEqual(migrateState({},since*1000).threads,{});
  for(const bad of [{schemaVersion:99},{schemaVersion:2,threads:{}},{schemaVersion:2,discoveryStartedAt:since,threads:{'../x':{}}}])assert.throws(()=>migrateState(bad));
});

test('discovery follows all new pages including timestamp ties and archives, stops at historical boundary',async()=>{
  const calls=[];
  const rpc=async(_method,p)=>{
    calls.push(p);
    if(p.archived)return {data:[task('archived',since+2)],nextCursor:null};
    if(!p.cursor)return {data:[task('a',since+5),task('b',since+5)],nextCursor:'page2'};
    assert.equal(p.cursor,'page2');return {data:[task('c',since+5),task('old',since-1)],nextCursor:'must-not-read-old-history'};
  };
  assert.deepEqual((await discoverTasks(rpc,since)).map(t=>t.id),['a','b','c','archived']);
  assert.equal(calls.length,3);assert.ok(calls.every(p=>p.useStateDbOnly && p.sortKey==='created_at' && p.sortDirection==='desc'));
  await assert.rejects(()=>discoverTasks(async()=>({data:[task('a')],nextCursor:'repeat'}),since),/重复/);
  await assert.rejects(()=>discoverTasks(async()=>({data:[task('a',since),task('b',since+1)],nextCursor:null}),since),/排序/);
});

test('only local desktop main tasks qualify; no subagent, CLI, ChatGPT, ephemeral, or parented thread',()=>{
  assert.ok(isDesktopMain(task('a')));assert.ok(isDesktopMain(task('fork',since,{forkedFromId:'original'})));
  for(const extra of [{source:{subAgent:{}}},{source:'subAgent'},{source:'cli'},{originator:'ChatGPT'},{originator:'VS Code'},{ephemeral:true},{parentThreadId:'parent'}])assert.equal(isDesktopMain(task('excluded',since,extra)),false);
});

test('two same-title tasks get separate notes, task-scoped images and their own creation-day links',async()=>{
  const vault=new Vault();const b=backend([task('a',since+10),task('b',since+86400)],{images:true});
  const r=await run(vault,b,initial());
  assert.equal(r.report.discovered,2);assert.equal(r.report.notes,2);assert.equal(r.report.errors.length,0);
  const a=r.state.threads.a,bb=r.state.threads.b;assert.notEqual(a.notePath,bb.notePath);
  assert.equal(parseNote(await vault.read(vault.getAbstractFileByPath(a.notePath))).doc.get('daily'),'[[Daily/2026-09-14]]');
  assert.equal(parseNote(await vault.read(vault.getAbstractFileByPath(bb.notePath))).doc.get('daily'),'[[Daily/2026-09-15]]');
  assert.equal(Object.keys(allAttachments(r.state)).length,2);
  // Same title: one folder gets the short-ID suffix, so their images never mix.
  assert.notEqual(a.attachmentDir,bb.attachmentDir);
  assert.ok(Object.values(a.attachments)[0].path.startsWith(a.attachmentDir+'/'));assert.ok(Object.values(bb.attachments)[0].path.startsWith(bb.attachmentDir+'/'));
  const writes=vault.writes;const again=await run(vault,b,migrateState(r.persisted));
  assert.equal(again.report.changed,0);assert.equal(again.report.copiedImages,0);assert.equal(again.saves,0);assert.equal(vault.writes,writes);
});

test('old single-task exception keeps its note; no historical bodies fetched, restart finds offline new tasks',async()=>{
  const vault=new Vault();const legacy=task(THREAD_ID,since-1000,{name:'原笔记'});await vault.createFolder('Codex Conversations');
  await vault.create('Codex Conversations/原笔记.md',newNote(legacy,'旧正文'));
  const state=migrateState({threadId:THREAD_ID,notePath:'Codex Conversations/原笔记.md',attachments:{}},since*1000);
  const b=backend([legacy,task('historical',since-10),task('subagent',since+1,{parentThreadId:'parent'}),task('new',since+10)]);
  const r=await run(vault,b,state);
  assert.equal(r.state.threads[THREAD_ID].notePath,'Codex Conversations/原笔记.md');
  assert.deepEqual(Object.keys(r.state.threads).sort(),[THREAD_ID,'new'].sort());
  assert.ok(!b.calls.some(c=>c.params.threadId==='historical' || c.params.threadId==='subagent'));
  b.calls.length=0;const later=backend([legacy,task('historical',since-10),task('new',since+10),task('offline',since+1000)]);
  const next=await run(vault,later,migrateState(r.persisted,(since+10000)*1000));
  assert.ok(next.state.threads.offline);assert.equal(next.state.discoveryStartedAt,since);
});

test('ongoing first turn registers task but publishes only after completion, without duplicate notes',async()=>{
  const vault=new Vault();const b=backend([task('new')]);b.active.add('new');
  const first=await run(vault,b,initial());assert.equal(first.report.waiting,1);assert.equal(first.report.notes,0);
  b.active.clear();const next=await run(vault,b,first.state);assert.equal(next.report.notes,1);assert.equal(next.report.changed,1);
  const last=await run(vault,b,next.state);assert.equal(last.report.changed,0);assert.equal(last.report.discovered,0);
});

test('one unreadable task retains its note while another continues; discovery failure does not stop tracked tasks',async()=>{
  const vault=new Vault();const b=backend([task('bad'),task('good')]);const first=await run(vault,b,initial());
  const old=await vault.read(vault.getAbstractFileByPath(first.state.threads.bad.notePath));
  b.fail.add('bad');const next=await run(vault,b,first.state);
  assert.equal(next.report.checked,1);assert.equal(next.report.errors.length,1);assert.equal(next.report.errors[0].message,'源对话暂不可用，本地副本已保留');
  assert.equal(await vault.read(vault.getAbstractFileByPath(first.state.threads.bad.notePath)),old);
  b.setDiscoveryFailure(true);const third=await run(vault,b,next.state);assert.equal(third.report.checked,1);assert.ok(third.report.errors.some(e=>e.kind==='discovery'));
});

test('state-write failure aborts before reading new task bodies; stopped plugin performs no writes',async()=>{
  const vault=new Vault();const b=backend([task('new')]);
  await assert.rejects(()=>run(vault,b,initial(),{persist:async()=>{throw Error('disk full');}}),StateWriteError);
  assert.ok(!b.calls.some(c=>c.method==='thread/read'));assert.equal(vault.writes,0);
  await assert.rejects(()=>run(vault,b,initial(),{alive:()=>false}),/停止/);assert.equal(vault.writes,0);
});

test('snapshot revalidates source before reading messages even when discovery listed a main task',async()=>{
  const vault=new Vault();const b=backend([task('new')]);
  const rpc=async(m,p)=>m==='thread/read'?{thread:task('new',since+1,{source:'subAgent'})}:b.rpc(m,p);
  const r=await run(vault,{rpc},initial());assert.equal(r.report.notes,0);assert.equal(r.report.errors[0].kind,'source');
  assert.ok(!b.calls.some(c=>c.method==='thread/items/list'));
});

test('settled task skip logic: unchanged cycle skips full pagination; rename and a later new turn are both still caught',async()=>{
  const vault=new Vault();
  let name='原始标题',turn={id:'t1',status:'completed',startedAt:since+1,completedAt:since+2};
  const calls=[];
  const rpc=async(method,params)=>{
    calls.push({method,params});
    if(method==='account/read')return {account:{type:'chatgpt'}};
    if(method==='thread/list')return {data:params.archived?[]:[task('settle',since+1,{name})],nextCursor:null};
    if(method==='thread/read')return {thread:task('settle',since+1,{name})};
    if(method==='thread/turns/list')return {data:[turn],nextCursor:null};
    if(method==='thread/items/list')return {data:[
      {turnId:turn.id,item:{id:'user',type:'userMessage',content:[{type:'text',text:'问题 '+turn.id}]}},
      {turnId:turn.id,item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'答复 '+turn.id}}
    ],nextCursor:null};
    throw Error('unexpected '+method);
  };
  const first=await run(vault,{rpc},initial());
  assert.equal(first.report.notes,1);assert.ok(first.state.threads.settle.turnSignature);assert.equal(first.state.threads.settle.pendingImages,false);

  // Nothing changed: the peek must be enough, no full turns/items pagination.
  calls.length=0;
  const second=await run(vault,{rpc},migrateState(first.persisted));
  assert.equal(second.report.checked,1);assert.equal(second.report.changed,0);assert.equal(second.saves,0);
  assert.ok(!calls.some(c=>c.method==='thread/items/list'));
  assert.ok(calls.some(c=>c.method==='thread/turns/list' && c.params.limit===1 && c.params.sortDirection==='desc'));

  // A rename with no new turn must still be picked up (peek alone can't see it).
  name='新标题';
  const renamed=await run(vault,{rpc},migrateState(second.persisted));
  assert.equal(renamed.report.changed,1);
  assert.equal(parseNote(await vault.read(vault.getAbstractFileByPath(renamed.state.threads.settle.notePath))).doc.get('title'),'新标题');

  // A genuinely new turn must also be caught, even though it was "settled" a moment ago.
  turn={id:'t2',status:'completed',startedAt:since+10,completedAt:since+11};
  calls.length=0;
  const nextTurn=await run(vault,{rpc},migrateState(renamed.persisted));
  assert.ok(calls.some(c=>c.method==='thread/items/list'));
  assert.equal(nextTurn.report.changed,1);
  assert.ok((await vault.read(vault.getAbstractFileByPath(nextTurn.state.threads.settle.notePath))).includes('问题 t2'));
});

test('a pending image keeps the task out of the fast path and is retried every cycle until it succeeds',async()=>{
  const vault=new Vault();let failRead=true;
  const b=backend([task('img',since+1)],{images:true});
  const readLocal=async()=>{if(failRead)throw Error('ENOENT');return png;};
  const first=await run(vault,b,initial(),{readLocal});
  assert.equal(first.report.notes,1);assert.equal(first.report.missingImages,1);assert.equal(first.state.threads.img.pendingImages,true);

  b.calls.length=0;
  const second=await run(vault,b,migrateState(first.persisted),{readLocal});
  assert.ok(b.calls.some(c=>c.method==='thread/items/list'));
  assert.equal(second.report.missingImages,1);assert.equal(second.state.threads.img.pendingImages,true);

  failRead=false;
  const third=await run(vault,b,migrateState(second.persisted),{readLocal});
  assert.equal(third.report.copiedImages,1);assert.equal(third.state.threads.img.pendingImages,false);

  // Now settled: a readLocal that would throw must never even be reached.
  b.calls.length=0;
  const fourth=await run(vault,b,migrateState(third.persisted),{readLocal:async()=>{throw Error('must not read: cached and settled');}});
  assert.ok(!b.calls.some(c=>c.method==='thread/items/list'));
  assert.equal(fourth.report.checked,1);
});

test('a permanently unsupported image format does not block the settled fast path',async()=>{
  const vault=new Vault();
  const b=backend([task('badimg',since+1)],{images:true});
  const badBytes=Buffer.from('this is not a valid image file at all');
  const first=await run(vault,b,initial(),{readLocal:async()=>badBytes});
  assert.equal(first.report.notes,1);
  assert.equal(first.report.missingImages,0);
  assert.equal(first.state.threads.badimg.pendingImages,false);
  assert.ok((await vault.read(vault.getAbstractFileByPath(first.state.threads.badimg.notePath))).includes('图片格式不支持'));

  // Settled on the very first cycle: no transient failure, so the fast path
  // must hold immediately, without re-reading bytes or re-paginating.
  b.calls.length=0;
  const second=await run(vault,b,migrateState(first.persisted),{readLocal:async()=>{throw Error('must not read: cached and settled');}});
  assert.ok(!b.calls.some(c=>c.method==='thread/items/list'));
  assert.equal(second.report.checked,1);
  assert.equal(second.report.changed,0);
});
