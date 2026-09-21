const test=require('node:test'),assert=require('node:assert/strict');
const {scan,source,install}=require('../scripts/release-files');
test('publish allowlist includes the license and build/check inputs, excludes personal configuration',()=>{
  for(const f of ['LICENSE','eslint.config.mjs','tsconfig.json','.github/workflows/ci.yml','scripts/check-release.js'])assert.ok(source.includes(f));
  assert.ok(install.includes('LICENSE'));assert.ok(!source.includes('data.json'));
});
test('privacy scanner blocks personal paths, credentials, task identifiers and forbidden names',()=>{
  for(const name of ['data.json','auth.json','.obsidian/workspace.json','backup.zip'])assert.throws(()=>scan(name,Buffer.from('safe')));
  const paths=['/'+['Users','example','private'].join('/'),['C:','Users','example','secret'].join('\\')];
  const id=['a'.repeat(8),'b'.repeat(4),'c'.repeat(4),'d'.repeat(4),'e'.repeat(12)].join('-');
  for(const text of [...paths,id,'sk-'+ 'a'.repeat(30)])assert.throws(()=>scan('main.js',Buffer.from(text)));
  assert.doesNotThrow(()=>scan('README.md',Buffer.from('MIT; fictional test data only.')));
});
