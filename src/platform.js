const fs=require('node:fs');
const path=require('node:path');

// Codex Desktop from the Microsoft Store lives in a protected, versioned
// C:\Program Files\WindowsApps\OpenAI.Codex_<version>_x64__2p2nqsd0c76g0
// folder, and Windows refuses (EPERM) to let any other app start the
// codex.exe inside it. The Codex CLI installed with npm reads the same Codex
// data, so use the real codex.exe behind its codex.cmd shim instead.
const STORE_PUBLISHER='2p2nqsd0c76g0';
const isStorePath=p=>new RegExp(`[\\\\/]WindowsApps[\\\\/]OpenAI\\.Codex_[^\\\\/]*_${STORE_PUBLISHER}([\\\\/]|$)`,'i').test(String(p||''));

function listDir(dir){try{return fs.readdirSync(dir,{withFileTypes:true});}catch{return [];}}
function isDirectory(p){try{return fs.statSync(p).isDirectory();}catch{return false;}}

// npm's global prefix is wherever codex.cmd sits. The native binary ships in
// a platform-specific package somewhere below @openai\codex, at a depth that
// has changed between releases, so search that one package folder.
function npmCodexExecutable(prefixes,{readdir,arch}) {
  const found=[];
  const walk=(dir,depth)=>{
    if(depth>7)return;
    for(const entry of readdir(dir)){
      const full=path.win32.join(dir,entry.name);
      if(entry.isDirectory())walk(full,depth+1);
      else if(entry.name.toLowerCase()==='codex.exe')found.push(full);
    }
  };
  for(const prefix of prefixes)walk(path.win32.join(prefix,'node_modules','@openai','codex'),0);
  const target=arch==='arm64'?'aarch64':'x86_64';
  return found.find(p=>p.includes(target))||found[0]||null;
}

function codexExecutable(explicit='',{platform=process.platform,arch=process.arch,env=process.env,exists=p=>{try{return fs.statSync(p).isFile();}catch{return false;}},readdir=listDir,isDir=isDirectory}={}){
  if(!['darwin','win32'].includes(platform))throw Error('This plugin only supports macOS and Windows.');
  const paths=platform==='win32'?path.win32:path.posix;
  // A saved path into the Store package can never be started; look again.
  if(explicit && !(platform==='win32'&&isStorePath(explicit))){
    if(!paths.isAbsolute(explicit)||!exists(explicit)||(platform==='win32'&&!/\.exe$/i.test(explicit)))throw Error('Choose a real Codex executable — on Windows it must be a .exe.');
    return explicit;
  }
  const standards=platform==='darwin'?['/Applications/ChatGPT.app/Contents/Resources/codex','/Applications/Codex.app/Contents/Resources/codex','/opt/homebrew/bin/codex','/usr/local/bin/codex']:[];
  const searchPath=(env.PATH||env.Path||env.path||'').split(platform==='win32'?';':':').filter(p=>paths.isAbsolute(p));
  const match=[...standards,...searchPath.map(p=>paths.join(p,platform==='win32'?'codex.exe':'codex'))].find(exists);
  if(match)return match;
  if(platform==='win32'){
    const prefixes=[...new Set([...searchPath.filter(p=>exists(path.win32.join(p,'codex.cmd'))),...(env.APPDATA?[path.win32.join(env.APPDATA,'npm')]:[])])];
    const npm=npmCodexExecutable(prefixes,{readdir,arch});
    if(npm)return npm;
    if(env.LOCALAPPDATA&&isDir(path.win32.join(env.LOCALAPPDATA,'Microsoft','WindowsApps',`OpenAI.Codex_${STORE_PUBLISHER}`)))throw Error('The Microsoft Store version of Codex cannot be started by other apps. Install the Codex command-line tool (npm install -g @openai/codex), then click Scan again.');
  }
  throw Error('Codex executable not found — choose it in settings. Nothing is installed or added to PATH automatically.');
}
module.exports={codexExecutable,isStorePath};
