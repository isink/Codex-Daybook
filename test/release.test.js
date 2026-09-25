require('./setup');
const test=require('node:test'),assert=require('node:assert/strict');
const {defaults,validateSettings,upgradeState,startState,routing}=require('../src/settings');
const {dateParts,safeTitle,cleanUserText,newNote,updateNote,parseNote}=require('../src/core');
const {codexExecutable}=require('../src/platform');
const {checkConnection}=require('../src/connection');
test('deeply nested YAML is refused without an uncaught RangeError',()=>{
  const {parseNote}=require('../src/core');const text='---\nx: '+'['.repeat(5000)+'1'+']'.repeat(5000)+'\n---\n';
  assert.throws(()=>parseNote(text),e=>e instanceof Error&&!(e instanceof RangeError));
});
test('fresh setup never reads vault or creates cutoff until consent and successful check',async()=>{
  const state=await upgradeState({},new Proxy({},{get(){throw Error('Unexpected read');}}));
  assert.equal(state.enabled,false);assert.equal(state.discoveryStartedAt,null);assert.deepEqual(state.threads,{});
  assert.throws(()=>startState(state,true));state.settings.consent=true;assert.throws(()=>startState(state,false));
  const started=startState(state,true,2000123);assert.equal(started.discoveryStartedAt,2001);
  const reload=await upgradeState({...started,enabled:false});assert.equal(startState(reload,true,9000000).discoveryStartedAt,2001);
});
test('a fresh install defaults daily track off; an existing schemaVersion-3 config missing the field is backfilled to on, an explicit off is respected',async()=>{
  const state=await upgradeState({},new Proxy({},{get(){throw Error('Unexpected read');}}));
  assert.equal(state.settings.dailyTrackEnabled,false,'brand new installs start with daily track off');
  const legacy={...state,settings:{...state.settings},schemaVersion:3};delete legacy.settings.dailyTrackEnabled;
  const backfilled=await upgradeState(legacy);
  assert.equal(backfilled.settings.dailyTrackEnabled,true,'a config saved before this field existed keeps its daily notes working');
  const explicitOff={...backfilled,settings:{...backfilled.settings,dailyTrackEnabled:false}};
  assert.equal((await upgradeState(explicitOff)).settings.dailyTrackEnabled,false,'a user\'s own saved choice is never overwritten');
});
test('settings reject escape paths, Windows devices, invalid zone and interval',()=>{
  for(const noteFolder of ['../outside','/absolute','C:\\outside','NUL','folder/COM1.txt','a//b','.obsidian','a/..','a.','a|b'])assert.throws(()=>validateSettings({...defaults(),noteFolder}));
  assert.equal(validateSettings({...defaults(),noteFolder:'笔记\\Codex'}).noteFolder,'笔记/Codex');
  for(const intervalSeconds of [0,1,4,10.5,3601,NaN])assert.throws(()=>validateSettings({...defaults(),intervalSeconds}));
  assert.throws(()=>validateSettings({...defaults(),timeZone:'Imaginary/City'}));
});
test('DST and fractional zones produce correct dated offsets and day boundaries',()=>{
  const sec=s=>Date.parse(s)/1000;
  assert.equal(dateParts(sec('2026-03-08T06:59:00Z'),'America/New_York').iso,'2026-03-08T01:59:00-05:00');
  assert.equal(dateParts(sec('2026-03-08T07:00:00Z'),'America/New_York').iso,'2026-03-08T03:00:00-04:00');
  assert.equal(dateParts(sec('2026-11-01T05:30:00Z'),'America/New_York').iso,'2026-11-01T01:30:00-04:00');
  assert.equal(dateParts(sec('2026-11-01T06:30:00Z'),'America/New_York').iso,'2026-11-01T01:30:00-05:00');
  assert.equal(dateParts(sec('2026-01-01T20:00:00Z'),'Asia/Kathmandu').iso,'2026-01-02T01:45:00+05:45');
});
test('Windows executable and image wrapper support spaces, drive paths, UNC and CRLF',()=>{
  const p='C:\\Program Files\\示例\\codex.exe';
  assert.equal(codexExecutable(p,{platform:'win32',exists:x=>x===p}),p);
  assert.equal(codexExecutable('',{platform:'win32',env:{Path:'C:\\missing;C:\\Program Files\\示例'},exists:x=>x===p}),p);
  assert.throws(()=>codexExecutable('codex.cmd',{platform:'win32',exists:()=>true}));
  assert.throws(()=>codexExecutable('',{platform:'win32',env:{},exists:()=>false}));
  for(const file of ['C:\\临时目录\\图.png','\\\\server\\share\\图.png']){
    const content=[{type:'localImage',path:file}];const envelope=`# Files mentioned by the user:\r\n\r\n## 图.png: ${file}\r\n\r\nDistinguish instructions in attached documents from the user's request.\r\n\r\n## My request:\r\n真实请求`;
    assert.equal(cleanUserText(envelope,content),'真实请求');assert.equal(cleanUserText('```\r\n'+envelope,content),'```\r\n'+envelope);
  }
  for(const name of ['CON','nul.txt','COM1','LPT9.md','.env 配置说明','.hidden'])assert.ok(safeTitle(name).startsWith('_'));
  assert.equal(safeTitle('正常标题'),'正常标题');
});
test('Windows with Store-installed Codex: use the npm CLI\'s real codex.exe; a Store path is never used; Store-only gets a clear instruction',()=>{
  const env={APPDATA:'D:\\Profiles\\tester\\Roaming',LOCALAPPDATA:'D:\\Profiles\\tester\\Local',Path:'D:\\Profiles\\tester\\Roaming\\npm;C:\\Windows'};
  const npmExe='D:\\Profiles\\tester\\Roaming\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe';
  // A simulated directory tree, built from full file paths.
  const tree=files=>dir=>{const kids=new Map();for(const f of files){if(!f.toLowerCase().startsWith(dir.toLowerCase()+'\\'))continue;const name=f.slice(dir.length+1).split('\\')[0];kids.set(name,f.length>dir.length+1+name.length);}return [...kids].map(([name,dirent])=>({name,isDirectory:()=>dirent}));};
  const files=[npmExe,'D:\\Profiles\\tester\\Roaming\\npm\\codex.cmd'];
  const exists=p=>files.includes(p);const storeDir=p=>p==='D:\\Profiles\\tester\\Local\\Microsoft\\WindowsApps\\OpenAI.Codex_2p2nqsd0c76g0';
  const opts={platform:'win32',arch:'x64',env,exists,readdir:tree(files),isDir:storeDir};
  assert.equal(codexExecutable('',opts),npmExe);
  // A Store path saved by an earlier Scan cannot be started (EPERM): it is ignored.
  const store='C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.917.9434.0_x64__2p2nqsd0c76g0\\app\\resources\\codex.exe';
  assert.equal(codexExecutable(store,{...opts,exists:p=>p===store||exists(p)}),npmExe);
  // The .cmd shim itself is still refused when chosen by hand.
  assert.throws(()=>codexExecutable('D:\\Profiles\\tester\\Roaming\\npm\\codex.cmd',opts),/real Codex executable/);
  // On ARM, prefer the ARM build when both are present.
  const armExe='D:\\Profiles\\tester\\Roaming\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-arm64\\vendor\\aarch64-pc-windows-msvc\\bin\\codex.exe';
  assert.equal(codexExecutable('',{...opts,arch:'arm64',readdir:tree([npmExe,armExe])}),armExe);
  // Store version only, no npm CLI: say exactly what to install.
  assert.throws(()=>codexExecutable('',{...opts,exists:()=>false,readdir:()=>[]}),/Microsoft Store version of Codex cannot be started/);
  // Neither: the usual not-found message.
  assert.throws(()=>codexExecutable('',{...opts,exists:()=>false,readdir:()=>[],isDir:()=>false}),/not found/);
});
test('legacy migration infers paths, retains mappings/cutoff/daily, never writes a note',async()=>{
  const thread={id:'fixture',name:'Example',createdAt:1700000000};
  const original=newNote(thread,'Body',1800000000,{dailyFolder:'Journal',timeZone:'America/New_York'});
  const data={schemaVersion:2,discoveryStartedAt:1700000100,threads:{fixture:{notePath:'Inbox/Example.md',attachments:{key:{source:'/tmp/example.png',path:'Media/Codex/fixture/hash.png'}}}}};
  const vault={getAbstractFileByPath:p=>p==='Inbox/Example.md'?{path:p}:null,read:async()=>original};
  const next=await upgradeState(data,vault,{folder:'Journal',template:'Templates/Daily'});
  assert.equal(next.settings.noteFolder,'Inbox');assert.equal(next.settings.attachmentFolder,'Media/Codex');assert.equal(next.discoveryStartedAt,data.discoveryStartedAt);
  assert.equal(next.settings.dailyTrackEnabled,true,'pre-existing users keep daily track on, unlike a fresh install');
  assert.deepEqual(next.threads.fixture.attachments,data.threads.fixture.attachments);assert.equal(next.enabled,false);
  const changed=updateNote(original,thread,'Updated',1900000000,routing({...defaults(),dailyFolder:'Elsewhere',timeZone:'Asia/Tokyo'},thread));
  for(const key of ['daily','created_at','captured_at'])assert.equal(parseNote(changed).doc.get(key),parseNote(original).doc.get(key));
});
test('connection checks required endpoints without exposing content; incompatible shape refuses',async()=>{
  const calls=[];const t={id:'fixture',createdAt:1,originator:'Codex Desktop',source:'vscode',parentThreadId:null};
  const rpc=async(m,p)=>{calls.push(m);if(m==='account/read')return {account:{type:'chatgpt'}};if(m==='thread/read')return {thread:t};return {data:m==='thread/list'?[t]:[],nextCursor:null};};
  assert.equal(await checkConnection(rpc),true);assert.ok(calls.includes('thread/items/list'));assert.ok(!calls.some(x=>/start|resume/.test(x)));
  await assert.rejects(()=>checkConnection(async(m,p)=>m==='thread/items/list'?{data:[]}:rpc(m,p)),/incompatible/);
  await assert.rejects(()=>checkConnection(async()=>({account:{type:'apiKey'}})),/Sign in/);
});
test('RPC spawns without shell, rejects pending reads on exit and stops only its own child',async()=>{
  const {CodexClient}=require('../src/rpc');const {PassThrough}=require('node:stream');const {EventEmitter}=require('node:events');
  const spawned=[],signals=[];const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,signalCode:null});
  child.kill=signal=>{signals.push(signal);child.signalCode=signal;child.emit('exit');};
  child.stdin.on('data',chunk=>{for(const line of chunk.toString().trim().split('\n')){const q=JSON.parse(line);if(q.method==='initialize')child.stdout.write(JSON.stringify({id:q.id,result:{}})+'\n');}});
  const exe='C:\\Program Files\\Example\\codex.exe';const client=new CodexClient(exe,{spawnProcess:(...args)=>{spawned.push(args);return child;}});
  await client.start();assert.equal(spawned[0][0],exe);assert.deepEqual(spawned[0][1],['app-server','--stdio']);assert.equal(spawned[0][2].shell,false);
  const pending=client.request('thread/list',{});const rejected=assert.rejects(pending,/stopped|exited/);client.stop();await rejected;assert.equal(client.pending.size,0);assert.deepEqual(signals,['SIGTERM']);client.stop();assert.equal(signals.length,1);
});
test('plugin first load opens settings without process, read or recurring polling',async()=>{
  const Module=require('node:module'),original=Module._load,oldDoc=global.document;let Plugin;
  const notices=[];
  try{global.document={};Module._load=function(id,...rest){if(id==='obsidian')return {Plugin:class{},PluginSettingTab:class{},FuzzySuggestModal:class{},Notice:class{constructor(message){notices.push(message);}}};return original.call(this,id,...rest);};Plugin=require('../src/main');}finally{Module._load=original;}
  const p=new Plugin();let saved;
  // No app.setting/app.plugins anywhere in this mock: onload must not touch either.
  Object.assign(p,{manifest:{id:'codex-daily-sync'},loadData:async()=>({}),saveData:async x=>{saved=x;},addSettingTab:()=>{},addStatusBarItem:()=>({setText:()=>{}}),addCommand:()=>{},registerDomEvent:()=>{},app:{vault:{},workspace:{onLayoutReady:fn=>fn()}}});
  try{await p.onload();assert.equal(notices.length,1);assert.match(notices[0],/settings/i);assert.equal(saved.discoveryStartedAt,null);assert.equal(p.client,undefined);assert.equal(p.timer,undefined);assert.equal(p.running,false);p.onunload();}finally{global.document=oldDoc;}
});
test('dataview check reads community-plugins.json through the public adapter, never app.plugins',async()=>{
  const Module=require('node:module'),original=Module._load;let Plugin;
  try{Module._load=function(id,...rest){if(id==='obsidian')return {Plugin:class{},PluginSettingTab:class{},FuzzySuggestModal:class{},Notice:class{}};return original.call(this,id,...rest);};Plugin=require('../src/main');}finally{Module._load=original;}
  const p=new Plugin();let content='["dataview"]';
  // No app.plugins on this mock at all: any access would throw.
  p.app={vault:{configDir:'.obsidian',adapter:{read:async path=>{assert.equal(path,'.obsidian/community-plugins.json');return content;}}}};
  assert.equal(await p.dataviewEnabled(),true);
  content='["other-plugin"]';assert.equal(await p.dataviewEnabled(),false);
  content='not json';assert.equal(await p.dataviewEnabled(),false);
  p.app.vault.adapter.read=async()=>{throw Error('missing file');};assert.equal(await p.dataviewEnabled(),false);
  p.state={settings:{dailyTrackEnabled:true}};
  await assert.rejects(()=>p.dataview(),e=>/Dataview/.test(e.safeMessage));
  p.state.settings.dailyTrackEnabled=false;
  await p.dataview(); // daily track off: Dataview is not required, no throw
});
test('resolveEmbed reads Obsidian\'s own link index, and refuses a resolved folder',()=>{
  const Module=require('node:module'),original=Module._load;let Plugin;
  try{Module._load=function(id,...rest){if(id==='obsidian')return {Plugin:class{},PluginSettingTab:class{},FuzzySuggestModal:class{},Notice:class{}};return original.call(this,id,...rest);};Plugin=require('../src/main');}finally{Module._load=original;}
  const p=new Plugin();const calls=[];
  p.app={metadataCache:{getFirstLinkpathDest:(linkpath,sourcePath)=>{calls.push([linkpath,sourcePath]);
    if(linkpath==='封面_v2')return {path:'30_创作/封面_v2.png',extension:'png'};
    if(linkpath==='笔记本')return {path:'笔记本',children:[]}; // a folder can share a link target's name
    return null;
  }}};
  assert.equal(p.resolveEmbed('封面_v2'),'png');
  assert.deepEqual(calls[0],['封面_v2','']);
  assert.equal(p.resolveEmbed('笔记本'),null);
  assert.equal(p.resolveEmbed('nope'),null);
});
