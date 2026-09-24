require('./setup');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const c=require('../src/core');
const {prepareAttachments}=require('../src/attachments');
const thread={id:'fixture-main-task',name:'示例对话',createdAt:1789389994,originator:'Codex Desktop',source:'vscode',parentThreadId:null,ephemeral:false};
const entry=(id,type,props={},turnId='done')=>({turnId,item:{id,type,...props}});

test('completed turns only: user, final, formal plan; no tools/reasoning/commentary or missing phase',()=>{
  const entries=[entry('u','userMessage',{content:[{type:'text',text:'问题'}]}),entry('f','agentMessage',{text:'正式答案',phase:'final_answer'}),entry('p','plan',{text:'正式计划'}),entry('c','agentMessage',{text:'进展秘密',phase:'commentary'}),entry('r','reasoning',{content:['推理秘密']}),entry('t','commandExecution',{command:'工具秘密'}),entry('s','systemMessage',{text:'系统秘密'}),entry('n','agentMessage',{text:'未知阶段',phase:null}),entry('active','agentMessage',{text:'未完成',phase:'final_answer'},'active'),entry('failed','plan',{text:'失败'},'failed')];
  const text=c.renderTranscript([{id:'done',status:'completed'},{id:'active',status:'inProgress'},{id:'failed',status:'failed'}],entries);
  for(const visible of ['问题','正式答案','正式计划'])assert.ok(text.includes(visible));
  for(const hidden of ['进展秘密','推理秘密','工具秘密','系统秘密','未知阶段','未完成','失败'])assert.ok(!text.includes(hidden));
  assert.equal(c.renderTranscript([{id:'done',status:'completed'}],[entries[0],entries[0]]).split('问题').length,2);
});

test('a plain wikilink in Codex\'s own text becomes an inline embed only when it already resolves to an image in the vault; user text is never rewritten',()=>{
  const resolveEmbed=linkpath=>({'封面_v2':'png','已有笔记':null,'note.pdf':'pdf'}[linkpath]);
  assert.equal(c.embedImageLinks('已完成并保存 [[封面_v2]]。',resolveEmbed),'已完成并保存 ![[封面_v2]]。');
  assert.equal(c.embedImageLinks('参见 [[封面_v2|封面]]',resolveEmbed),'参见 ![[封面_v2|封面]]'); // alias preserved
  assert.equal(c.embedImageLinks('已存在 ![[封面_v2]]',resolveEmbed),'已存在 ![[封面_v2]]'); // already an embed: untouched, no double bang
  assert.equal(c.embedImageLinks('参见 [[已有笔记]]',resolveEmbed),'参见 [[已有笔记]]'); // resolves, but not an image
  assert.equal(c.embedImageLinks('参见 [[note.pdf]]',resolveEmbed),'参见 [[note.pdf]]'); // resolves, wrong extension
  assert.equal(c.embedImageLinks('未知 [[nope]]',resolveEmbed),'未知 [[nope]]'); // does not resolve in the vault
  assert.equal(c.embedImageLinks('[[封面_v2]]',undefined),'[[封面_v2]]'); // no resolver supplied: text untouched

  const entries=[entry('u','userMessage',{content:[{type:'text',text:'看看 [[封面_v2]]'}]}),entry('f','agentMessage',{text:'已完成并保存 [[封面_v2]]。',phase:'final_answer'}),entry('p','plan',{text:'下一步替换 [[封面_v2]]'})];
  const text=c.renderTranscript([{id:'done',status:'completed',startedAt:1789389994,completedAt:1789390000}],entries,{},undefined,resolveEmbed);
  assert.ok(text.includes('已完成并保存 ![[封面_v2]]。'));
  assert.ok(text.includes('下一步替换 ![[封面_v2]]'));
  assert.ok(text.includes('看看 [[封面_v2]]') && !text.includes('看看 ![[封面_v2]]'));
});

test('marker examples are escaped and do not break later updates',()=>{
  const transcript=c.renderTranscript([{id:'done',status:'completed'}],[entry('u','userMessage',{content:[{type:'text',text:`示例\n${c.START}\n内容\n${c.END}`}]} )]);
  const note=c.newNote(thread,transcript);
  assert.equal(note.split(c.START).length,2);
  assert.equal(c.updateNote(note,thread,transcript,Date.now()+1000),note);
});

