require('./setup');
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const {defaults,validateSettings,QUERY}=require('../src/settings');

// Minimal DOM + Obsidian Setting/Component shim: only what SyncSettings.display()
// in src/main.js actually calls. querySelectorAll only supports the exact
// `tag[type=value]` selectors the source itself uses.
class FakeEl {
  constructor(tag,opts={}){
    this.tag=tag;this.children=[];this.style={};this.attrs={...(opts.attr||{})};
    if(opts.type!==undefined)this.attrs.type=opts.type;
    this.text=opts.text||'';this.value='';this.cls=opts.cls||'';
  }
  createEl(tag,opts={}){const el=new FakeEl(tag,opts);el.parent=this;this.children.push(el);return el;}
  setText(text){this.text=text;return this;}
  get textContent(){return this.text;}
  empty(){this.children=[];this.settings=[];return this;}
  querySelectorAll(selector){
    const m=/^(\w+)\[type=(\w+)\]$/.exec(selector);
    if(!m)throw Error('unsupported selector in test shim: '+selector);
    const results=[];
    const walk=el=>{for(const child of el.children){if(child.tag===m[1]&&child.attrs.type===m[2])results.push(child);walk(child);}};
    walk(this);
    return results;
  }
  setAttribute(name,value){this.attrs[name]=String(value);}
  remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  click(){this.clickCount=(this.clickCount||0)+1;}
}
class FakeTextComponent {
  constructor(containerEl){this.el=containerEl.createEl('input',{type:'text'});this.inputEl=this.el;this.changeHandlers=[];}
  setValue(v){this.el.value=v;return this;}
  onChange(fn){this.changeHandlers.push(fn);return this;}
  get value(){return this.el.value;}
  async type(v){this.el.value=v;for(const fn of this.changeHandlers)await fn(v);}
}
class FakeDropdownComponent {
  constructor(){this.options={};}
  addOption(value,label){this.options[value]=label;return this;}
  setValue(value){this.value=value;return this;}
  onChange(fn){this.change=fn;return this;}
  async select(value){this.value=value;await this.change(value);}
}
class FakeToggleComponent {
  constructor(){this.val=false;this.changeHandlers=[];}
  setValue(v){this.val=v;return this;}
  onChange(fn){this.changeHandlers.push(fn);return this;}
  async toggle(v){this.val=v;for(const fn of this.changeHandlers)await fn(v);}
}
class FakeButtonComponent {
  constructor(){this.label='';this.disabled=false;this.clickHandlers=[];}
  setButtonText(t){this.label=t;return this;}
  onClick(fn){this.clickHandlers.push(fn);return this;}
  setDisabled(v){this.disabled=v;return this;}
  async press(){for(const fn of this.clickHandlers)await fn();}
}
class FakeSetting {
  constructor(containerEl){this.containerEl=containerEl;this.name='';this.heading=false;this.components=[];(containerEl.settings=containerEl.settings||[]).push(this);}
  setName(name){this.name=name;return this;}
  setDesc(desc){this.desc=desc;return this;}
  setHeading(){this.heading=true;return this;}
  addText(cb){const t=new FakeTextComponent(this.containerEl);this.components.push(t);cb(t);return this;}
  addDropdown(cb){const d=new FakeDropdownComponent();this.components.push(d);cb(d);return this;}
  addToggle(cb){const t=new FakeToggleComponent();this.components.push(t);cb(t);return this;}
  addButton(cb){const b=new FakeButtonComponent();this.components.push(b);cb(b);return this;}
}
function allSettings(c){return [...(c.settings||[]),...c.children.flatMap(allSettings)];}
function findButton(c,label){
  for(const s of allSettings(c))for(const comp of s.components)if(comp instanceof FakeButtonComponent&&comp.label===label)return comp;
  throw Error('button not found: '+label);
}
function textComponents(c){return [...(c.children.find(x=>x.tag==='details')?.settings||[]),...(c.settings||[])].map(s=>s.components.find(x=>x instanceof FakeTextComponent)).filter(Boolean);}
function statusMessage(c){return c.children.find(el=>el.tag==='p'&&(el.text==='Syncing'||el.text==='Paused — awaiting setup'));}

// Load src/main.js exactly once, with a full obsidian mock (including Setting,
// which earlier tests in this repo never needed since none of them call
// display()). Module caching means only the FIRST require('../src/main') in
// this process actually consults Module._load, so this must run before any
// test() body — everything below reuses this one cached class.
const PluginClass=(()=>{
  const original=Module._load;let Plugin;
  try{
    Module._load=function(id,...args){if(id==='obsidian')return {Plugin:class{},PluginSettingTab:class{constructor(app,plugin){this.app=app;this.plugin=plugin;}update(){this.display();}},FuzzySuggestModal:class{},Notice:class{},Setting:FakeSetting};return original.call(this,id,...args);};
    Plugin=require('../src/main');
  }finally{Module._load=original;}
  return Plugin;
})();

