import { cp, mkdir, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const data = JSON.parse(await readFile(new URL('../public/data/regions.json', import.meta.url)));
if (!data.provinces?.length || data.provinces.some(p => !p.path || !p.destinations?.length)) throw new Error('지역 데이터가 불완전합니다.');
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await cp(new URL('../public/', import.meta.url), new URL('../dist/', import.meta.url), { recursive: true });
await cp(new URL('../src/', import.meta.url), new URL('../dist/src/', import.meta.url), { recursive: true });
// One content version for the entry point and all local modules prevents a
// cached config/module from mixing with a newly deployed HTML document.
const modules=(await readdir(new URL('../src/',import.meta.url))).filter(name=>name.endsWith('.js')).sort();
const assets=['index.html','style.css','firebase-config.js',...modules.map(name=>`src/${name}`)];
const hash=createHash('sha256');
for(const name of assets) hash.update(await readFile(new URL(`../dist/${name}`,import.meta.url)));
const version=hash.digest('hex').slice(0,12);
for(const name of ['firebase-config.js',...modules.map(name=>`src/${name}`)]) {
  const file=new URL(`../dist/${name}`,import.meta.url);
  const source=await readFile(file,'utf8');
  await writeFile(file,source.replace(/(from\s*['"])(\.{1,2}\/[^'"]+\.js)(['"])/g,`$1$2?v=${version}$3`));
}
const entry=new URL('../dist/index.html',import.meta.url);
await writeFile(entry,(await readFile(entry,'utf8')).replace('./src/app.js',`./src/app.js?v=${version}`).replace('./style.css',`./style.css?v=${version}`));
await mkdir(new URL('../dist/vendor/icons/fonts/', import.meta.url), { recursive: true });
await cp(new URL('../node_modules/bootstrap/dist/css/bootstrap.min.css', import.meta.url),new URL('../dist/vendor/bootstrap.min.css',import.meta.url));
await cp(new URL('../node_modules/bootstrap/LICENSE', import.meta.url),new URL('../dist/vendor/bootstrap-LICENSE.txt',import.meta.url));
await cp(new URL('../node_modules/bootstrap-icons/font/bootstrap-icons.min.css', import.meta.url),new URL('../dist/vendor/icons/bootstrap-icons.min.css',import.meta.url));
await cp(new URL('../node_modules/bootstrap-icons/font/fonts/', import.meta.url),new URL('../dist/vendor/icons/fonts/',import.meta.url),{recursive:true});
await cp(new URL('../node_modules/bootstrap-icons/LICENSE', import.meta.url),new URL('../dist/vendor/icons-LICENSE.txt',import.meta.url));
console.log(`Build OK: ${root}dist (${data.provinces.length}개 시·도 / ${data.provinces.reduce((n,p)=>n+p.destinations.length,0)}개 최종 후보)`);