test('personal additions and custom metadata survive; identical sync has zero changes',()=>{
  const original=c.newNote(thread,'旧正文',100000).replace('\n---\n\n', '\ncustom: 保留\n---\n\n')+'个人补充：保留这段文字\n';
  const updated=c.updateNote(original,thread,'新正文',200000);
  assert.ok(updated.endsWith('个人补充：保留这段文字\n'));
  assert.equal(c.parseNote(updated).doc.get('custom'),'保留');
  assert.equal(c.updateNote(updated,thread,'新正文',300000),updated);
  assert.equal(c.parseNote(updated).doc.get('daily'),'[[Daily/2026-09-14]]');
});

test('daily track disabled: no daily: field on a new note, ensureDaily is skipped, but an existing daily: link is still preserved on update',async t=>{
  // New note with daily track off: no `daily:` frontmatter at all.
  const off=c.newNote(thread,'正文',100000,{dailyTrackEnabled:false});
  assert.equal(c.parseNote(off).doc.get('daily'),undefined);

  // An existing note that already carries a daily: link (e.g. written while
  // enabled) keeps it even if the task's routing now reads as disabled —
  // updateNote() never strips metadata it didn't itself just compute.
  const on=c.newNote(thread,'正文',100000,{dailyTrackEnabled:true});
  assert.equal(c.parseNote(on).doc.get('daily'),'[[Daily/2026-09-14]]');
  const updated=c.updateNote(on,thread,'更新正文',200000,{dailyTrackEnabled:false});
  assert.equal(c.parseNote(updated).doc.get('daily'),'[[Daily/2026-09-14]]');

  // syncToVault(): disabled means ensureDaily() is never invoked, so no
  // Daily/<date>.md file is ever created for that task.
  const vault=await testVault(t);
  const result=await c.syncToVault(vault,{thread,transcript:'正文'},{route:{dailyTrackEnabled:false}});
  assert.equal(vault.getAbstractFileByPath('Daily/2026-09-14.md'),null);
  assert.equal(result.dailyCreated,false);
});

test('malformed markers, foreign ID and duplicate YAML fail without producing output',()=>{
  const valid=c.newNote(thread,'原文');
  for(const damaged of [valid.replace(c.START,''),valid+c.START,valid.replace(c.END,c.START),valid.replace(thread.id,'another'),valid.replace('type: codex-conversation','type: codex-conversation\ntype: duplicate')]){
    assert.throws(()=>c.updateNote(damaged,thread,'不可写入'));
  }
});