// Runs onload() with a schemaVersion:3 state supplied directly (upgradeState
// returns it untouched, so no vault access is needed), captures the real
// SyncSettings instance via addSettingTab, and attaches a fresh fake DOM root.
async function buildTab(stateOverrides={},vaultOverrides={}){
  const plugin=new PluginClass();
  let tab;
  const state={schemaVersion:3,settings:validateSettings(defaults()),threads:{},discoveryStartedAt:null,enabled:false,migrationWarnings:[],...stateOverrides};
  const oldDoc=global.document;global.document={};
  try{
    Object.assign(plugin,{
      manifest:{id:'codex-daily-sync',name:'Codex Daybook'},loadData:async()=>state,saveData:async()=>{},
      addSettingTab:t=>{tab=t;},addStatusBarItem:()=>({setText:()=>{}}),addCommand:command=>({...command,name:'Codex Daybook: '+command.name}),registerDomEvent:()=>{},
      app:{vault:{getAllFolders:()=>vaultOverrides.folders||[],getMarkdownFiles:()=>vaultOverrides.markdownFiles||[]},workspace:{onLayoutReady:fn=>fn()}},
    });
    await plugin.onload();
  }finally{global.document=oldDoc;}
  tab.containerEl=new FakeEl('div');
  return {plugin,tab};
}

test('renders both headings, migration warnings and the running/paused status message',async()=>{
  const {tab}=await buildTab({enabled:true,discoveryStartedAt:1700000000,migrationWarnings:['Confirm the time zone for new tasks.'],settings:{...validateSettings(defaults()),consent:true}});
  tab.display();
  const c=tab.containerEl;
  assert.deepEqual(c.settings.filter(s=>s.heading).map(s=>s.name),['Codex Daybook · 0.5.7 (release candidate)','Conversation list for daily notes']);
  const paragraphs=c.children.filter(el=>el.tag==='p');
  assert.ok(paragraphs.some(el=>el.text==='Confirm the time zone for new tasks.'&&el.cls.includes('is-warning')));
  assert.ok(paragraphs.some(el=>el.text==='Syncing'));
});

test('renders the Dataview query textarea read-only with the exact query text',async()=>{
  const {tab}=await buildTab();
  tab.display();
  const textarea=tab.containerEl.children.find(el=>el.tag==='textarea');
  assert.equal(textarea.text,QUERY);
  assert.equal(textarea.attrs.readonly,'true');
  assert.equal(textarea.cls,'codex-daybook-query');
});

test('text fields initialize from settings and flow into the draft; interval coerces to Number',async()=>{
  const {plugin,tab}=await buildTab();
  tab.display();
  const c=tab.containerEl;
  const fields=textComponents(c); // executable, noteFolder, attachmentFolder, dailyFolder, dailyTemplate, timeZone, intervalSeconds
  assert.equal(fields.length,7);
  assert.equal(fields[1].value,'Codex Conversations');
  assert.equal(fields[6].value,'10');
  await fields[1].type('New Folder');
  await fields[6].type('30');
  let captured;plugin.configure=async d=>{captured=d;};
  await findButton(c,'Save settings').press();
  assert.equal(captured.noteFolder,'New Folder');
  assert.equal(captured.intervalSeconds,30);assert.equal(typeof captured.intervalSeconds,'number');
});

test('folder fields suggest existing vault folders and still accept a new path',async()=>{
  const {tab}=await buildTab({}, {folders:[{path:'90_Templates'},{path:'00_Inbox'},{path:'90_Templates/Daily'},{path:''},{path:'00_Inbox'}]});
  tab.display();
  const lists=tab.containerEl.children.filter(el=>el.tag==='datalist');
  assert.equal(lists.length,3);
  assert.deepEqual(lists.map(list=>list.children.map(option=>option.attrs.value)),[
    ['00_Inbox','90_Templates','90_Templates/Daily'],
    ['00_Inbox','90_Templates','90_Templates/Daily'],
    ['00_Inbox','90_Templates','90_Templates/Daily']
  ]);
  const fields=textComponents(tab.containerEl);
  assert.equal(fields[1].inputEl.attrs.list,'codex-daybook-folder-noteFolder');
  assert.equal(fields[2].inputEl.attrs.list,'codex-daybook-folder-attachmentFolder');
  assert.equal(fields[3].inputEl.attrs.list,'codex-daybook-folder-dailyFolder');
  assert.equal(fields[4].inputEl.attrs.list,undefined);
  await fields[1].type('New Folder');
  assert.equal(fields[1].value,'New Folder');
});

