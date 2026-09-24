require('./setup');
const test=require('node:test');
const assert=require('node:assert/strict');
const {syncBatch,StateWriteError,PUBLICATION_VERSION}=require('../src/batch');
const {defaults,routing}=require('../src/settings');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');

function fixture({image=false}={}) {
  const files=new Map();let revision=1,readable=true;
  const thread={id:'retry-fixture',name:'Retry fixture',createdAt:1700000010,originator:'Codex Desktop',source:'vscode',parentThreadId:null};
  const vault={
    getAbstractFileByPath:p=>files.get(p),getMarkdownFiles:()=>[...files.values()].filter(f=>f.path.endsWith('.md')),
    createFolder:async p=>{files.set(p,{path:p,children:[]});},
    create:async(p,text)=>{assert.ok(!files.has(p));const f={path:p,text};files.set(p,f);return f;},
    createBinary:async(p,bytes)=>vault.create(p,Buffer.from(bytes)),
    read:async f=>f.text,
    process:async(f,update)=>{f.text=update(f.text);return f.text;},
    rename:async(f,p)=>{assert.ok(!files.has(p));files.delete(f.path);f.path=p;files.set(p,f);}
  };
  let saved={schemaVersion:3,settings:{...defaults(),consent:true},enabled:true,discoveryStartedAt:1700000000,threads:{[thread.id]:{name:thread.name,notePath:null,attachments:{},routing:routing(defaults(),thread)}}};
  const rpc=async(m,p)=>{
    if(m==='account/read')return {account:{type:'chatgpt'}};
    if(m==='thread/list')return {data:p.archived?[]:[thread],nextCursor:null};
    if(m==='thread/read')return {thread};
    if(m==='thread/turns/list')return {data:[{id:'turn',status:'completed',startedAt:thread.createdAt,completedAt:thread.createdAt+revision}],nextCursor:null};
    if(m==='thread/items/list')return {data:[
      {turnId:'turn',item:{id:'question',type:'userMessage',content:[{type:'text',text:'Fixture question'},...(image?[{type:'localImage',path:require('node:path').resolve(require('node:os').tmpdir(),'retry-fixture.png')}]:[])]}},
      {turnId:'turn',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'RESPONSE '+revision}}
    ],nextCursor:null};
    throw Error('Unexpected method');
  };
  const persist=async next=>{saved=JSON.parse(JSON.stringify(next));};
  return {vault,files,rpc,persist,thread,
    get saved(){return saved;},get record(){return saved.threads[thread.id];},
    get note(){return [...files.values()].find(f=>typeof f.text==='string'&&f.text.includes('codex_thread_id:'));},
    setRevision:n=>{revision=n;},setReadable:v=>{readable=v;},
    run:options=>syncBatch({vault,rpc,state:JSON.parse(JSON.stringify(saved)),persist,readLocal:async()=>{if(!readable)throw Error('Missing image');return png;},...options})};
}

test('existing note write failure retries on restart without acknowledging the new signature',async()=>{
  const f=fixture();await f.run();f.note.text+='\nPersonal supplement\n';
  const signature=f.record.turnSignature;f.setRevision(2);
  const process=f.vault.process;f.vault.process=async()=>{throw Error('Disk full');};
  const failed=await f.run();assert.equal(failed.report.errors.length,1);
  assert.deepEqual(f.record.turnSignature,signature);assert.equal(f.record.syncPending,true);
  assert.ok(!f.note.text.includes('RESPONSE 2'));
  f.vault.process=process;await f.run();
  assert.ok(f.note.text.includes('RESPONSE 2'));assert.ok(f.note.text.includes('Personal supplement'));
  assert.equal(f.record.syncPending,false);assert.equal((await f.run()).report.changed,0);
});

