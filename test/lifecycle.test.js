require('./setup');
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');

// Run the real plugin error path with a tiny host stub; never archive or delete
// the user's actual task just to exercise source-unavailable behavior.
test('archive/delete/read failures preserve local note, mappings and daily; connection errors never mean deleted',async()=>{
  const original=Module._load;const notices=[];
  let PluginClass;
  try {
    Module._load=function(id,...args){if(id==='obsidian')return {Plugin:class {},PluginSettingTab:class {},FuzzySuggestModal:class {},Notice:class {constructor(text){notices.push(text);}}};return original.call(this,id,...args);};
    PluginClass=require('../src/main');
  }finally{Module._load=original;}
  for(const reason of ['not found','archived unavailable','ECONNRESET']) {
    const plugin=new PluginClass();let writes=0;
    plugin.state={schemaVersion:2,discoveryStartedAt:1789400000,settings:{dailyTrackEnabled:true},threads:{task:{notePath:'Codex Conversations/local.md',attachments:{a:{path:'Attachments/saved.png'}},lastSuccess:'previous'}}};
    const before=JSON.stringify(plugin.state);
    plugin.running=true;plugin.stopped=false;plugin.generation=0;
    plugin.status={setText:()=>{}};
    let requested=false;
    plugin.client={request:async()=>{requested=true;throw Error(reason);},stop:()=>{}};
    plugin.app={vault:{configDir:'.obsidian',adapter:{read:async()=>'["dataview"]'},getAbstractFileByPath:p=>({path:p}),process:()=>{writes++;},create:()=>{writes++;},delete:()=>{writes++;}}};
    plugin.saveData=()=>{writes++;};
    await plugin.sync(true);
    // Guard against the check above being satisfied for the wrong reason (e.g.
    // an earlier gate failing before the connection is ever used).
    assert.ok(requested,'client.request must actually be reached for this to test anything');
    assert.equal(writes,0);assert.equal(JSON.stringify(plugin.state),before);
    assert.match(plugin.lastError,/local copies are kept/i);
    assert.ok(!/delet/i.test(notices.at(-1)));assert.equal(plugin.running,false);
  }
});
