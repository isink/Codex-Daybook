const {parseNote,noteThreadId,dateParts}=require('./core');
const {migrateState}=require('./tasks');
const QUERY='```dataview\nLIST WITHOUT ID captured_at + "　→　" + file.link\nWHERE contains(file.outlinks, this.file.link)\nSORT captured_at ASC\n```';
const DEFAULT_TEMPLATE='---\ntype: 每日记录\ndate: "{{date:YYYY-MM-DD}}"\n---\n\n'+QUERY+'\n';
function defaults(language='en'){return {language,executable:'',noteFolder:'Codex Conversations',attachmentFolder:'Attachments/Codex',dailyFolder:'Daily',dailyTemplate:'',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',intervalSeconds:10,consent:false,dailyTrackEnabled:false};}
function vaultPath(value,optional=false){
  if(typeof value!=='string')throw Error('Folders must be vault-relative paths.');
  const p=value.trim().replaceAll('\\','/');
  if(!p && optional)return '';
  if(!p || p.startsWith('/') || p.split('/').some(x=>!x || x==='.' || x==='..' || /[<>:"|?*[\]#^\x00-\x1f]/.test(x) || /[. ]$/.test(x) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x) || x.startsWith('.')))throw Error('The path must stay inside the vault, with no reserved name, hidden folder, or parent reference.');
  return p;
}
function validateSettings(s){
  if(!s||typeof s!=='object'||typeof s.consent!=='boolean'||typeof s.timeZone!=='string'||!s.timeZone)throw Error('Settings are missing a valid time zone or access confirmation.');
  const out={language:'en',dailyTrackEnabled:false,...s};
  if(!['zh','en'].includes(out.language))throw Error('Choose Chinese or English.');
  if(typeof out.dailyTrackEnabled!=='boolean')throw Error('Invalid daily-track setting.');
  for(const key of ['noteFolder','attachmentFolder','dailyFolder'])out[key]=vaultPath(s[key]);
  out.dailyTemplate=vaultPath(s.dailyTemplate,true);
  if(out.dailyTemplate && !out.dailyTemplate.endsWith('.md'))throw Error('The daily template must be a Markdown file.');
  try{new Intl.DateTimeFormat('en',{timeZone:s.timeZone}).format();}catch{throw Error('Invalid time zone — use an IANA name, e.g. Europe/London.');}
  if(!Number.isInteger(s.intervalSeconds)||s.intervalSeconds<5||s.intervalSeconds>3600)throw Error('The check interval must be a whole number of seconds, 5–3600.');
  if(typeof s.executable!=='string'||/[\r\n\0]/.test(s.executable))throw Error('Invalid executable path.');
  return out;
}
function routing(s,thread){return {noteFolder:s.noteFolder,attachmentFolder:s.attachmentFolder,dailyFolder:s.dailyFolder,dailyTemplate:s.dailyTemplate,timeZone:s.timeZone,day:dateParts(thread.createdAt,s.timeZone).day,dailyTrackEnabled:s.dailyTrackEnabled};}
async function upgradeState(saved={},vault,dailyConfig={},language='en'){
  if(saved.schemaVersion===3 && saved.settings && saved.settings.language===undefined)saved={...saved,settings:{...saved.settings,language}};
  if(saved.schemaVersion===3 && saved.settings && saved.settings.dailyTrackEnabled===undefined)saved={...saved,settings:{...saved.settings,dailyTrackEnabled:true}};
  if(saved.schemaVersion===3){
    validateSettings(saved.settings);
    if(!saved.threads || Array.isArray(saved.threads)||typeof saved.threads!=='object' || (saved.discoveryStartedAt!==null&&(!Number.isSafeInteger(saved.discoveryStartedAt)||saved.discoveryStartedAt<=0)))throw Error('Sync configuration is corrupted — stopped. The sync starting point was not reset.');
    if(saved.enabled && (!saved.settings.consent || saved.discoveryStartedAt===null))throw Error('Sync configuration is missing consent or a starting point.');
    if(typeof saved.enabled!=='boolean'||(saved.discoveryStartedAt===null&&Object.keys(saved.threads).length))throw Error('Sync state is invalid — stopped.');
    if(saved.discoveryStartedAt!==null)migrateState({...saved,schemaVersion:2});
    for(const record of Object.values(saved.threads)){
      if(record.notePath)vaultPath(record.notePath);
      if(!record.routing)throw Error('This task is missing its fixed folder configuration — stopped.');
      validateSettings({...saved.settings,...record.routing});
      if(record.routing.day&&!/^\d{4}-\d{2}-\d{2}$/.test(record.routing.day))throw Error('Invalid task creation-day configuration.');
    }
    return saved;
  }
  if(Object.keys(saved).length===0)return {schemaVersion:3,settings:defaults(language),threads:{},discoveryStartedAt:null,enabled:false,migrationWarnings:[]};
  let old={...saved};
  if(!old.schemaVersion&&!old.notePath&&!old.threadId)throw Error('Couldn\'t recognize the legacy configuration — stopped. The sync starting point was not reset.');
  if(!old.schemaVersion && old.notePath && !old.threadId){const f=vault.getAbstractFileByPath(old.notePath);old.threadId=f&&noteThreadId(await vault.read(f));if(!old.threadId)throw Error('Couldn\'t confirm the task ID from the old note — migration stopped.');}
  old=migrateState(old);
  const settings=defaults(language),warnings=[],threads={};
  settings.dailyTrackEnabled=true; // this migration path is exclusively existing users
  const notes=new Set(),assets=new Set(),days=new Set();
  if(dailyConfig.folder)settings.dailyFolder=dailyConfig.folder;
  if(dailyConfig.template)settings.dailyTemplate=dailyConfig.template.endsWith('.md')?dailyConfig.template:dailyConfig.template+'.md';
  for(const [id,record] of Object.entries(old.threads)){
    const f=record.notePath&&vault.getAbstractFileByPath(record.notePath);
    const meta=f?parseNote(await vault.read(f)).doc.toJS():{};
    if(f && meta.codex_thread_id!==id)throw Error('The old note\'s task ID doesn\'t match — migration stopped.');
    const daily=/^\[\[(.+)\/(\d{4}-\d{2}-\d{2})\]\]$/.exec(meta.daily||'');
    if(record.notePath)notes.add(record.notePath.split('/').slice(0,-1).join('/'));
    const folder=Object.values(record.attachments||{}).map(a=>a.path?.split('/').slice(0,-2).join('/')).find(Boolean);
    if(folder)assets.add(folder);
    if(daily)days.add(daily[1]);
    if(!daily && f)throw Error('Couldn\'t confirm the old note\'s daily link — migration stopped.');
    // Existing metadata is authoritative; it is never regenerated in another zone.
    threads[id]={...record,routing:{timeZone:settings.timeZone,dailyTemplate:settings.dailyTemplate,...(daily?{dailyFolder:daily[1],day:daily[2]}:{}),...(folder?{attachmentFolder:folder}:{}),...(record.notePath?{noteFolder:record.notePath.split('/').slice(0,-1).join('/')}:{})}};
  }
  const fieldLabel={noteFolder:'Notes folder',attachmentFolder:'Attachments folder',dailyFolder:'Daily notes folder'};
  for(const [key,set] of [['noteFolder',notes],['attachmentFolder',assets],['dailyFolder',days]]){if(set.size===1)settings[key]=[...set][0];else warnings.push(fieldLabel[key]+': confirm the save location for new tasks.');}
  warnings.push('Confirm the time zone for new tasks — existing notes\' creation times and daily links are unchanged.');
  validateSettings(settings);
  for(const record of Object.values(threads))record.routing={noteFolder:settings.noteFolder,attachmentFolder:settings.attachmentFolder,dailyFolder:settings.dailyFolder,...record.routing};
  return {schemaVersion:3,settings,threads,discoveryStartedAt:old.discoveryStartedAt,enabled:false,migrationWarnings:warnings};
}
function startState(state,checked,now=Date.now()){
  validateSettings(state.settings);
  if(!state.settings.consent || !checked)throw Error('Confirm outside-vault access and pass the connection check first.');
  return {...state,enabled:true,migrationWarnings:[],discoveryStartedAt:state.discoveryStartedAt??Math.ceil(now/1000)};
}
module.exports={QUERY,DEFAULT_TEMPLATE,defaults,vaultPath,validateSettings,routing,upgradeState,startState};
