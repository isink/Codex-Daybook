const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');process.chdir(root);
const manifest=require('../manifest.json'),pkg=require('../package.json');
if(manifest.version!==pkg.version||manifest.version!==require('../package-lock.json').version||manifest.version!==require('../dist/manifest.json').version)throw Error('Version mismatch');
const {install,docs,source,scan}=require('./release-files');
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes){let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
// Small deterministic ZIP writer (stored entries, UTF-8). No external tool or dependency.
function zip(entries){const local=[],central=[];let offset=0;
  for(const [name,bytes]of entries){scan(name,bytes);const n=Buffer.from(name),c=crc(bytes);const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(0x5c21,12);h.writeUInt32LE(c,14);h.writeUInt32LE(bytes.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(n.length,26);local.push(h,n,bytes);
    const d=Buffer.alloc(46);d.writeUInt32LE(0x02014b50);d.writeUInt16LE(20,4);d.writeUInt16LE(20,6);d.writeUInt16LE(0x800,8);d.writeUInt16LE(0x5c21,14);d.writeUInt32LE(c,16);d.writeUInt32LE(bytes.length,20);d.writeUInt32LE(bytes.length,24);d.writeUInt16LE(n.length,28);d.writeUInt32LE(offset,42);central.push(d,n);offset+=h.length+n.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
const dir='release/'+manifest.version;fs.mkdirSync(dir,{recursive:true});
const bundles=[[manifest.id+'-'+manifest.version+'.zip',install.map(f=>[manifest.id+'/'+f,fs.readFileSync('dist/'+f)])],[manifest.id+'-'+manifest.version+'-source.zip',source.map(f=>[manifest.id+'-source/'+f,fs.readFileSync(f)])]];
const checks=[];
for(const [name,entries]of bundles){const bytes=zip(entries);fs.writeFileSync(dir+'/'+name,bytes);checks.push(createHash('sha256').update(bytes).digest('hex')+'  '+name);}
for(const f of docs){const b=fs.readFileSync(f);scan(f,b);fs.writeFileSync(dir+'/'+f,b);checks.push(createHash('sha256').update(b).digest('hex')+'  '+f);}
for(const f of ['main.js','manifest.json','styles.css']){const b=fs.readFileSync('dist/'+f);scan(f,b);fs.writeFileSync(dir+'/'+f,b);checks.push(createHash('sha256').update(b).digest('hex')+'  '+f);}
fs.writeFileSync(dir+'/SHA256SUMS.txt',checks.join('\n')+'\n');
console.log('Local candidate created; privacy allowlist scan passed. No upload. Desktop acceptance and community publication are separate gates; consult VALIDATION.md.');