test('daily template suggests Markdown files and exposes a template chooser',async()=>{
  const {tab}=await buildTab({}, {markdownFiles:[{path:'90_Templates/Daily.md'},{path:'90_Templates/Meeting.md'},{path:'Notes.txt'},{path:'90_Templates/Daily.md'}]});
  tab.display();
  const list=tab.containerEl.children.find(el=>el.attrs.id==='codex-daybook-template-dailyTemplate');
  assert.deepEqual(list.children.map(option=>option.attrs.value),['90_Templates/Daily.md','90_Templates/Meeting.md']);
  assert.equal(textComponents(tab.containerEl)[4].inputEl.attrs.list,'codex-daybook-template-dailyTemplate');
  assert.equal(findButton(tab.containerEl,'Choose template…').disabled,false);
});

test('consent toggle initializes from settings and flows into the draft',async()=>{
  const {plugin,tab}=await buildTab();
  tab.display();
  const c=tab.containerEl;
  const toggle=c.settings.flatMap(s=>s.components).find(x=>x instanceof FakeToggleComponent);
  assert.equal(toggle.val,false);
  await toggle.toggle(true);
  let captured;plugin.configure=async d=>{captured=d;};
  await findButton(c,'Save settings').press();
  assert.equal(captured.consent,true);
});

test('executable file picker: a selected file updates the draft and the executable field, and removes the hidden input',async()=>{
  const {plugin,tab}=await buildTab();
  tab.display();
  const c=tab.containerEl;
  await findButton(c,'Browse…').press();
  const fileInputs=c.querySelectorAll('input[type=file]');
  assert.equal(fileInputs.length,1);
  const input=fileInputs[0];
  assert.equal(input.cls,'codex-daybook-file-picker');
  input.files=[{path:'/opt/homebrew/bin/codex'}];
  input.onchange();
  assert.equal(input.removed,true);
  assert.equal(c.querySelectorAll('input[type=text]')[0].value,'/opt/homebrew/bin/codex');
  let captured;plugin.configure=async d=>{captured=d;};
  await findButton(c,'Save settings').press();
  assert.equal(captured.executable,'/opt/homebrew/bin/codex');
});

test('executable file picker falls back to electron.webUtils.getPathForFile when file.path is absent',async()=>{
  const {tab}=await buildTab();
  tab.display();
  const c=tab.containerEl;
  await findButton(c,'Browse…').press();
  const input=c.querySelectorAll('input[type=file]')[0];
  input.files=[{}]; // no .path, as when Electron's classic File.path extension is unavailable
  const original=Module._load;
  try{
    Module._load=function(id,...args){if(id==='electron')return {webUtils:{getPathForFile:()=>'/resolved/from/webUtils'}};return original.call(this,id,...args);};
    input.onchange();
  }finally{Module._load=original;}
  assert.equal(c.querySelectorAll('input[type=text]')[0].value,'/resolved/from/webUtils');
});

test('cancelling the file picker removes the hidden input',async()=>{
  const {tab}=await buildTab();tab.display();const c=tab.containerEl;
  await findButton(c,'Browse…').press();
  const input=c.querySelectorAll('input[type=file]')[0];input.oncancel();
  assert.equal(input.removed,true);assert.equal(c.querySelectorAll('input[type=file]').length,0);
});

test('Save settings saves the current draft and shows the standard confirmation',async()=>{
  const {plugin,tab}=await buildTab();
  tab.display();
  const c=tab.containerEl,message=statusMessage(c);
  let captured;plugin.configure=async d=>{captured=d;};
  await findButton(c,'Save settings').press();
  assert.ok(captured);
  assert.equal(tab.containerEl.children.find(el=>el.text==='Settings saved. Sync is paused — check the connection to start.').text,'Settings saved. Sync is paused — check the connection to start.');
});

test('Check connection saves the draft, then connects, in order, and shows the connection diagnostic',async()=>{
  const {plugin,tab}=await buildTab();
  tab.display();
  const c=tab.containerEl,message=statusMessage(c);
  const order=[];
  plugin.configure=async()=>{order.push('configure');};
  plugin.connect=async()=>{order.push('connect');plugin.diagnostic='Connection verified';};
  await findButton(c,'Check connection').press();
  assert.deepEqual(order,['configure','connect']);
  assert.equal(message.text,'Connection verified');
});

