const {Plugin,Notice,FuzzySuggestModal,PluginSettingTab,Setting,getLanguage}=require('obsidian');
const {CodexClient}=require('./rpc');
const {codexExecutable}=require('./platform');
const {allAttachments}=require('./tasks');
const {syncBatch}=require('./batch');
const {handleThumbnailClick}=require('./thumbnails');
const {upgradeState,validateSettings,startState,QUERY}=require('./settings');
const {checkConnection}=require('./connection');
const {translate,languageForHost}=require('./i18n');
const {BrowserLogin}=require('./auth');

function existingVaultFolders(vault){
  try{return [...new Set((vault?.getAllFolders?.()||[]).map(folder=>folder.path).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));}catch{return [];}
}
function existingVaultMarkdownFiles(vault){
  try{return [...new Set((vault?.getMarkdownFiles?.()||[]).map(file=>file.path).filter(path=>path?.endsWith('.md')))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));}catch{return [];}
}
function availableTimeZones(){
  try{return Intl.supportedValuesOf('timeZone');}catch{return [];}
}
function addSuggestions(container,input,id,paths){
  if(!paths.length)return;
  const list=container.createEl('datalist',{attr:{id}});
  for(const path of paths)list.createEl('option',{attr:{value:path}});
  input.inputEl.setAttribute('list',id);
}

