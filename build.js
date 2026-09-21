const esbuild = require('esbuild');
const fs = require('node:fs');
const license=fs.readFileSync('LICENSE','utf8');
const runtimeNotice='yaml (runtime, ISC)\n\n'+fs.readFileSync('node_modules/yaml/LICENSE','utf8');
// Community installs download main.js, not the supplemental notice file.
esbuild.buildSync({entryPoints:['src/main.js'],bundle:true,platform:'node',format:'cjs',target:'es2022',external:['obsidian','electron'],outfile:'dist/main.js',banner:{js:'/*!\n'+license+'\n---\n'+runtimeNotice+'\n*/'}});
fs.copyFileSync('manifest.json','dist/manifest.json');
fs.copyFileSync('styles.css','dist/styles.css');
fs.copyFileSync('LICENSE','dist/LICENSE');
const notices=[['yaml (runtime, ISC)','node_modules/yaml/LICENSE'],['esbuild (build-time, MIT)','node_modules/esbuild/LICENSE.md']].map(([name,file])=>name+'\n\n'+fs.readFileSync(file,'utf8')).join('\n\n---\n\n');
fs.writeFileSync('THIRD-PARTY-NOTICES.txt',notices);
fs.writeFileSync('dist/THIRD-PARTY-NOTICES.txt',notices);