test('Start sync refuses without calling begin() when the draft was never saved',async()=>{
  const {plugin,tab}=await buildTab();
  tab.display();
  const c=tab.containerEl,message=statusMessage(c);
  await textComponents(c)[1].type('Unsaved Folder'); // mutate the draft without clicking Save settings
  let beginCalled=false;plugin.begin=async()=>{beginCalled=true;};
  await findButton(c,'Start sync').press();
  assert.equal(beginCalled,false);
  assert.equal(message.text,'Settings not saved yet — check the connection first.');
});

test('Start sync calls begin() once the draft matches the saved, validated settings',async()=>{
  const {plugin,tab}=await buildTab();
  tab.display();
  const c=tab.containerEl,message=statusMessage(c);
  let beginCalled=false;plugin.begin=async()=>{beginCalled=true;plugin.diagnostic='Sync started';};
  await findButton(c,'Start sync').press();
  assert.equal(beginCalled,true);
  assert.equal(message.text,'Sync started');
});

test('Pause sync calls pause()',async()=>{
  const {plugin,tab}=await buildTab();
  tab.display();
  const c=tab.containerEl,message=statusMessage(c);
  let paused=false;plugin.pause=async()=>{paused=true;plugin.diagnostic='Paused';};
  await findButton(c,'Pause sync').press();
  assert.equal(paused,true);
  assert.equal(message.text,'Paused');
});

test('a rejected action with a safeMessage shows it verbatim; one without falls back to the generic notice; the button always re-enables',async()=>{
  const {plugin,tab}=await buildTab();
  tab.display();
  const c=tab.containerEl,message=statusMessage(c);
  const button=findButton(c,'Save settings');
  const disabledLog=[];const setDisabled=button.setDisabled.bind(button);button.setDisabled=v=>{disabledLog.push(v);return setDisabled(v);};

  plugin.configure=async()=>{throw {safeMessage:'The check interval must be a whole number of seconds, 5–3600.'};};
  await button.press();
  assert.equal(message.text,'The check interval must be a whole number of seconds, 5–3600.');
  assert.deepEqual(disabledLog,[true,false]);

  disabledLog.length=0;
  plugin.configure=async()=>{throw Error('boom, no safeMessage');};
  await button.press();
  assert.equal(message.text,'Action failed — check your settings, Codex login and version. Local copies are kept.');
  assert.deepEqual(disabledLog,[true,false]);
});

test('Copy query confirms success rather than displaying stale sync status',async()=>{
  const {plugin,tab}=await buildTab();
  tab.display();
  const c=tab.containerEl,message=statusMessage(c);
  plugin.diagnostic='Sync started. The fixed starting point has been saved.'; // leftover from an earlier, unrelated action
  // Node's global `navigator` is a getter-only accessor; a plain assignment
  // silently no-ops (sloppy mode) rather than shadowing it, so it must be
  // replaced with defineProperty and restored the same way.
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');let copied;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>{copied=text;}}}});
  try{await findButton(c,'Copy query').press();}finally{Object.defineProperty(globalThis,'navigator',original);}
  assert.equal(copied,QUERY);
  assert.equal(message.text,'Query copied to clipboard.');
});

test('Chinese selection saves with the draft, refreshes the UI and commands, and persists across reload',async()=>{
  const {plugin,tab}=await buildTab();tab.display();const c=tab.containerEl;
  const dropdown=c.settings.flatMap(s=>s.components).find(x=>x instanceof FakeDropdownComponent);
  assert.deepEqual(dropdown.options,{zh:'简体中文',en:'English'});
  await textComponents(c)[1].type('Custom Notes');await dropdown.select('zh');
  assert.equal(plugin.state.settings.language,'en','selection alone is not saved');
  let stored;plugin.saveData=async state=>{stored=JSON.parse(JSON.stringify(state));};
  await findButton(c,'Save settings').press();
  assert.equal(stored.settings.language,'zh');assert.equal(stored.settings.noteFolder,'Custom Notes');
  assert.ok(c.settings.some(s=>s.name==='语言'));
  assert.ok(c.children.some(el=>el.text==='设置已保存，同步已暂停。请先检查连接，再开始同步。'));
  assert.equal(plugin.localizedCommands[0][0].name,'Codex Daybook: 立即同步已加入的任务');
  const reloaded=await buildTab(stored);reloaded.tab.display();
  assert.ok(reloaded.tab.containerEl.settings.some(s=>s.name==='语言'));
  const picker=reloaded.tab.containerEl.settings.flatMap(s=>s.components).find(x=>x instanceof FakeDropdownComponent);
  await picker.select('en');await findButton(reloaded.tab.containerEl,'保存设置').press();
  assert.ok(reloaded.tab.containerEl.settings.some(s=>s.name==='Language'));
  assert.equal(reloaded.plugin.localizedCommands[0][0].name,'Codex Daybook: Sync enrolled tasks now');
  assert.equal(reloaded.plugin.state.settings.noteFolder,'Custom Notes');
});

