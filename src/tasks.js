const SOURCE_KINDS=['vscode','appServer'];
const {CompatibilityError}=require('./errors');
const validId=id=>typeof id==='string' && /^[a-zA-Z0-9-]+$/.test(id);

function isDesktopMain(thread) {
  return thread && validId(thread.id) && thread.originator==='Codex Desktop'
    && SOURCE_KINDS.includes(thread.source) && !thread.ephemeral && !thread.parentThreadId;
}

function migrateState(input={},now=Date.now()) {
  if(input.schemaVersion===2) {
    if(!Number.isSafeInteger(input.discoveryStartedAt) || input.discoveryStartedAt<=0 || !input.threads || typeof input.threads!=='object' || Array.isArray(input.threads))throw Error('同步配置无效，已停止；不会重置历史分界时间');
    for(const [id,record] of Object.entries(input.threads))if(!validId(id) || !record || typeof record!=='object')throw Error('任务映射无效，已停止');
    return input;
  }
  if(input.schemaVersion!=null)throw Error('同步配置版本不兼容，已停止');
  const {notePath,threadId,attachments,lastSuccess,...rest}=input;
  const threads={};
  if(notePath || threadId) {
    const id=threadId;
    if(!validId(id))throw Error('旧版任务 ID 无效，已停止迁移');
    threads[id]={notePath:notePath||null,attachments:attachments||{},...(lastSuccess?{lastSuccess}:{})};
  }
  // The next whole second is an explicit, durable boundary. A reload must never
  // move it forward (which would miss tasks created while Obsidian was closed).
  return {...rest,schemaVersion:2,discoveryStartedAt:Math.ceil(now/1000),threads};
}

async function discoverTasks(rpc,since,{alive=()=>true}={}) {
  const found=new Map();
  for(const archived of [false,true]) {
    let cursor;const seen=new Set();let previous=Infinity;
    do {
      if(!alive())throw Error('插件已停止');
      const page=await rpc('thread/list',{limit:100,sortKey:'created_at',sortDirection:'desc',sourceKinds:SOURCE_KINDS,archived,useStateDbOnly:true,...(cursor?{cursor}:{})});
      if(!Array.isArray(page.data))throw new CompatibilityError('任务列表格式不兼容');
      let older=false;
      for(const thread of page.data) {
        if(!Object.hasOwn(thread,'originator')||!Object.hasOwn(thread,'parentThreadId')||!Object.hasOwn(thread,'source'))throw new CompatibilityError('任务来源字段不兼容');
        if(!Number.isFinite(thread.createdAt) || thread.createdAt>previous)throw Error('任务列表时间或排序异常，已停止发现新任务');
        previous=thread.createdAt;
        if(thread.createdAt<since){older=true;continue;}
        if(isDesktopMain(thread))found.set(thread.id,thread);
      }
      // Never read historical message bodies; even metadata pagination stops
      // once the fixed creation-time boundary has been reached.
      if(older)break;
      cursor=page.nextCursor;
      if(cursor && seen.has(cursor))throw Error('任务列表返回重复分页游标');
      if(cursor)seen.add(cursor);
    }while(cursor);
  }
  return [...found.values()];
}

function allAttachments(state) {
  return Object.fromEntries(Object.entries(state.threads||{}).flatMap(([id,t])=>Object.entries(t.attachments||{}).map(([key,value])=>[`${id}/${key}`,value])));
}
module.exports={SOURCE_KINDS,isDesktopMain,migrateState,discoverTasks,allAttachments};
