require('./setup');
const test=require('node:test'),assert=require('node:assert/strict');
const {translate,languageForHost,zh}=require('../src/i18n');
const {upgradeState,defaults,validateSettings}=require('../src/settings');
test('host language selects only Chinese or English and existing saved preference wins',async()=>{
  for(const lang of ['zh','zh-CN','zh-TW'])assert.equal(languageForHost(lang),'zh');
  for(const lang of ['en','en-GB','fr',''])assert.equal(languageForHost(lang),'en');
  assert.equal((await upgradeState({},null,{},'zh')).settings.language,'zh');
  const settings=defaults();delete settings.language;
  const saved={schemaVersion:3,settings,enabled:false,discoveryStartedAt:1700000000,threads:{}};
  const migrated=await upgradeState(saved,null,{},'zh');assert.equal(migrated.settings.language,'zh');
  assert.equal(migrated.discoveryStartedAt,saved.discoveryStartedAt);assert.deepEqual(migrated.threads,saved.threads);
  assert.equal(saved.settings.language,undefined,'migration never mutates the input');
  assert.equal((await upgradeState({...migrated,settings:{...migrated.settings,language:'en'}},null,{},'zh')).settings.language,'en');
  assert.throws(()=>validateSettings({...defaults(),language:'fr'}),/Chinese or English/);
});
test('all translations preserve substitution tokens, template syntax and unknown diagnostic text',()=>{
  const tokens=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
  for(const [en,text] of Object.entries(zh)){assert.ok(text.trim());assert.deepEqual(tokens(text),tokens(en),en);}
  assert.equal(translate('zh','Codex sync: {count} note(s) updated{images}',{count:2,images:''}),'Codex 同步：已更新 2 篇笔记');
  assert.equal(translate('en','Codex sync: {count} note(s) updated{images}',{count:2,images:''}),'Codex sync: 2 note(s) updated');
  assert.match(translate('zh','In a custom template, {{date:YYYY-MM-DD}} becomes the date (for example, 2026-09-20). Other placeholders and Templater scripts are not supported.'),/\{\{date:YYYY-MM-DD\}\}/);
  assert.equal(translate('zh','unexpected safe diagnostic'),'unexpected safe diagnostic');
});
