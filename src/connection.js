const {SOURCE_KINDS,isDesktopMain}=require('./tasks');
function diagnostic(message){const e=Error(message);e.safeMessage=message;return e;}
function page(result){if(!result||!Array.isArray(result.data)||!Object.hasOwn(result,'nextCursor')||(result.nextCursor!==null&&typeof result.nextCursor!=='string'))throw diagnostic('The pagination interface format is incompatible.');return result.data;}
async function checkConnection(rpc){
  const a=await rpc('account/read',{refreshToken:false});
  if(!a?.account || a.account.type!=='chatgpt')throw diagnostic('Sign in to Codex with a ChatGPT account first.');
  let candidate;
  for(const archived of [false,true]){
    const rows=page(await rpc('thread/list',{limit:100,sortKey:'created_at',sortDirection:'desc',sourceKinds:SOURCE_KINDS,archived,useStateDbOnly:true}));
    for(const t of rows){if(!Object.hasOwn(t,'originator')||!Object.hasOwn(t,'source')||!Object.hasOwn(t,'parentThreadId')||!Number.isFinite(t.createdAt))throw diagnostic('Codex is missing task source fields — use a compatible version.');if(isDesktopMain(t))candidate||=t;}
    if(candidate)break;
  }
  if(!candidate)throw diagnostic('No Codex Desktop main task is available yet to verify the interface. Finish a test task in Codex, then check the connection again (it will not be imported).');
  const {thread}=await rpc('thread/read',{threadId:candidate.id,includeTurns:false});
  if(!isDesktopMain(thread)||thread.id!==candidate.id)throw diagnostic('The task-source interface is incompatible.');
  page(await rpc('thread/turns/list',{threadId:candidate.id,limit:1,sortDirection:'asc',itemsView:'notLoaded'}));
  // One item is read only to verify the experimental endpoint. Never saved or logged.
  page(await rpc('thread/items/list',{threadId:candidate.id,limit:1,sortDirection:'asc'}));
  return true;
}
module.exports={checkConnection,page};
