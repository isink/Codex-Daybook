require('./setup');
const test=require('node:test'),assert=require('node:assert/strict');
const {BrowserLogin,officialLoginUrl}=require('../src/auth');
function fixture({early=false,openFails=false}={}){
  const notifications=new Set(),closes=new Set(),calls=[],opened=[],finished=[];
  let account={type:'chatgpt'};
  const result={type:'chatgpt',loginId:'login-fixture',authUrl:'https://auth.openai.com/oauth/authorize?state=fictional'};
  const client={closed:false,onNotification:fn=>{notifications.add(fn);return ()=>notifications.delete(fn);},onClose:fn=>{closes.add(fn);return ()=>closes.delete(fn);},request:async(method,params)=>{
    calls.push([method,params]);
    if(method==='account/login/start'){if(early)for(const fn of notifications)fn('account/login/completed',{loginId:result.loginId,success:true});return result;}
    if(method==='account/read')return {account};
    if(method==='account/login/cancel')return {status:'canceled'};
    throw Error('Unexpected request');
  }};
  const login=new BrowserLogin(client,{openUrl:async url=>{if(openFails)throw Error('browser failed');opened.push(url);},onFinish:status=>finished.push(status)});
  return {client,login,result,calls,opened,finished,notifications,closes,setAccount:a=>{account=a;}};
}
test('OAuth URLs only open exact official HTTPS hosts without userinfo or custom ports',()=>{
  assert.equal(officialLoginUrl('https://auth.openai.com/oauth/authorize'),'https://auth.openai.com/oauth/authorize');
  assert.equal(officialLoginUrl('https://chatgpt.com/auth'),'https://chatgpt.com/auth');
  for(const url of [null,'javascript:alert(1)','file:///tmp/test','http://auth.openai.com/','https://auth.openai.com.example.org/','https://example.org/auth.openai.com','https://u:p@auth.openai.com/','https://auth.openai.com:444/'])assert.throws(()=>officialLoginUrl(url));
});
test('browser login uses managed ChatGPT OAuth, ignores unrelated completions and verifies the account',async()=>{
  const f=fixture();await f.login.start();assert.equal(f.opened.length,1);
  assert.deepEqual(f.calls[0],['account/login/start',{type:'chatgpt'}]);
  await f.login.complete({loginId:'unrelated',success:true});assert.equal(f.finished.length,0);
  await f.login.complete({loginId:f.result.loginId,success:true});
  await f.login.complete({loginId:f.result.loginId,success:true});
  assert.deepEqual(f.finished,['success']);assert.equal(f.notifications.size,0);assert.equal(f.closes.size,0);
  assert.deepEqual(f.calls[1],['account/read',{refreshToken:false}]);
});
test('login completion arriving before the start response is not lost',async()=>{
  const f=fixture({early:true});await f.login.start();assert.deepEqual(f.finished,['success']);assert.equal(f.opened.length,0);
});
test('cancellation only cancels this login, never logs out the shared Codex account',async()=>{
  const f=fixture();await f.login.start();await f.login.cancel();
  assert.deepEqual(f.calls.at(-1),['account/login/cancel',{loginId:f.result.loginId}]);
  assert.deepEqual(f.finished,['cancelled']);await f.login.complete({loginId:f.result.loginId,success:true});
  assert.deepEqual(f.finished,['cancelled']);assert.equal(f.notifications.size,0);assert.ok(!f.calls.some(([m])=>m==='account/logout'));
});
test('unloading during a delayed login start suppresses the browser and completion callback',async()=>{
  const f=fixture();let resolve;f.client.request=()=>new Promise(r=>{resolve=r;});
  const pending=f.login.start();f.login.dispose();resolve(f.result);await pending;
  assert.equal(f.opened.length,0);assert.equal(f.finished.length,0);assert.equal(f.notifications.size,0);
});
test('browser failures cancel the pending login and expose only a safe status',async()=>{
  const f=fixture({openFails:true});await f.login.start();assert.deepEqual(f.finished,['failed']);
  assert.equal(f.calls.at(-1)[0],'account/login/cancel');assert.equal(f.notifications.size,0);
});
test('invalid login response, closed process and unsuccessful verification never report success',async()=>{
  const bad=fixture();bad.result.authUrl='https://example.org/';await bad.login.start();assert.deepEqual(bad.finished,['failed']);assert.equal(bad.opened.length,0);
  const closed=fixture();await closed.login.start();for(const fn of closed.closes)fn();assert.deepEqual(closed.finished,['failed']);
  const wrong=fixture();wrong.setAccount({type:'apiKey'});await wrong.login.start();await wrong.login.complete({loginId:wrong.result.loginId,success:true});assert.deepEqual(wrong.finished,['failed']);
  const rejected=fixture();await rejected.login.start();await rejected.login.complete({loginId:rejected.result.loginId,success:false,error:'secret error contents'});assert.deepEqual(rejected.finished,['failed']);assert.equal(rejected.calls.length,1);
});
test('RPC routes actual JSON-RPC notifications and releases listeners when its child stops',async()=>{
  const {CodexClient}=require('../src/rpc'),{PassThrough}=require('node:stream'),{EventEmitter}=require('node:events');
  const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,signalCode:null});
  child.kill=signal=>{child.signalCode=signal;child.emit('exit');};
  child.stdin.on('data',chunk=>{for(const line of chunk.toString().trim().split('\n')){const q=JSON.parse(line);if(q.id)child.stdout.write(JSON.stringify({id:q.id,result:{}})+'\n');}});
  const client=new CodexClient('fixture',{spawnProcess:()=>child});await client.start();let notification,closed=0;
  client.onNotification((method,params)=>{notification={method,params};});client.onClose(()=>{closed++;});
  child.stdout.write(JSON.stringify({method:'account/login/completed',params:{loginId:'fixture',success:true}})+'\n');
  assert.deepEqual(notification,{method:'account/login/completed',params:{loginId:'fixture',success:true}});
  client.stop();client.stop();assert.equal(closed,1);assert.equal(client.notifications.size,0);assert.equal(client.closeListeners.size,0);
});