class NotePicker extends FuzzySuggestModal {
  constructor(app,records,t){super(app);this.records=records;this.t=t;this.setPlaceholder(t('Choose a Codex conversation note'));}
  getItems(){return this.records;}
  getItemText(item){return item.name||this.t('Codex conversation');}
  onChooseItem(item){void this.app.workspace.openLinkText(item.notePath,'',true);}
}
class TemplatePicker extends FuzzySuggestModal {
  constructor(app,files,onChoose,t){super(app);this.files=files;this.onChoose=onChoose;this.setPlaceholder(t('Choose a daily note template'));}
  getItems(){return this.files;}
  getItemText(item){return item;}
  onChooseItem(item){this.onChoose(item);}
}
class SyncSettings extends PluginSettingTab {
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  hide(){this.plugin.authMessageEl=null;}
  display(){
    const p=this.plugin,c=this.containerEl;c.empty();const draft={...p.state.settings};const t=p.t.bind(p);
    // Obsidian's official settings-tab lint (no-problematic-settings-headings)
    // rejects a heading that repeats the plugin's own name — the settings tab
    // already shows it. Lead straight into the settings themselves.
    for(const warning of p.state.migrationWarnings||[])c.createEl('p',{cls:'codex-daybook-note is-warning',text:t(warning)});

    const folderKeys=new Set(['noteFolder','attachmentFolder','dailyFolder']);
    const folders=existingVaultFolders(p.app.vault),templates=existingVaultMarkdownFiles(p.app.vault),timeZones=availableTimeZones(),folderHint=t('Start typing to choose an existing folder, or enter a new vault-relative path.'),templateHint=t('Start typing to choose an existing Markdown note, or click Choose template… to search this vault.'),timeZoneHint=t('Start typing to choose from the list, or enter an IANA name directly.');
    // Shared by every folder/template/timezone/interval field, regardless of
    // which tab's panel it ends up rendered in.
    function addField(container,key,label,help){
      const setting=new Setting(container).setName(label).setDesc(folderKeys.has(key)?`${help} ${folderHint}`:(key==='dailyTemplate'?`${help} ${templateHint}`:(key==='timeZone'&&timeZones.length?`${help} ${timeZoneHint}`:help)));
      let field;
      setting.addText(input=>{
        field=input;
        input.setValue(String(draft[key]));
        if(folderKeys.has(key))addSuggestions(c,input,`codex-daybook-folder-${key}`,folders);
        if(key==='dailyTemplate')addSuggestions(c,input,'codex-daybook-template-dailyTemplate',templates);
        if(key==='timeZone')addSuggestions(c,input,'codex-daybook-timezone',timeZones);
        input.onChange(v=>{draft[key]=key==='intervalSeconds'?Number(v):v;});
      });
      if(key==='dailyTemplate')setting.addButton(button=>button.setButtonText(t('Choose template…')).setDisabled(!templates.length).onClick(()=>new TemplatePicker(p.app,templates,path=>{draft.dailyTemplate=path;field.setValue(path);},t).open()));
      return field;
    }

    // Two tabs — Basic settings (everything needed to just collect
    // conversations) and Daily track (the optional time-trail feature) —
    // replacing the earlier collapsed Advanced section entirely. A shared
    // status message sits below the tab bar so it's visible no matter which
    // tab is open.
    const tabs=c.createEl('div',{cls:'codex-daybook-tabs'});
    const basicTabButton=tabs.createEl('button',{cls:'codex-daybook-tab',text:t('Basic settings')});
    const dailyTabButton=tabs.createEl('button',{cls:'codex-daybook-tab',text:t('Daily track')});
    const message=c.createEl('p',{cls:'codex-daybook-note',text:p.diagnostic||(p.state.enabled?t('Syncing'):t('Paused — awaiting setup'))});
    p.authMessageEl=message;
    const basicPanel=c.createEl('div',{cls:'codex-daybook-panel-basic'});
    const dailyPanel=c.createEl('div',{cls:'codex-daybook-panel-daily'});
    function selectTab(name){
      const basic=name==='basic';
      basicPanel.hidden=!basic;dailyPanel.hidden=basic;
      basicTabButton.toggleClass('is-active',basic);dailyTabButton.toggleClass('is-active',!basic);
    }
    basicTabButton.onclick=()=>selectTab('basic');
    dailyTabButton.onclick=()=>selectTab('daily');
    selectTab('basic');

    // Basic settings tab — everything needed to just collect conversations.
    new Setting(basicPanel).setName(t('Language')).setDesc(t('Save settings to apply the selected language.'))
      .addDropdown(d=>d.addOption('zh','简体中文').addOption('en','English').setValue(draft.language).onChange(value=>{draft.language=value;}));
    addField(basicPanel,'noteFolder',t('Notes folder'),t('Vault-relative folder for synced conversation notes.'));
    addField(basicPanel,'attachmentFolder',t('Attachments folder'),t('Vault-relative folder for copied images.'));
    let executableField;
    new Setting(basicPanel).setName(t('Codex executable')).setDesc(t('Leave blank to auto-detect a standard install or PATH entry, or enter a full path. On Windows, pick the real codex.exe — not a .cmd shim or WSL.'))
      .addText(input=>{executableField=input;input.setValue(draft.executable).onChange(v=>{draft.executable=v;});})
      .addButton(b=>b.setButtonText(t('Scan')).onClick(()=>{
        // Synchronous, local-only filesystem/PATH lookup — same check the
        // plugin already runs on connect/login, just surfaced on demand so a
        // user isn't stuck guessing whether leaving the field blank will work.
        try{
          const found=p.detectExecutable();
          draft.executable=found;executableField.setValue(found);
          message.setText(t('Found Codex at {path}.',{path:found}));
        }catch(error){
          message.setText(error.message?t(error.message):t('Could not find Codex automatically. Try Browse, or enter the full path.'));
        }
      }))
      .addButton(b=>b.setButtonText(t('Browse…')).onClick(()=>{
        const input=c.createEl('input',{type:'file',cls:'codex-daybook-file-picker'});
        input.oncancel=()=>input.remove();
        input.onchange=()=>{
          const file=input.files?.[0];
          const path=file&&(file.path||require('electron').webUtils?.getPathForFile(file));
          input.remove();
          if(path){draft.executable=path;executableField.setValue(path);}
        };
        input.click();
      }));
    addField(basicPanel,'timeZone',t('Time zone'),t('IANA name, e.g. Asia/Tokyo, Europe/London.'));
    addField(basicPanel,'intervalSeconds',t('Check interval (seconds)'),t('5–3600 seconds; default is 10.'));
    new Setting(basicPanel).setName(t('Allow access outside the vault')).setDesc(t('The plugin launches the local Codex app-server, reuses your existing ChatGPT login, and reads task data plus any local images explicitly attached to messages. The connection check reads a small sample from one existing task to verify the interface, without importing it. The plugin sends no uploads or telemetry; Codex itself may still use its own account services.')).addToggle(t=>t.setValue(draft.consent).onChange(v=>{draft.consent=v;}));

    const bindButton=(b,label,fn)=>b.setButtonText(label).onClick(async()=>{const language=p.state.settings.language;b.setDisabled(true);try{await fn();message.setText(p.diagnostic||t('Settings saved'));}catch(error){message.setText(error.safeMessage?t(error.safeMessage):t('Action failed — check your settings, Codex login and version. Local copies are kept.'));}finally{b.setDisabled(false);if(p.state.settings.language!==language){p.diagnostic=message.textContent;this.update();}}});
    new Setting(basicPanel).setName(t('Codex account')).setDesc(t('Automatically finds local Codex. Reuses your ChatGPT login when available, or opens the official login page. Codex must be installed on this computer.'))
      .addButton(b=>bindButton(b,t('Log in to Codex'),async()=>{if(p.loginSession?.active)throw {safeMessage:t('A login is already in progress. Finish it in your browser or cancel it here.')};await p.configure(draft);await p.login();}))
      .addButton(b=>bindButton(b,t('Cancel login'),()=>p.cancelLogin()));

    new Setting(basicPanel)
      .addButton(b=>bindButton(b,t('Save settings'),async()=>{await p.configure(draft);p.diagnostic=t('Settings saved. Sync is paused — check the connection to start.');}))
      .addButton(b=>bindButton(b,t('Check connection'),async()=>{await p.configure(draft);await p.connect();}));
    new Setting(basicPanel)
      .addButton(b=>bindButton(b,t('Start sync'),async()=>{if(JSON.stringify(validateSettings(draft))!==JSON.stringify(p.state.settings))throw {safeMessage:t('Settings not saved yet — check the connection first.')};await p.begin();}))
      .addButton(b=>bindButton(b,t('Pause sync'),()=>p.pause()));

    // Daily track tab — off by default, gated behind its own toggle. The
    // fields below it are always built (draft.dailyFolder/dailyTemplate keep
    // flowing through their normal onChange handlers either way) — only
    // `.hidden` changes on toggle, never a full re-`display()`, so no other
    // unsaved draft edit is ever discarded by flipping this switch.
    const dailyFields=dailyPanel.createEl('div',{cls:'codex-daybook-daily-fields'});
    new Setting(dailyPanel).setName(t('Enable daily track')).setDesc(t('Add a daily: link to each synced conversation, and automatically create that day\'s note if it does not exist yet. The daily notes location and template already have working defaults, so turning this on needs no further setup.'))
      .addToggle(toggle=>toggle.setValue(draft.dailyTrackEnabled).onChange(v=>{draft.dailyTrackEnabled=v;dailyFields.hidden=!v;}));
    dailyFields.hidden=!draft.dailyTrackEnabled;
    addField(dailyFields,'dailyFolder',t('Daily notes location'),t('Daily notes help you find Codex conversations by the date each task was created. Enter a folder inside this vault, such as Daily; a note will be saved as Daily/2026-09-20.md. Existing daily notes are never overwritten.'));
    addField(dailyFields,'dailyTemplate',t('Use your own daily template (optional)'),t('Unsure? Leave this blank. The built-in layout includes a conversation list, displayed by the Dataview plugin. To use your own layout, enter the path to an existing note in this vault, such as Templates/Daily.md. It is used only when creating a daily note.'));
    new Setting(dailyFields).setName(t('Conversation list for daily notes')).setHeading();
    dailyFields.createEl('p',{cls:'codex-daybook-note',text:t('Using your own template or an existing daily note? Paste the code below into it to show links to conversations created that day. Install and enable Dataview to display the list. The built-in template already includes this code.')});
    dailyFields.createEl('p',{cls:'codex-daybook-note',text:t('In a custom template, {{date:YYYY-MM-DD}} becomes the date (for example, 2026-09-20). Other placeholders and Templater scripts are not supported.')});
    dailyFields.createEl('textarea',{cls:'codex-daybook-query',text:QUERY,attr:{readonly:'true',rows:'6','aria-label':t('Dataview query example')}});
    new Setting(dailyFields).addButton(b=>bindButton(b,t('Copy query'),async()=>{await navigator.clipboard.writeText(QUERY);p.diagnostic=t('Query copied to clipboard.');}));
  }
}
module.exports=class CodexDailySync extends Plugin {
  t(message,values){return translate(this.state?.settings?.language||this.initialLanguage||'en',message,values);}
  refreshCommandNames(){for(const [command,key] of this.localizedCommands||[])command.name=`${this.manifest.name||'Codex Daybook'}: ${this.t(key)}`;}
  registerLocalizedCommand(command){const key=command.name;command.name=this.t(key);const registered=this.addCommand(command);this.localizedCommands.push([registered||command,key]);}
  async onload(){
    this.stopped=false;this.running=false;this.generation=0;this.checked=false;this.controlBusy=false;
    this.initialLanguage=languageForHost(typeof getLanguage==='function'?getLanguage():'en');
    this.localizedCommands=[];this.status=this.addStatusBarItem();
    const saved=(await this.loadData())||{};let dailyConfig={};
    if(['zh','en'].includes(saved.settings?.language))this.initialLanguage=saved.settings.language;
    if(saved.schemaVersion!==3 && Object.keys(saved).length){try{dailyConfig=JSON.parse(await this.app.vault.adapter.read(this.app.vault.configDir+'/daily-notes.json'));}catch{}}
    try{this.state=await upgradeState(saved,this.app.vault,dailyConfig,this.initialLanguage);}catch(error){new Notice(this.t(error.message));throw error;}
    if(this.state!==saved)await this.saveData(this.state);
    this.addSettingTab(new SyncSettings(this.app,this));
    this.registerDomEvent(document,'click',event=>{if(!this.stopped)handleThumbnailClick(event,this.app,allAttachments(this.state),()=>new Notice(this.t('Could not open the image — check the local copy.')));},true);
    this.registerLocalizedCommand({id:'sync-now',name:'Sync enrolled tasks now',callback:()=>{if(!this.running)new Notice(this.t('Check the connection and start sync from settings first.'));else void this.sync(true);}});
    this.registerLocalizedCommand({id:'open-settings',name:'Open sync settings',callback:()=>this.openSettings()});
    this.registerLocalizedCommand({id:'open-note',name:'Open a synced note',callback:()=>{const records=Object.values(this.state.threads).filter(t=>t.notePath&&this.app.vault.getAbstractFileByPath(t.notePath));if(records.length===1)void this.app.workspace.openLinkText(records[0].notePath,'',true);else if(records.length)new NotePicker(this.app,records,this.t.bind(this)).open();else new Notice(this.t('No synced note found in this vault.'));}});
    this.status.setText(this.t('Codex sync: paused'));
    this.app.workspace.onLayoutReady(()=>{if(this.stopped)return;if(this.state.enabled)void this.resume().catch(()=>new Notice(this.t('Codex connection check failed — reconnect from settings. Local copies are kept.')));else this.openSettings();});
  }
  // app.setting has no public API (obsidian.d.ts does not declare it), so it
  // cannot be opened programmatically without relying on an undocumented,
  // unstable internal. Point the user there instead.
  openSettings(){new Notice(this.t('Open Settings → Community plugins → Codex Daybook to configure sync.'));}
  // app.plugins is likewise undocumented; read the same community-plugins.json
  // manifest Obsidian itself maintains, via the public vault adapter — the
  // same approach already used for the 0.4 daily-notes.json migration read.
  async dataviewEnabled(){
    try{
      const list=JSON.parse(await this.app.vault.adapter.read(this.app.vault.configDir+'/community-plugins.json'));
      return Array.isArray(list)&&list.includes('dataview');
    }catch{return false;}
  }
  async dataview(){if(this.state.settings.dailyTrackEnabled && !(await this.dataviewEnabled()))throw {safeMessage:this.t('Install and enable Dataview before starting sync.')};}
  // Read-only lookup through Obsidian's own link index — resolves a plain
  // wikilink Codex wrote in its own reply to a file it already saved directly
  // into the vault. Never scans paths, imports, or creates anything.
  resolveEmbed(linkpath){
    const file=this.app.metadataCache.getFirstLinkpathDest(linkpath,'');
    return file && !('children' in file) ? file.extension : null;
  }
  async save(next){await this.saveData(next);this.state=next;}
  async stopRuntime(){if(this.loginSession?.active)this.setLoginMessage('Login cancelled. Existing Codex login and local notes are kept.');this.loginSession?.dispose();this.loginSession=null;this.running=false;this.checked=false;this.generation++;window.clearInterval(this.timer);this.timer=null;this.client?.stop();this.client=null;await this.flight?.catch(()=>{});}
  async control(fn){if(this.controlBusy)throw {safeMessage:this.t('An operation is already in progress — please wait.')};this.controlBusy=true;try{return await fn();}finally{this.controlBusy=false;}}
  async configure(draft){return this.control(async()=>{let settings;try{settings=validateSettings(draft);}catch(e){throw {safeMessage:this.t(e.message)};}await this.stopRuntime();await this.save({...this.state,settings,enabled:false});this.refreshCommandNames();this.status.setText(this.t('Codex sync: paused'));});}
  createClient(executable){return new CodexClient(executable);}
  // Ignores any saved/typed path and always re-runs auto-detection, for the
  // settings panel's on-demand Scan button — a separate concern from
  // connectInternal()/login(), which respect whatever is already configured.
  detectExecutable(){return codexExecutable('');}
  openLoginUrl(url){return require('electron').shell.openExternal(url);}
  setLoginMessage(key){this.loginMessage=key;this.authMessageEl?.setText(this.t(key));}
  async login(){return this.control(async()=>{
    if(this.stopped)throw {safeMessage:this.t('The plugin has stopped.')};
    if(!this.state.settings.consent)throw {safeMessage:this.t('Confirm outside-vault access and save your settings first.')};
    await this.stopRuntime();
    if(this.state.enabled)await this.save({...this.state,enabled:false});
    const generation=this.generation;
    try{
      const executable=codexExecutable(this.state.settings.executable);
      const client=this.createClient(executable);this.client=client;await client.start();
      const account=await client.request('account/read',{refreshToken:false});
      if(!account||!Object.hasOwn(account,'account'))throw Error('Invalid account response.');
      if(this.stopped||generation!==this.generation){client.stop();return;}
      if(account?.account?.type==='chatgpt'){
        this.setLoginMessage('Already logged in to Codex. Check the connection, then start sync.');
        this.diagnostic=this.t(this.loginMessage);this.status.setText(this.t('Codex sync: paused'));client.stop();this.client=null;return;
      }
      this.setLoginMessage('Finish signing in on the official page in your browser. Keep Obsidian open.');
      this.diagnostic=this.t(this.loginMessage);this.status.setText(this.t('Codex sync: awaiting login'));
      const session=new BrowserLogin(client,{openUrl:url=>this.openLoginUrl(url),onFinish:status=>{
        if(this.stopped||generation!==this.generation)return;
        const messages={success:'Login completed. Check the connection, then start sync.',failed:'Login failed or the connection closed. Try again; local notes are kept.',cancelled:'Login cancelled. Existing Codex login and local notes are kept.'};
        this.setLoginMessage(messages[status]);this.diagnostic=this.t(this.loginMessage);
        this.status.setText(this.t('Codex sync: paused'));this.loginSession=null;
        client.stop();if(this.client===client)this.client=null;
      }});
      this.loginSession=session;await session.start();
    }catch(error){
      this.loginSession?.dispose();this.loginSession=null;this.client?.stop();this.client=null;
      this.setLoginMessage('Could not start login. Check your local Codex installation or the executable path above.');
      this.diagnostic=this.t(this.loginMessage);this.status.setText(this.t('Codex sync: paused'));
      throw {safeMessage:error.safeMessage?this.t(error.safeMessage):this.diagnostic};
    }
  });}
  async cancelLogin(){return this.control(async()=>{
    if(this.loginSession?.active)await this.loginSession.cancel();
    else this.diagnostic=this.t('No login is currently pending.');
  });}
  async connect(){return this.control(()=>this.connectInternal());}
  async connectInternal(){
    if(this.stopped)throw Error('Stopped');
    if(!this.state.settings.consent)throw {safeMessage:this.t('Confirm outside-vault access and save your settings first.')};
    await this.dataview();await this.stopRuntime();const generation=this.generation;
    try{
      let executable;try{executable=codexExecutable(this.state.settings.executable);}catch(e){throw {safeMessage:this.t(e.message)};}
      const client=this.createClient(executable);this.client=client;await client.start();
      await checkConnection(client.request.bind(client));
      if(this.stopped||generation!==this.generation||client.closed)throw Error('Stopped');
      this.checked=true;this.diagnostic=this.t('Connection and pagination check passed. New tasks are only enrolled once you click Start sync.');this.status.setText(this.t('Codex sync: connection verified'));
    }catch(error){this.client?.stop();this.client=null;this.checked=false;this.diagnostic=error.safeMessage?this.t(error.safeMessage):this.t('Connection check failed — check Codex login, version and the paging interface. Local copies are kept.');throw {safeMessage:this.diagnostic};}
  }
  async begin(){return this.control(async()=>{
    await this.dataview();if(this.stopped||this.client?.closed||!this.client)throw {safeMessage:this.t('Check the connection first.')};
    const generation=this.generation;
    let next;try{next=startState(this.state,this.checked);}catch(e){throw {safeMessage:this.t(e.message)};}
    await this.save(next);if(this.stopped||generation!==this.generation)return;this.running=true;window.clearInterval(this.timer);
    this.timer=this.registerInterval(window.setInterval(()=>void this.sync(false),this.state.settings.intervalSeconds*1000));
    this.diagnostic=this.t('Sync started. The fixed starting point has been saved.');this.status.setText(this.t('Codex sync: running'));void this.sync(true);
  });}
  async resume(){await this.connect();await this.begin();}
  async pause(){return this.control(async()=>{await this.stopRuntime();await this.save({...this.state,enabled:false});this.diagnostic=this.t('Sync paused. The starting point and local copies are kept.');this.status.setText(this.t('Codex sync: paused'));});}
  sync(manual=false){if(!this.running||this.stopped||this.flight)return this.flight;const job=this.syncInternal(manual);this.flight=job;void job.finally(()=>{if(this.flight===job)this.flight=null;});return job;}
  async syncInternal(manual){
    const generation=this.generation,alive=()=>!this.stopped&&this.running&&generation===this.generation;
    try{
      await this.dataview();
      const {report}=await syncBatch({vault:this.app.vault,rpc:this.client.request.bind(this.client),state:this.state,alive,persist:next=>this.save(next),resolveEmbed:this.resolveEmbed.bind(this)});
      if(!alive())return;
      this.lastCheck={at:new Date().toISOString(),notes:report.notes,changed:report.changed,images:report.images,copiedImages:report.copiedImages,missingImages:report.missingImages,errors:report.errors.map(e=>({kind:e.kind}))};
      this.status.setText(this.t('Codex sync: {notes} notes · {status}',{notes:report.notes,status:report.errors.length?this.t('partial failure'):this.t('{seconds}s interval',{seconds:this.state.settings.intervalSeconds})}));
      const unavailable=report.errors.filter(e=>e.kind==='source');
      const missingCopies=unavailable.filter(e=>{const record=this.state.threads[e.id];return !record?.notePath||!this.app.vault.getAbstractFileByPath(record.notePath);}).length;
      const messages=[];
      if(unavailable.length)messages.push(missingCopies?this.t('{count} source conversation(s) are unavailable; {missing} of them have no local note yet. Existing local copies are unchanged.',{count:unavailable.length,missing:missingCopies}):this.t('Source conversations are unavailable. Local copies are kept.'));
      if(report.errors.some(e=>e.kind!=='source'))messages.push(this.t('Some syncs failed — check the connection and the notes\' sync markers. Existing local files are unchanged.'));
      const message=messages.join('\n')||null;
      if(message&&(manual||this.lastError!==message))new Notice(message,10000);
      this.lastError=message;
      if(manual||report.changed)new Notice(this.t('Codex sync: {count} note(s) updated{images}',{count:report.changed,images:report.missingImages?this.t('; some original images are missing, text was kept'):''}));
    }catch{
      if(alive()){this.diagnostic=this.t('Sync unavailable — local copies are kept. Reconnect from settings.');this.status.setText(this.t('Codex sync: awaiting reconnect'));if(manual||this.lastError!==this.diagnostic)new Notice(this.diagnostic);this.lastError=this.diagnostic;this.running=false;this.checked=false;window.clearInterval(this.timer);this.client?.stop();}
    }
  }
  onunload(){this.loginSession?.dispose();this.loginSession=null;this.authMessageEl=null;this.stopped=true;this.running=false;this.checked=false;this.generation++;window.clearInterval(this.timer);this.client?.stop();}
};
