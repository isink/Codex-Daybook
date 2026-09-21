// Codex owns OAuth and credential storage. This client holds only transient
// login IDs and opens validated official URLs; it never accepts passwords/tokens.
function officialLoginUrl(value){
  if(typeof value!=='string')throw Error('Invalid login response.');
  const url=new URL(value);
  if(url.protocol!=='https:' || !['auth.openai.com','chatgpt.com'].includes(url.hostname) || url.username || url.password || url.port)throw Error('Invalid login response.');
  return url.href;
}
class BrowserLogin {
  constructor(client,{openUrl,onFinish=()=>{}}){
    this.client=client;this.openUrl=openUrl;this.onFinish=onFinish;this.active=true;this.early=[];
    this.offNotification=client.onNotification((method,params)=>{
      if(method!=='account/login/completed'||!this.active)return;
      if(!this.loginId){if(this.early.length<8)this.early.push(params);return;}
      void this.complete(params);
    });
    this.offClose=client.onClose(()=>this.finish('failed'));
  }
  async start(){
    try{
      const result=await this.client.request('account/login/start',{type:'chatgpt'});
      if(!this.active)return;
      if(result?.type!=='chatgpt'||typeof result.loginId!=='string'||!result.loginId)throw Error('Invalid login response.');
      this.loginId=result.loginId;
      const url=officialLoginUrl(result.authUrl);
      for(const event of this.early)await this.complete(event);
      this.early=[];
      if(this.active)await this.openUrl(url);
    }catch{
      if(this.active){await this.cancelRequest();this.finish('failed');}
    }
  }
  async complete(event){
    if(!this.active||this.verifying||event?.loginId!==this.loginId)return;
    if(event.success!==true){this.finish('failed');return;}
    this.verifying=true;
    try{
      const result=await this.client.request('account/read',{refreshToken:false});
      this.finish(result?.account?.type==='chatgpt'?'success':'failed');
    }catch{this.finish('failed');}
  }
  async cancelRequest(){
    if(this.loginId&&!this.client.closed){try{await this.client.request('account/login/cancel',{loginId:this.loginId});}catch{}}
  }
  async cancel(){
    if(!this.active)return;
    this.dispose();await this.cancelRequest();this.onFinish('cancelled');
  }
  finish(status){if(!this.active)return;this.dispose();this.onFinish(status);}
  dispose(){this.active=false;this.early=[];this.offNotification?.();this.offClose?.();}
}
module.exports={BrowserLogin,officialLoginUrl};