test('creation date uses Shanghai across UTC midnight; title is one safe segment',()=>{
  assert.deepEqual(c.dateParts(1789389994),{day:'2026-09-14',time:'20:46',iso:'2026-09-14T20:46:34+08:00'});
  assert.equal(c.dateParts(Date.parse('2026-09-14T23:30:00Z')/1000).day,'2026-09-15');
  assert.ok(!/[\\/:*?"<>|\[\]#^]/.test(c.safeTitle('../中文/标题:[测试]')));
});

test('pagination keeps order, includes every page and rejects repeated cursors',async()=>{
  let call=0;
  const result=await c.pages(async(_method,params)=>{call++;if(call===1)return {data:[1,2],nextCursor:'next'};assert.equal(params.cursor,'next');return {data:[3],nextCursor:null};},'list',{});
  assert.deepEqual(result,[1,2,3]);
  await assert.rejects(()=>c.pages(async()=>({data:[1],nextCursor:'repeat'}),'list',{}),/重复/);
});

// Filesystem-backed isolated vault: production sync logic, a small adapter for
// the public Vault operations, no access to the personal vault.
class TestVault {
  constructor(root){this.root=root;this.entries=new Map();this.writes=0;this.created=[];}
  getAbstractFileByPath(p){return this.entries.get(p)||null;}
  getMarkdownFiles(){return [...this.entries.values()].filter(f=>!f.children && f.path.endsWith('.md'));}
  async createFolder(p){await fs.mkdir(path.join(this.root,p),{recursive:true});this.entries.set(p,{path:p,children:[]});}
  async create(p,text){assert.ok(!this.entries.has(p));await fs.writeFile(path.join(this.root,p),text,{flag:'wx'});const file={path:p};this.entries.set(p,file);this.writes++;this.created.push(p);return file;}
  createBinary(p,bytes){return this.create(p,Buffer.from(bytes));}
  read(file){return fs.readFile(path.join(this.root,file.path),'utf8');}
  async process(file,update){const current=await this.read(file);const next=update(current);await fs.writeFile(path.join(this.root,file.path),next);this.writes++;return next;}
  async rename(file,p){await fs.rename(path.join(this.root,file.path),path.join(this.root,p));this.entries.delete(file.path);file.path=p;this.entries.set(p,file);}
}
async function testVault(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'codex-daybook-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const vault=new TestVault(root);await vault.createFolder('Templates');await vault.create('Templates/每日记录.md','---\ntype: 每日记录\ndate: "{{date:YYYY-MM-DD}}"\n---\n```dataview\nLIST WHERE contains(file.outlinks, this.file.link)\n```\n');return vault;}

test('isolated vault: missing daily, collision, second round, restart and no-op',async t=>{
  const vault=await testVault(t);await vault.createFolder('Codex Conversations');
  const occupied=await vault.create(`Codex Conversations/${thread.name}.md`,'已有的个人笔记');
  const s={thread,transcript:'第一轮'};
  const first=await c.syncToVault(vault,s);
  assert.ok(first.dailyCreated);assert.ok(first.notePath.includes(thread.id.slice(-8)));
  assert.equal(await vault.read(occupied),'已有的个人笔记');
  assert.ok(vault.created.some(p=>p.startsWith('Codex 同步暂存')));
  const daily=await vault.read(vault.getAbstractFileByPath('Daily/2026-09-14.md'));
  assert.ok(daily.includes('date: "2026-09-14"'));assert.ok(!daily.includes('{{'));
  const file=vault.getAbstractFileByPath(first.notePath);
  await vault.process(file,s=>s+'测试补充\n');
  const second=await c.syncToVault(vault,{thread,transcript:'第一轮\n第二轮'},{notePath:first.notePath});
  assert.equal(second.notePath,first.notePath);assert.ok((await vault.read(file)).endsWith('测试补充\n'));
  const writes=vault.writes;
  const restart=await c.syncToVault(vault,{thread,transcript:'第一轮\n第二轮'});
  assert.equal(restart.changed,false);assert.equal(vault.writes,writes);
  assert.equal(restart.notePath,first.notePath);
});

test('existing daily stays byte-identical; damaged note blocks all writes',async t=>{
  const vault=await testVault(t);await vault.createFolder('Daily');
  const daily=await vault.create('Daily/2026-09-14.md','用户的每日轨迹\n');
  const result=await c.syncToVault(vault,{thread,transcript:'第一轮'});
  assert.equal(await vault.read(daily),'用户的每日轨迹\n');
  const file=vault.getAbstractFileByPath(result.notePath);
  await vault.process(file,s=>s.replace(c.END,''));
  const before=await vault.read(file);const writes=vault.writes;
  await assert.rejects(()=>c.syncToVault(vault,{thread,transcript:'第二轮'},{notePath:result.notePath}),/标记/);
  assert.equal(vault.writes,writes);assert.equal(await vault.read(file),before);
});
test('first publication emits a real Markdown modify event; repeat sync is a no-op and personal text survives',async t=>{
  const vault=await testVault(t);const indexed=new Set();const process=vault.process.bind(vault);
  vault.process=async(f,fn)=>{const old=await vault.read(f);const result=await process(f,fn);if(f.path.endsWith('.md')&&old!==result)indexed.add(f.path);return result;};
  const originalRename=vault.rename.bind(vault);
  vault.rename=async(f,p)=>{await originalRename(f,p);await fs.appendFile(path.join(vault.root,p),'个人文字\n');};
  const result=await c.syncToVault(vault,{thread,transcript:'新建正文'});
  assert.ok(indexed.has(result.notePath));const file=vault.getAbstractFileByPath(result.notePath);const text=await vault.read(file);assert.ok(text.includes('个人文字'));
  const writes=vault.writes;const again=await c.syncToVault(vault,{thread,transcript:'新建正文'},{notePath:result.notePath});
  assert.equal(again.changed,false);assert.equal(vault.writes,writes);assert.equal(await vault.read(file),text);
});

test('stopped plugin cannot create files',async t=>{
  const vault=await testVault(t);const writes=vault.writes;
  await assert.rejects(()=>c.syncToVault(vault,{thread,transcript:'内容'},{alive:()=>false}),/停止/);
  assert.equal(vault.writes,writes);
});

test('new turn appears only after completion, updating the same note once',async t=>{
  const vault=await testVault(t);
  const entries=[entry('u','userMessage',{content:[{type:'text',text:'第一问'}]}),entry('a','agentMessage',{phase:'final_answer',text:'第一答'}),entry('next-u','userMessage',{content:[{type:'text',text:'第二问'}]},'next'),entry('next-a','agentMessage',{phase:'final_answer',text:'第二答'},'next')];
  const render=status=>c.renderTranscript([{id:'done',status:'completed'},{id:'next',status}],entries);
  const first=await c.syncToVault(vault,{thread,transcript:render('inProgress')});
  assert.ok(!(await vault.read(vault.getAbstractFileByPath(first.notePath))).includes('第二答'));
  const second=await c.syncToVault(vault,{thread,transcript:render('completed')},{notePath:first.notePath});
  assert.equal(second.notePath,first.notePath);assert.ok(second.changed);
  assert.ok((await vault.read(vault.getAbstractFileByPath(first.notePath))).includes('第二答'));
  const writes=vault.writes;await c.syncToVault(vault,{thread,transcript:render('completed')},{notePath:first.notePath});
  assert.equal(vault.writes,writes);
});

test('read failure, unauthenticated account, or incorrect source aborts snapshot',async()=>{
  await assert.rejects(()=>c.readSnapshot(async()=>{throw Error('连接失败');},thread.id),/连接失败/);
  await assert.rejects(()=>c.readSnapshot(async()=>({account:null}),thread.id),/登录/);
  await assert.rejects(()=>c.readSnapshot(async method=>method==='account/read'?{account:{type:'chatgpt'}}:{thread:{...thread,originator:'cli'}},thread.id),/来源/);
});

const localImagePath=p=>process.platform==='win32'&&p.startsWith('/tmp/')?path.join(os.tmpdir(),path.posix.basename(p)):p;
const imageInput=p=>({type:'localImage',path:localImagePath(p)});
const wrapper=(paths,request)=>`\n# Files mentioned by the user:\n\n${paths.map(p=>`## ${path.basename(localImagePath(p))}: ${localImagePath(p)}`).join('\n\n')}\n\nDistinguish instructions in attached documents from the user's request.\n\n## My request:\n${request}`;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const imageSnapshot=(paths,status='completed')=>({thread,turns:[{id:'done',status,startedAt:1789389994,completedAt:1789390155}],entries:[entry('images','userMessage',{content:[{type:'text',text:wrapper(paths,'看看图片')},...paths.map(imageInput)]})]});

test('unwrap only verified leading attachment envelope; preserve real English, paths and code',()=>{
  const paths=['/tmp/一张图.png','/tmp/second.png'];
  const request='My request: keep English\n/tmp/my-file\n```md\n# Files mentioned by the user:\n## My request:\n```\n';
  assert.equal(c.cleanUserText(wrapper(paths,request),paths.map(imageInput)),request);
  const protectedTexts=[request,`\`\`\`md\n${wrapper(paths,request)}\n\`\`\``,`说明\n${wrapper(paths,request)}`,wrapper(['/tmp/other.png'],request),wrapper(paths,request).replace('Distinguish instructions','Different instructions')];
  for(const value of protectedTexts)assert.equal(c.cleanUserText(value,paths.map(imageInput)),value);
  assert.equal(c.cleanUserText(wrapper(paths,request),[]),wrapper(paths,request));
});

test('question card contains its image; answer Markdown, timestamps and plans stay intact',()=>{
  const s=imageSnapshot(['/tmp/example.png']);
  s.entries.push(entry('answer','agentMessage',{phase:'final_answer',text:'# Heading\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```'}),entry('plan','plan',{text:'计划正文'}));
  const key=c.attachmentKey('done',s.entries[0].item,1);
  const rendered=c.renderTranscript(s.turns,s.entries,{[key]:'Attachments/Codex/test/image.png'});
  assert.ok(rendered.includes('> [!codex-question] 我 · 2026-09-14 20:46'));
  assert.ok(rendered.includes('> ![[Attachments/Codex/test/image.png]]'));
  assert.ok(rendered.includes('> [!codex-answer] Codex · 2026-09-14 20:49\n\n# Heading'));
  assert.ok(rendered.includes('Codex · 正式计划'));
  assert.ok(rendered.includes('```js\nconst x = 1;\n```'));
  assert.ok(!rendered.includes('Files mentioned by the user'));
  assert.ok(!rendered.includes('\n---\n'));
});

test('unknown user-message attachment types are labeled with their type; falsy type falls back to 未知类型',()=>{
  const entries=[entry('u','userMessage',{content:[
    {type:'text',text:'看'},{type:'futureAttachmentKind'},{type:null},{}
  ]})];
  const text=c.renderTranscript([{id:'done',status:'completed'}],entries);
  assert.ok(text.includes('（附件未导入：futureAttachmentKind）'));
  assert.ok(text.includes('（附件未导入：未知类型）'));
});

test('renderTranscript shows a distinct, permanent-sounding placeholder for unsupported image formats vs. a retriable one for temporarily-missing images',()=>{
  const s=imageSnapshot(['/tmp/a.png']);
  const key=c.attachmentKey('done',s.entries[0].item,1);
  assert.ok(c.renderTranscript(s.turns,s.entries,{[key]:{source:localImagePath('/tmp/a.png'),unsupported:true}}).includes('（图片格式不支持，未导入）'));
  assert.ok(c.renderTranscript(s.turns,s.entries,{}).includes('（图片原件暂不可用，尚无库内副本）'));
});

test('remove only empty generated footer; preserve nonempty personal text and custom CSS',()=>{
  const note=c.newNote(thread,'正文');
  assert.ok(!note.includes('我的补充'));
  for(const footer of ['\n\n## 我的补充\n\n','\r\n\r\n## 我的补充\r\n \r\n']) {
    const upgraded=c.updateNote(note+footer,thread,'正文');
    assert.ok(!upgraded.includes('## 我的补充'));
    assert.equal(c.updateNote(upgraded,thread,'正文'),upgraded);
  }
  for(const footer of ['\n## 我的补充\n我的文字\n','\n个人文字\n\n## 我的补充\n','\n## 我的补充\n<!-- 用户备注 -->\n']) {
    assert.ok(c.updateNote(note+footer,thread,'新正文').endsWith(footer));
  }
  const custom=note.replace('cssclasses:\n  - codex-conversation','cssclasses: my-class');
  const migrated=c.updateNote(custom,thread,'正文');
  assert.deepEqual(c.parseNote(migrated).doc.toJS().cssclasses,['my-class','codex-conversation']);
  assert.equal(c.updateNote(migrated,thread,'正文'),migrated);
});

test('content dedup keeps every message reference, restart reuses copies with no original reads',async t=>{
  const vault=await testVault(t);const s=imageSnapshot(['/tmp/a.png','/tmp/b.png']);let reads=0;
  const first=await prepareAttachments(vault,s,{}, {readLocal:async()=>{reads++;return png;}});
  assert.equal(reads,2);assert.equal(first.copied,1);assert.equal(Object.keys(first.images).length,2);
  assert.equal(new Set(Object.values(first.images)).size,1);
  const target=Object.values(first.images)[0];assert.match(target,/Attachments\/Codex\/[^/]+\/[a-f0-9]{64}\.png$/);
  assert.deepEqual(await fs.readFile(path.join(vault.root,target)),png);
  const persisted=JSON.parse(JSON.stringify(first.mapping));const writes=vault.writes;
  const again=await prepareAttachments(vault,s,persisted,{readLocal:async()=>{throw Error('must not read missing originals');}});
  assert.equal(again.copied,0);assert.equal(again.missing,0);assert.equal(vault.writes,writes);
  assert.deepEqual(again.images,first.images);
  assert.equal(c.renderTranscript(s.turns,s.entries,again.images).split('![[').length,3);
});

test('first-import missing or unsupported images do not prevent text/daily sync; retry can recover',async t=>{
  const vault=await testVault(t);const s=imageSnapshot(['/tmp/missing.png']);
  const missing=await prepareAttachments(vault,s,{}, {readLocal:async()=>{throw Error('ENOENT');}});
  assert.equal(missing.missing,1);assert.equal(missing.copied,0);
  s.transcript=c.renderTranscript(s.turns,s.entries,missing.images);
  const initial=await c.syncToVault(vault,s);
  const note=vault.getAbstractFileByPath(initial.notePath);
  assert.ok((await vault.read(note)).includes('图片原件暂不可用'));
  assert.ok((await vault.read(note)).includes('看看图片'));
  assert.ok(!(await vault.read(note)).includes('/tmp/missing.png'));
  const unsupported=await prepareAttachments(vault,s,{}, {readLocal:async()=>Buffer.from('<svg>not imported</svg>')});
  assert.equal(unsupported.missing,0);assert.equal(unsupported.unsupported,1);
  s.transcript=c.renderTranscript(s.turns,s.entries,unsupported.images);
  await c.syncToVault(vault,s,{notePath:initial.notePath});
  assert.ok((await vault.read(note)).includes('图片格式不支持'));
  // Once recorded as unsupported, the same source must never be re-read.
  const cachedUnsupported=await prepareAttachments(vault,s,unsupported.mapping,{readLocal:async()=>{throw Error('must not re-read: permanently unsupported');}});
  assert.equal(cachedUnsupported.unsupported,1);assert.equal(cachedUnsupported.missing,0);
  const recovered=await prepareAttachments(vault,s,{}, {readLocal:async()=>png});
  s.transcript=c.renderTranscript(s.turns,s.entries,recovered.images);
  await c.syncToVault(vault,s,{notePath:initial.notePath});
  assert.ok(!(await vault.read(note)).includes('图片原件暂不可用'));
  const writes=vault.writes;await c.syncToVault(vault,s,{notePath:initial.notePath});assert.equal(vault.writes,writes);
  assert.equal(vault.getMarkdownFiles().filter(f=>f.path.startsWith('Codex Conversations/')).length,1);
});

test('ignore active turns and remote/text paths; cached targets cannot escape the thread folder',async t=>{
  const vault=await testVault(t);let reads=0;
  const readLocal=async()=>{reads++;throw Error('missing');};
  const s=imageSnapshot(['/tmp/a.png'],'inProgress');
  await prepareAttachments(vault,s,{}, {readLocal});assert.equal(reads,0);
  s.turns[0].status='completed';
  const key=c.attachmentKey('done',s.entries[0].item,1);
  const result=await prepareAttachments(vault,s,{[key]:{source:localImagePath('/tmp/a.png'),path:'Templates/每日记录.md'}},{readLocal});
  assert.equal(Object.keys(result.images).length,0);assert.equal(reads,1);
  s.entries[0].item.content=[{type:'text',text:'/tmp/a.png'},{type:'image',url:'https://example.com/image.png'}];
  await prepareAttachments(vault,s,{}, {readLocal});assert.equal(reads,1);
  s.entries[0].item.content=[imageInput('/tmp/a.png')];
  await assert.rejects(()=>prepareAttachments(vault,s,{}, {alive:()=>false,readLocal}),/停止/);
  assert.equal(reads,1);
});

const generatedSnapshot=(items,status='completed')=>({thread,turns:[{id:'done',status,startedAt:1789389994,completedAt:1789390155}],entries:[
  entry('ask','userMessage',{content:[{type:'text',text:'生成一张小猫图片'}]}),
  ...items,
]});
const generatedImage=(id,props={})=>entry(id,'imageGeneration',{status:'completed',revisedPrompt:null,result:png.toString('base64'),failure:null,savedPath:`/tmp/generated/${id}.png`,...props});

test('an image Codex generates is copied into the attachments folder and shown under that turn\'s answer',async t=>{
  const vault=await testVault(t);
  const s=generatedSnapshot([generatedImage('gen-1'),entry('reply','agentMessage',{phase:'final_answer',text:'已生成一张小猫图片。'})]);
  const reads=[];
  const assets=await prepareAttachments(vault,s,{}, {readLocal:async p=>{reads.push(p);return png;}});
  assert.deepEqual(reads,['/tmp/generated/gen-1.png']);assert.equal(assets.copied,1);assert.equal(assets.missing,0);
  const key=c.attachmentKey('done',s.entries[1].item,0);
  assert.match(assets.images[key],/Attachments\/Codex\/fixture-main-task\/[a-f0-9]{64}\.png$/);
  assert.equal(assets.mapping[key].source,'/tmp/generated/gen-1.png');
  const md=c.renderTranscript(s.turns,s.entries,assets.images);
  // Exactly one Codex block, text first, image below it.
  assert.equal(md.split('[!codex-answer]').length,2);
  assert.ok(md.indexOf('已生成一张小猫图片。')<md.indexOf(`![[${assets.images[key]}]]`));
  // Restart with the vault copy present: no re-read.
  const again=await prepareAttachments(vault,s,JSON.parse(JSON.stringify(assets.mapping)),{readLocal:async()=>{throw Error('must not re-read');}});
  assert.equal(again.copied,0);assert.deepEqual(again.images,assets.images);
});

test('a generated image falls back to its inline data when Codex\'s own saved copy is gone; with neither it is retried later',async t=>{
  const vault=await testVault(t);
  const s=generatedSnapshot([generatedImage('gen-1'),entry('reply','agentMessage',{phase:'final_answer',text:'图好了'})]);
  const fromInline=await prepareAttachments(vault,s,{}, {readLocal:async()=>{throw Error('ENOENT');}});
  assert.equal(fromInline.copied,1);assert.equal(fromInline.missing,0);
  const target=Object.values(fromInline.images)[0];
  assert.deepEqual(await fs.readFile(path.join(vault.root,target)),png);
  const bare=generatedSnapshot([generatedImage('gen-2',{result:'',savedPath:undefined}),entry('reply','agentMessage',{phase:'final_answer',text:'图好了'})]);
  const none=await prepareAttachments(vault,bare,{}, {readLocal:async()=>{throw Error('ENOENT');}});
  assert.equal(none.missing,1);
  assert.ok(c.renderTranscript(bare.turns,bare.entries,none.images).includes('生成的图片暂不可用'));
});

test('failed or unfinished image generations are ignored; a turn with no written reply still shows its image once',async t=>{
  const vault=await testVault(t);let reads=0;
  const readLocal=async()=>{reads++;return png;};
  const failed=generatedSnapshot([generatedImage('gen-x',{status:'failed',failure:{type:'usageLimitExceeded',limitId:'x',resetsAt:null}}),entry('reply','agentMessage',{phase:'final_answer',text:'额度用完了'})]);
  assert.equal(Object.keys((await prepareAttachments(vault,failed,{}, {readLocal})).images).length,0);
  assert.ok(!c.renderTranscript(failed.turns,failed.entries,{}).includes('生成的图片'));
  const active=generatedSnapshot([generatedImage('gen-y')],'inProgress');
  await prepareAttachments(vault,active,{}, {readLocal});assert.equal(reads,0);
  const silent=generatedSnapshot([generatedImage('gen-z'),generatedImage('gen-z')]);
  const assets=await prepareAttachments(vault,silent,{}, {readLocal});
  const md=c.renderTranscript(silent.turns,silent.entries,assets.images);
  assert.equal(md.split('[!codex-answer]').length,2);assert.equal(md.split('![[').length,2);
});

test('attachment write failure does not reach note replacement',async t=>{
  const vault=await testVault(t);const initial=await c.syncToVault(vault,{thread,transcript:'最后成功版本'});
  const file=vault.getAbstractFileByPath(initial.notePath);const before=await vault.read(file);
  vault.createBinary=async()=>{throw Error('磁盘写入失败');};
  await assert.rejects(async()=>{const s=imageSnapshot(['/tmp/a.png']);const a=await prepareAttachments(vault,s,{}, {readLocal:async()=>png});s.transcript=c.renderTranscript(s.turns,s.entries,a.images);await c.syncToVault(vault,s,{notePath:initial.notePath});},/磁盘/);
  assert.equal(await vault.read(file),before);
});
