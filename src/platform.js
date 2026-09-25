const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

// Microsoft Store (MSIX) install of Codex Desktop. It lives in a versioned,
// unlistable folder under C:\Program Files\WindowsApps and is not on PATH.
const STORE_PACKAGE='OpenAI.Codex_2p2nqsd0c76g0';
const STORE_CLI=['app','resources','codex.exe'];
const STORE_ALIASES=['codex-core-command-runner.exe','codex-chrome-native-host.exe'];

function storeRoot(target) {
  const parts=String(target||'').replace(/^\\\\\?\\/,'').split(/[\\/]+/);
  const index=parts.findIndex(part=>/^OpenAI\.Codex_.+_2p2nqsd0c76g0$/i.test(part));
  return index>0?parts.slice(0,index+1).join('\\'):null;
}

// The Store's launch aliases point into the current version's folder, so
// following one finds it without hard-coding a version that changes on every
// update. Asking PowerShell for the package location is the fallback.
function storeExecutable(env,{exists,readlink,installLocation}) {
  const roots=[];
  if(env.LOCALAPPDATA)for(const alias of STORE_ALIASES){
    try{roots.push(storeRoot(readlink(path.win32.join(env.LOCALAPPDATA,'Microsoft','WindowsApps',STORE_PACKAGE,alias))));}catch{}
  }
  for(const root of roots){const candidate=root&&path.win32.join(root,...STORE_CLI);if(candidate&&exists(candidate))return candidate;}
  try{
    const root=String(installLocation(env)||'').split(/\r?\n/).map(line=>line.trim()).find(Boolean);
    const candidate=root&&path.win32.join(root,...STORE_CLI);
    if(candidate&&exists(candidate))return candidate;
  }catch{}
  return null;
}

function packageInstallLocation(env) {
  if(!env.SystemRoot)return null;
  const powershell=path.win32.join(env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const output=execFileSync(powershell,['-NoProfile','-NonInteractive','-Command','(Get-AppxPackage -Name OpenAI.Codex).InstallLocation'],{encoding:'utf8',timeout:8000,windowsHide:true});
  return output;
}

function codexExecutable(explicit='',{platform=process.platform,env=process.env,exists=p=>{try{return fs.statSync(p).isFile();}catch{return false;}},readlink=fs.readlinkSync,installLocation=packageInstallLocation}={}){
  if(!['darwin','win32'].includes(platform))throw Error('This plugin only supports macOS and Windows.');
  const paths=platform==='win32'?path.win32:path.posix;
  if(explicit){
    const valid=paths.isAbsolute(explicit)&&exists(explicit)&&(platform!=='win32'||/\.exe$/i.test(explicit));
    if(valid)return explicit;
    // A Store update replaces the versioned folder a saved path points into;
    // find the new one instead of failing.
    if(!(platform==='win32'&&storeRoot(explicit)))throw Error('Choose a real Codex executable — on Windows it must be a .exe.');
  }
  const standards=platform==='darwin'?['/Applications/ChatGPT.app/Contents/Resources/codex','/Applications/Codex.app/Contents/Resources/codex','/opt/homebrew/bin/codex','/usr/local/bin/codex']:[];
  const standard=standards.find(exists);
  if(standard)return standard;
  if(platform==='win32'){
    const store=storeExecutable(env,{exists,readlink,installLocation});
    if(store)return store;
  }
  const searchPath=env.PATH||env.Path||env.path||'';
  const match=searchPath.split(platform==='win32'?';':':').filter(p=>paths.isAbsolute(p)).map(p=>paths.join(p,platform==='win32'?'codex.exe':'codex')).find(exists);
  if(!match)throw Error('Codex executable not found — choose it in settings. Nothing is installed or added to PATH automatically.');
  return match;
}
module.exports={codexExecutable,storeRoot};
