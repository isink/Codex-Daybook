const timers=require('node:timers');
const {spawn}=require('node:child_process');
const readline=require('node:readline');
const {codexExecutable}=require('./platform');
const {CompatibilityError}=require('./errors');

class CodexClient {
  constructor(executable=codexExecutable(),{spawnProcess=spawn}={}) {this.executable=executable;this.spawnProcess=spawnProcess;this.pending=new Map();this.seq=0;this.closed=false;this.notifications=new Set();this.closeListeners=new Set();}
  onNotification(fn){this.notifications.add(fn);return ()=>this.notifications.delete(fn);}
  onClose(fn){this.closeListeners.add(fn);return ()=>this.closeListeners.delete(fn);}
  async start() {
    if(this.closed) throw Error('The connection is closed — reload the plugin.');
    this.child=this.spawnProcess(this.executable,['app-server','--stdio'],{stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true});
    this.child.stderr.on('data',()=>{}); // Do not persist logs, tokens or transcripts.
    this.child.stdin.on('error',()=>this.fail('Failed to write to the Codex connection — reload the plugin.'));
    this.child.on('error',()=>this.fail('Could not start Codex — check that the desktop app is installed.'));
    this.child.on('exit',()=>this.fail('The Codex connection exited — reload the plugin.'));
    this.reader=readline.createInterface({input:this.child.stdout});
    this.reader.on('line',line=>{
      let message;try{message=JSON.parse(line);}catch{return;}
      const request=this.pending.get(message.id);
      if(request) {
        this.pending.delete(message.id);timers.clearTimeout(request.timer);
        if(message.error){const Type=[-32601,-32602].includes(message.error.code)?CompatibilityError:Error;const e=new Type('The Codex interface call failed — check version compatibility.');e.safeMessage=e.message;request.reject(e);}else request.resolve(message.result);
      } else if(message.method && message.id==null) {
        for(const listener of this.notifications)listener(message.method,message.params);
      } else if(message.method && message.id!=null) {
        this.child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'Read-only sync client'}})+'\n');
      }
    });
    await this.request('initialize',{clientInfo:{name:'obsidian_codex_daily_sync',version:require('../manifest.json').version},capabilities:{experimentalApi:true}});
    this.child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  }
  request(method,params) {
    if(this.closed || !this.child || this.child.exitCode!==null) return Promise.reject(Error('The Codex connection is unavailable — reload the plugin.'));
    return new Promise((resolve,reject)=>{
      const id=++this.seq;
      const timer=timers.setTimeout(()=>{this.pending.delete(id);reject(Error(`${method} timed out — nothing was written this round.`));},20000);
      this.pending.set(id,{method,resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,method,params})+'\n');
    });
  }
  fail(message) {for(const p of this.pending.values()){timers.clearTimeout(p.timer);p.reject(Error(message));}this.pending.clear();const wasClosed=this.closed;this.closed=true;if(!wasClosed)for(const listener of this.closeListeners)listener();this.notifications.clear();this.closeListeners.clear();}
  stop() {
    this.fail('The plugin has stopped.');this.reader?.close();
    const child=this.child;
    if(child && child.exitCode===null && child.signalCode===null) {
      child.stdin.end();child.kill('SIGTERM');
      const timer=timers.setTimeout(()=>{if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');},2000);
      timer.unref?.();child.once('exit',()=>timers.clearTimeout(timer));
    }
  }
}
module.exports={CodexClient,codexExecutable};