test('Chinese setting validation and connection gate show translated errors',async()=>{
  const {plugin,tab}=await buildTab({settings:{...defaults(),language:'zh'}});tab.display();
  const c=tab.containerEl;await textComponents(c)[6].type('2');
  await findButton(c,'保存设置').press();
  assert.ok(c.children.some(el=>el.text==='检查间隔必须是 5–3600 之间的整数秒。'));
  await assert.rejects(()=>plugin.connect(),e=>e.safeMessage==='请先确认库外访问权限并保存设置。');
});

test('language save failure keeps the saved language and sync mappings unchanged',async()=>{
  const {plugin,tab}=await buildTab();tab.display();const c=tab.containerEl;
  const before=JSON.stringify(plugin.state);
  await c.settings.flatMap(s=>s.components).find(x=>x instanceof FakeDropdownComponent).select('zh');
  plugin.saveData=async()=>{throw Error('disk full');};
  await findButton(c,'Save settings').press();assert.equal(JSON.stringify(plugin.state),before);
  assert.ok(c.settings.some(s=>s.name==='Language'));
});

test('login controls are visible and the executable picker is inside collapsed advanced settings',async()=>{
  const {tab}=await buildTab();tab.display();const c=tab.containerEl;
  assert.ok(findButton(c,'Log in to Codex'));assert.ok(findButton(c,'Cancel login'));
  const details=c.children.find(x=>x.tag==='details');assert.ok(details);assert.equal(details.attrs.open,undefined);
  assert.ok(details.settings.some(s=>s.name==='Codex executable'));
});
test('login reuses an existing ChatGPT account without starting OAuth or importing notes',async()=>{
  const {plugin}=await buildTab({settings:{...defaults(),consent:true}});const before=JSON.stringify(plugin.state);const methods=[];let opened=0,stopped=0;
  plugin.createClient=()=>({start:async()=>{},request:async method=>{methods.push(method);return {account:{type:'chatgpt'}};},stop:()=>{stopped++;}});
  plugin.openLoginUrl=()=>{opened++;};
  // Avoid host-specific executable detection while testing controller behavior.
  plugin.state.settings.executable=process.execPath;
  const initial=JSON.stringify(plugin.state);
  await plugin.login();assert.deepEqual(methods,['account/read']);assert.equal(opened,0);assert.equal(stopped,1);
  assert.equal(JSON.stringify(plugin.state),initial);assert.match(plugin.diagnostic,/Already logged in/);assert.ok(before);
});
test('login consent gate never launches Codex or opens a browser',async()=>{
  const {plugin}=await buildTab();let calls=0;plugin.createClient=()=>{calls++;};plugin.openLoginUrl=()=>{calls++;};
  await assert.rejects(()=>plugin.login(),e=>/Confirm outside-vault access/.test(e.safeMessage));assert.equal(calls,0);
});
test('unsigned account opens the official flow and updates status on completion without starting sync',async()=>{
  const {plugin,tab}=await buildTab({settings:{...defaults(),executable:process.execPath,consent:true}});tab.display();
  let notify,accountReads=0;const calls=[],opened=[];
  const client={closed:false,start:async()=>{},stop(){this.closed=true;},onNotification(fn){notify=fn;return ()=>{};},onClose(){return ()=>{};},request:async method=>{
    calls.push(method);if(method==='account/read')return {account:++accountReads===1?null:{type:'chatgpt'}};
    if(method==='account/login/start')return {type:'chatgpt',loginId:'fixture-login',authUrl:'https://auth.openai.com/oauth/authorize?state=fictional'};
    throw Error('Unexpected RPC');
  }};
  plugin.createClient=()=>client;plugin.openLoginUrl=async url=>{opened.push(url);};
  const before=JSON.stringify(plugin.state);await plugin.login();assert.equal(opened.length,1);assert.match(plugin.authMessageEl.text,/Finish signing in/);
  notify('account/login/completed',{loginId:'fixture-login',success:true});await new Promise(resolve=>setImmediate(resolve));
  assert.match(plugin.authMessageEl.text,/Login completed/);assert.equal(plugin.running,false);assert.equal(plugin.checked,false);
  assert.equal(JSON.stringify(plugin.state),before);assert.deepEqual(calls,['account/read','account/login/start','account/read']);assert.equal(client.closed,true);
});
