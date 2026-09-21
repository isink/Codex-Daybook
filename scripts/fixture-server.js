#!/usr/bin/env node
// Isolated UI QA only. Never used by production or included in install ZIP.
const readline=require('node:readline');
const path=require('node:path');
const createdAt=Math.ceil(Date.now()/1000)+2;
const thread={id:'fixture-desktop-main',name:'示例聊天 · Release QA',createdAt,originator:'Codex Desktop',source:'vscode',parentThreadId:null,ephemeral:false};
const image=path.join(__dirname,'fixture.png');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const q=JSON.parse(line);if(q.id==null)return;let result;
  if(q.method==='initialize')result={userAgent:'fixture'};
  else if(q.method==='account/read')result={account:{type:'chatgpt'}};
  else if(q.method==='thread/list')result={data:q.params.archived?[]:[thread],nextCursor:null};
  else if(q.method==='thread/read')result={thread};
  else if(q.method==='thread/turns/list')result={data:[{id:'turn',status:'completed',startedAt:createdAt,completedAt:createdAt+1}],nextCursor:null};
  else if(q.method==='thread/items/list')result={data:[{turnId:'turn',item:{id:'question',type:'userMessage',content:[{type:'text',text:'这是独立测试库中的虚构对话。请检查小图、右侧问题和每日链接。'},{type:'localImage',path:image}]}},{turnId:'turn',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'左侧回答保留正常 Markdown。\n\n- 完整列表\n- 图片只保存一次\n\n| 项目 | 状态 |\n| --- | --- |\n| 测试 | 通过 |\n\n```js\nconst example = true;\n```'}},{turnId:'turn',item:{id:'plan',type:'plan',text:'正式计划示例：验证结束后保留本地笔记。'}}],nextCursor:null};
  else {process.stdout.write(JSON.stringify({id:q.id,error:{code:-32601}})+'\n');return;}
  process.stdout.write(JSON.stringify({id:q.id,result})+'\n');
});
