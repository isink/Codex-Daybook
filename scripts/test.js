const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const tests=fs.readdirSync('test').filter(f=>f.endsWith('.test.js')).sort().map(f=>'test/'+f);
const result=spawnSync(process.execPath,['--test',...tests],{stdio:'inherit',shell:false});
if(result.error)throw result.error;
process.exitCode=result.status??1;
