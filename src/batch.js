const {readSnapshot,renderTranscript,syncToVault,verifyThread,peekLatestTurn,latestTurnSignature,findNote}=require('./core');
const {prepareAttachments,imageSources,chooseAttachmentDir,relocateMapping,moveLegacyDir}=require('./attachments');
const {discoverTasks}=require('./tasks');
const {routing,defaults}=require('./settings');
const {CompatibilityError}=require('./errors');

class StateWriteError extends Error {}
// Bumped whenever already-settled tasks need one more full pass: 2 added
// images Codex generated, 3 moves attachment folders from the task ID to the
// conversation title. A record below this version gets exactly one full
// reconciliation, then settles again.
const PUBLICATION_VERSION=3;
function sourceMessage(vault,record) {
  return record?.notePath && vault.getAbstractFileByPath(record.notePath)
    ? '源对话暂不可用，本地副本已保留' : '源对话暂不可用，尚未生成本地副本';
}

// One serial cycle. Each task is independent, but configuration persistence
// failure aborts the cycle so no unrecorded state is treated as durable.
async function syncBatch({vault,rpc,state,persist,alive=()=>true,now=Date.now,readLocal,resolveEmbed}) {
  const check=()=>{if(!alive())throw Error('插件已停止');};
  let current=state;
  const report={discovered:0,checked:0,changed:0,waiting:0,images:0,copiedImages:0,missingImages:0,errors:[]};
  const commit=async next=>{
    check();
    try{await persist(next);}catch{throw new StateWriteError('无法保存同步配置，本轮已停止；已有笔记和图片保留');}
    current=next;check();
  };
  const account=await rpc('account/read',{refreshToken:false});
  if(!account.account)throw Error('请先在 Codex Desktop 登录 ChatGPT，再重载插件');
  check();
  let discovered=[];
  try{discovered=await discoverTasks(rpc,current.discoveryStartedAt,{alive});}
  catch(error){check();if(error instanceof CompatibilityError)throw error;report.errors.push({id:null,kind:'discovery',message:'新任务发现暂不可用'});}
  const additions=discovered.filter(t=>!Object.hasOwn(current.threads,t.id));
  if(additions.length) {
    await commit({...current,threads:{...current.threads,...Object.fromEntries(additions.map(t=>[t.id,{name:t.name||'Codex 对话',notePath:null,attachments:{},routing:routing(current.settings||defaults(),t)}]))}});
    report.discovered=additions.length;
  }
  for(const id of Object.keys(current.threads)) {
    check();
    let record=current.threads[id],snapshot;
    // A settled task (has a note, a known last-turn signature, and no pending
    // image retries) can skip the full pagination pass below when a cheap peek
    // shows the most recent turn and the task name are both unchanged. Any
    // task missing that history, or found to differ, always falls through to
    // the full read — this can only add a cheap round trip, never skip a real
    // update, a rename, or a missing-image retry.
    // Older releases could persist a signature before publishing the note.
    // A missing or older publicationVersion forces one full reconciliation.
    const settled=record.publicationVersion===PUBLICATION_VERSION && !record.syncPending && Boolean(record.notePath) && record.turnSignature!==undefined && !record.pendingImages;
    try {
      if(settled) {
        const thread=await verifyThread(rpc,id,{accountVerified:true});
        check();
        const signature=await peekLatestTurn(rpc,id);
        if((thread.name||'Codex 对话')===record.name && JSON.stringify(signature)===JSON.stringify(record.turnSignature)) {
          report.checked++;continue;
        }
      }
      snapshot=await readSnapshot(rpc,id,{accountVerified:true});
    }
    catch(error){check();if(error instanceof CompatibilityError)throw error;report.errors.push({id,kind:'source',name:record.name||id.slice(-8),message:sourceMessage(vault,record)});continue;}
    check();report.checked++;
    try {
      const route=record.routing||routing(current.settings||defaults(),snapshot.thread);
      // Choose the folder only once there is something to put in it, so it
      // can be named after the note whenever the note already exists.
      const legacyDir=`${route.attachmentFolder}/${id}`;
      let attachmentDir=record.attachmentDir;
      if(!attachmentDir && (Object.keys(record.attachments||{}).length || imageSources(snapshot).length)) {
        attachmentDir=chooseAttachmentDir(vault,current.threads,id,record,snapshot.thread,route.attachmentFolder);
      }
      if(attachmentDir) {
        const relocated=relocateMapping(record.attachments,legacyDir,attachmentDir);
        if(record.attachmentDir!==attachmentDir || JSON.stringify(relocated)!==JSON.stringify(record.attachments||{})) {
          // Record the new folder before moving files, so an interrupted move
          // is simply finished on the next pass.
          record={...record,attachmentDir,attachments:relocated};
          await commit({...current,threads:{...current.threads,[id]:record}});
        }
        await moveLegacyDir(vault,legacyDir,attachmentDir);
        check();
      }
      const turnSignature=latestTurnSignature(snapshot.turns);
      if(record.notePath && JSON.stringify(turnSignature)===JSON.stringify(record.turnSignature) && !(await findNote(vault,id,record.notePath))) {
        // The note was deleted in the vault and nothing new has been said
        // since: leave it deleted. A later new message recreates it, as before.
        if(record.publicationVersion!==PUBLICATION_VERSION || record.syncPending || record.pendingImages) {
          record={...record,syncPending:false,pendingImages:false,publicationVersion:PUBLICATION_VERSION};
          await commit({...current,threads:{...current.threads,[id]:record}});
        }
        continue;
      }
      const assets=await prepareAttachments(vault,snapshot,record.attachments,{alive,readLocal,folder:attachmentDir||legacyDir});
      report.images+=Object.keys(assets.images).length;report.copiedImages+=assets.copied;report.missingImages+=assets.missing;
      const pendingImages=assets.missing>0;
      if(!record.syncPending || JSON.stringify(record.attachments||{})!==JSON.stringify(assets.mapping)) {
        // Preserve copied images across retries, but never acknowledge a new
        // transcript until both the vault write and final state save succeed.
        record={...record,attachments:assets.mapping,syncPending:true};
        await commit({...current,threads:{...current.threads,[id]:record}});
      }
      snapshot.transcript=renderTranscript(snapshot.turns,snapshot.entries,assets.images,route.timeZone,resolveEmbed,{from:legacyDir,to:attachmentDir});
      const result=await syncToVault(vault,snapshot,{notePath:record.notePath,alive,now:now(),route,ensureIndexed:!record.notePath});
      check();
      const name=snapshot.thread.name||'Codex 对话';
      if(record.syncPending || record.notePath!==result.notePath || record.name!==name || result.changed) {
        record={...record,name,notePath:result.notePath,turnSignature,pendingImages,syncPending:false,publicationVersion:PUBLICATION_VERSION,...(result.notePath?{lastSuccess:new Date(now()).toISOString()}:{})};
        await commit({...current,threads:{...current.threads,[id]:record}});
      }
      if(result.changed)report.changed++;
      if(!result.notePath)report.waiting++;
    }catch(error){
      if(error instanceof StateWriteError)throw error;
      check();report.errors.push({id,kind:'local',name:record.name||id.slice(-8),message:error.message});
    }
  }
  report.notes=Object.values(current.threads).filter(t=>t.notePath&&vault.getAbstractFileByPath(t.notePath)).length;
  return {state:current,report};
}
module.exports={PUBLICATION_VERSION,syncBatch,sourceMessage,StateWriteError};
