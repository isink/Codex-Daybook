const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {ensureFolder,attachmentKey}=require('./core');

function imageExtension(bytes) {
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return 'jpg';
  if(/^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii')))return 'gif';
  if(bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP')return 'webp';
  return null;
}

// Explicit image sources only: local images attached to completed user
// messages, and images Codex itself generated in a completed turn. Never walk
// directories, interpret text paths, fetch URLs, or remove cached assets.
function imageSources(snapshot) {
  const completed=new Set(snapshot.turns.filter(t=>t.status==='completed').map(t=>t.id));
  const sources=[];
  for(const {turnId,item} of snapshot.entries) {
    if(!completed.has(turnId))continue;
    if(item.type==='userMessage') {
      for(const [index,input] of item.content.entries())if(input.type==='localImage')sources.push({key:attachmentKey(turnId,item,index),source:input.path,path:input.path});
    } else if(item.type==='imageGeneration' && item.status==='completed') {
      // savedPath is Codex's own copy under generated_images; result carries
      // the same image base64-encoded, so it survives that cache being cleared.
      const saved=typeof item.savedPath==='string'?item.savedPath:null;
      sources.push({key:attachmentKey(turnId,item,0),source:saved||`imageGeneration:${item.id}`,path:saved,inline:typeof item.result==='string'&&item.result?item.result:null});
    }
  }
  return sources;
}

async function prepareAttachments(vault,snapshot,stored={}, {alive=()=>true,readLocal=fs.readFile,attachmentFolder='Attachments/Codex'}={}) {
  if(!/^[a-zA-Z0-9-]+$/.test(snapshot.thread.id))throw Error('任务 ID 无效');
  const folder=`${attachmentFolder}/${snapshot.thread.id}`;
  const mapping={...stored}, images={}, seen=new Set();
  const check=()=>{if(!alive())throw Error('插件已停止');};
  let copied=0,missing=0,unsupported=0;
  for(const input of imageSources(snapshot)) {
    check();
    const key=input.key;
    if(seen.has(key))continue;
    seen.add(key);
    const cached=mapping[key];
    // A permanently-unsupported format never becomes readable on retry —
    // this must be checked, and must skip readLocal entirely, before the
    // success-cache check below, which needs a `.path` this marker lacks.
    if(cached?.unsupported && cached.source===input.source) {
      unsupported++;images[key]=cached;continue;
    }
    const cachedName=cached?.path?.startsWith(folder+'/')?cached.path.slice(folder.length+1):'';
    const existing=/^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(cachedName) && vault.getAbstractFileByPath(cached.path);
    if(cached?.source===input.source && existing && !('children' in existing)) {
      images[key]=cached.path;
      continue;
    }
    let bytes;
    try {
      if(typeof input.path!=='string' || !path.isAbsolute(input.path))throw Error('非本地路径');
      bytes=Buffer.from(await readLocal(input.path));
    } catch {
      if(!input.inline){missing++;continue;}
      bytes=Buffer.from(input.inline,'base64');
    }
    check();
    const extension=imageExtension(bytes);
    if(!extension){
      mapping[key]={source:input.source,unsupported:true};
      unsupported++;images[key]=mapping[key];
      continue;
    }
    const hash=createHash('sha256').update(bytes).digest('hex');
    const target=`${folder}/${hash}.${extension}`;
    await ensureFolder(vault,folder);
    check();
    const file=vault.getAbstractFileByPath(target);
    if(file && 'children' in file)throw Error('图片副本路径被目录占用');
    if(!file) {
      await vault.createBinary(target,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
      copied++;
    }
    mapping[key]={source:input.source,path:target};
    images[key]=target;
  }
  return {mapping,images,copied,missing,unsupported};
}
module.exports={prepareAttachments,imageExtension};
