require('./setup');
const test=require('node:test');
const assert=require('node:assert/strict');
const {handleThumbnailClick}=require('../src/thumbnails');

function fixture({inside=true,path='Attachments/Codex/task/saved.png',exists=true}={}) {
  const calls=[];
  const embed={getAttribute:name=>name==='src'?path:null};
  const img={closest:selector=>selector==='img'?img:selector==='.internal-embed.image-embed'?embed:inside?{}:null};
  const event={button:0,target:img,preventDefault:()=>calls.push('prevent'),stopImmediatePropagation:()=>calls.push('stop')};
  const app={vault:{getAbstractFileByPath:p=>exists?{path:p}:null},workspace:{getLeaf:kind=>{calls.push(kind);return {openFile:file=>{calls.push(file.path);return Promise.resolve();}};}}};
  return {event,app,calls,mapping:{key:{path:'Attachments/Codex/task/saved.png'}}};
}
test('plain thumbnail click opens exactly one new image tab and prevents native edit/click handlers',()=>{
  const f=fixture();assert.equal(handleThumbnailClick(f.event,f.app,f.mapping),true);
  assert.deepEqual(f.calls,['prevent','stop','tab','Attachments/Codex/task/saved.png']);
});
test('unrelated notes, non-images, unmapped/remote/missing attachments and modified clicks are untouched',()=>{
  for(const options of [{inside:false},{path:'https://example.com/image.png'},{path:'other/image.png'},{exists:false}]){
    const f=fixture(options);assert.equal(handleThumbnailClick(f.event,f.app,f.mapping),false);assert.deepEqual(f.calls,[]);
  }
  for(const override of [{button:1},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{target:{}},{target:null}]){
    const f=fixture();Object.assign(f.event,override);assert.equal(handleThumbnailClick(f.event,f.app,f.mapping),false);assert.deepEqual(f.calls,[]);
  }
});
test('opening failure is reported without an unhandled rejection',async()=>{
  const f=fixture();const errors=[];
  f.app.workspace.getLeaf=()=>({openFile:()=>Promise.reject(Error('unavailable'))});
  assert.equal(handleThumbnailClick(f.event,f.app,f.mapping,e=>errors.push(e.message)),true);
  await Promise.resolve();assert.deepEqual(errors,['unavailable']);
});

test('plugin registers a managed capture listener and stopped callbacks cannot open tabs',async()=>{
  const Module=require('node:module');const original=Module._load;const previousDocument=global.document;
  try {
    global.document={};
    Module._load=function(id,...args){if(id==='obsidian')return {Plugin:class {},PluginSettingTab:class {},FuzzySuggestModal:class {},Notice:class {}};return original.call(this,id,...args);};
    const Plugin=require('../src/main');const plugin=new Plugin();const f=fixture();let registration;
    plugin.loadData=async()=>({});plugin.addSettingTab=()=>{};
    plugin.saveData=async()=>{};
    plugin.registerDomEvent=(...args)=>{registration=args;};
    plugin.addStatusBarItem=()=>({setText:()=>{}});plugin.addCommand=()=>{};
    plugin.app={...f.app,workspace:{...f.app.workspace,onLayoutReady:()=>{}}};
    await plugin.onload();
    assert.equal(registration[0],global.document);assert.equal(registration[1],'click');assert.equal(registration[3],true);
    plugin.onunload();registration[2](f.event);assert.deepEqual(f.calls,[]);
  } finally {Module._load=original;if(previousDocument===undefined)delete global.document;else global.document=previousDocument;}
});