test('image cache survives body failure and missing original on restart',async()=>{
  const f=fixture({image:true});f.setReadable(false);await f.run();
  assert.equal(f.record.pendingImages,true);f.setReadable(true);
  const process=f.vault.process;f.vault.process=async()=>{throw Error('Write failed');};
  assert.equal((await f.run()).report.errors.length,1);assert.equal(Object.keys(f.record.attachments).length,1);
  assert.equal(f.record.syncPending,true);f.setReadable(false);f.vault.process=process;
  const retry=await f.run();assert.equal(retry.report.errors.length,0);assert.equal(retry.report.copiedImages,0);
  assert.equal(f.record.pendingImages,false);assert.match(f.note.text,/\.png/);
  assert.equal([...f.files.keys()].filter(p=>p.endsWith('.png')).length,1);
});

test('final state save failure retries an already-written note without duplicating it or its images',async()=>{
  const f=fixture({image:true});
  await assert.rejects(()=>f.run({persist:async next=>{if(next.threads[f.thread.id].syncPending===false)throw Error('State disk full');await f.persist(next);}}),StateWriteError);
  assert.equal(f.record.notePath,null);assert.equal(f.record.syncPending,true);assert.ok(f.note);
  const path=f.note.path;await f.run();assert.equal(f.record.notePath,path);
  assert.equal([...f.files.values()].filter(x=>typeof x.text==='string'&&x.text.includes('codex_thread_id:')).length,1);
  assert.equal([...f.files.keys()].filter(p=>p.endsWith('.png')).length,1);
  assert.equal((await f.run()).report.changed,0);
});

test('stop after durable attachment cache prevents note publication and permits recovery',async()=>{
  const f=fixture({image:true});let alive=true;
  await assert.rejects(()=>f.run({alive:()=>alive,persist:async next=>{await f.persist(next);if(next.threads[f.thread.id].syncPending)alive=false;}}),/停止/);
  assert.equal(f.note,undefined);assert.equal(f.record.syncPending,true);
  f.setReadable(false);await f.run();assert.ok(f.note);assert.equal(f.record.syncPending,false);
  assert.equal([...f.files.keys()].filter(p=>p.endsWith('.png')).length,1);
});

test('old acknowledged signature is reconciled once, preserving cutoff, routing and personal text',async()=>{
  const f=fixture();await f.run();f.note.text+='\nPersonal text\n';f.setRevision(2);
  const old=JSON.parse(JSON.stringify(f.saved));delete old.threads[f.thread.id].publicationVersion;
  old.threads[f.thread.id].turnSignature.completedAt++;
  const route=old.threads[f.thread.id].routing,cutoff=old.discoveryStartedAt;
  await f.persist(old);const result=await f.run();assert.equal(result.report.changed,1);
  assert.match(f.note.text,/RESPONSE 2/);assert.match(f.note.text,/Personal text/);
  assert.equal(f.saved.discoveryStartedAt,cutoff);assert.deepEqual(f.record.routing,route);
  assert.equal(f.record.publicationVersion,PUBLICATION_VERSION);assert.equal((await f.run()).report.changed,0);
});

test('a task settled by the previous release gets exactly one full re-read, then settles again',async()=>{
  const f=fixture();await f.run();
  const old=JSON.parse(JSON.stringify(f.saved));old.threads[f.thread.id].publicationVersion=1;await f.persist(old);
  let fullReads=0;const rpc=async(m,p)=>{if(m==='thread/items/list')fullReads++;return f.rpc(m,p);};
  await f.run({rpc});assert.equal(fullReads,1);assert.equal(f.record.publicationVersion,PUBLICATION_VERSION);
  await f.run({rpc});assert.equal(fullReads,1);
});

test('interrupted first indexing write recovers the renamed note and emits a modify event',async()=>{
  const f=fixture();const process=f.vault.process;let modifications=0;
  f.vault.process=async()=>{throw Error('First indexing failed');};
  assert.equal((await f.run()).report.errors.length,1);const path=f.note.path;
  f.vault.process=async(...args)=>{modifications++;return process(...args);};
  await f.run();assert.equal(f.record.notePath,path);assert.equal(modifications,1);
  await f.run();assert.equal(modifications,1);
});
