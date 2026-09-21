const fs=require('node:fs');
const path=require('node:path');
function codexExecutable(explicit='',{platform=process.platform,env=process.env,exists=p=>{try{return fs.statSync(p).isFile();}catch{return false;}}}={}){
  if(!['darwin','win32'].includes(platform))throw Error('This release candidate only supports macOS and Windows.');
  const paths=platform==='win32'?path.win32:path.posix;
  if(explicit){
    if(!paths.isAbsolute(explicit)||!exists(explicit)||(platform==='win32'&&!/\.exe$/i.test(explicit)))throw Error('Choose a real Codex executable — on Windows it must be a .exe.');
    return explicit;
  }
  const standards=platform==='darwin'?['/Applications/ChatGPT.app/Contents/Resources/codex','/Applications/Codex.app/Contents/Resources/codex','/opt/homebrew/bin/codex','/usr/local/bin/codex']:[];
  const searchPath=env.PATH||env.Path||env.path||'';
  const candidates=[...standards,...searchPath.split(platform==='win32'?';':':').filter(p=>paths.isAbsolute(p)).map(p=>paths.join(p,platform==='win32'?'codex.exe':'codex'))];
  const match=candidates.find(exists);
  if(!match)throw Error('Codex executable not found — choose it in settings. Nothing is installed or added to PATH automatically.');
  return match;
}
module.exports={codexExecutable};
