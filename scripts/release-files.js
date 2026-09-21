// Explicit publish allowlists. Never package a vault, configuration or tool cache.
const install=['main.js','manifest.json','styles.css','LICENSE','THIRD-PARTY-NOTICES.txt'];
const docs=['README.md','README.en.md','PRIVACY.md','CHANGELOG.md','WINDOWS-CHECKLIST.md','ACCEPTANCE.md','RELEASE.md','VALIDATION.md','LICENSE','THIRD-PARTY-NOTICES.txt'];
const source=[...docs,'manifest.json','versions.json','package.json','package-lock.json','build.js','eslint.config.mjs','tsconfig.json','.gitignore','.gitattributes','styles.css','.github/workflows/ci.yml',
  ...['core','tasks','batch','rpc','main','attachments','thumbnails','settings','platform','connection','errors','i18n','auth'].map(x=>'src/'+x+'.js'),
  ...['sync.test','multi.test','lifecycle.test','thumbnails.test','release.test','settings-ui.test','i18n.test','auth.test','retry.test','distribution.test','setup'].map(x=>'test/'+x+'.js'),
  ...['probe','package','fixture-server','test','check-release','release-files'].map(x=>'scripts/'+x+'.js')];
function scan(name,bytes){
  if(/(^|\/)(data\.json|auth\.json|\.claude|\.obsidian)|backup/i.test(name))throw Error('Forbidden release entry: '+name);
  const text=bytes.toString('utf8');
  if(/\/Users\/[^/\s]+\/|\/var\/folders\/|[A-Z]:[\\/]+Users[\\/]+[^\\/\s]+[\\/]|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}/i.test(text))throw Error('Privacy scan failed: '+name);
}
module.exports={install,docs,source,scan};
