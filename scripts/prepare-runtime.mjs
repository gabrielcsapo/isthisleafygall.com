import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareRuntime } from './lib/runtime-files.mjs';
await prepareRuntime();
const catalog=JSON.parse(await readFile('data/references.json','utf8'));
for(const r of catalog.references.filter(x=>x.file.startsWith('dist/assets/'))){
 if(existsSync(r.file)) {
  if(createHash('sha256').update(await readFile(r.file)).digest('hex')!==r.sha256)throw new Error(`Pinned reference thumbnail ${r.id} changed; review its catalog hash.`);
  continue;
 }
 const response=await fetch(r.image_url,{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Reference thumbnail ${r.id} could not load (${response.status})`);
 const data=new Uint8Array(await response.arrayBuffer());
 if(createHash('sha256').update(data).digest('hex')!==r.sha256)throw new Error(`Reference thumbnail ${r.id} changed; review it before rebuilding.`);
 await mkdir(dirname(r.file),{recursive:true});await writeFile(r.file,data);
}
await writeFile('dist/reference-catalog.json',JSON.stringify(catalog,null,2));
console.log('Self-hosted runtime and reference thumbnails ready.');
