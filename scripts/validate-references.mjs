import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const catalog=JSON.parse(await readFile('data/references.json','utf8'));
const ids=new Set(),hashes=new Set();
for(const r of catalog.references){
 assert.match(r.id,/^[a-z0-9-]+$/);assert.ok(!ids.has(r.id),`Duplicate ID: ${r.id}`);ids.add(r.id);
 assert.ok(['leafy','normal','crown'].includes(r.category));
 assert.ok(['published_example','expert_reviewed','lab_confirmed'].includes(r.label_status));
 assert.equal(r.review_status,'source_checked');
 for(const field of ['publisher','description','rights','group_id','source_url','image_url','sha256'])assert.ok(r[field],`${r.id} missing ${field}`);
 assert.match(r.sha256,/^[a-f0-9]{64}$/);assert.ok(!hashes.has(r.sha256),`Duplicate image bytes: ${r.id}`);hashes.add(r.sha256);
 assert.equal(new URL(r.source_url).protocol,'https:');
 if(r.label_status==='lab_confirmed')assert.ok(r.confirmation_url,`${r.id} needs confirmation evidence`);
 assert.ok(!r.file.includes('..')&&!r.file.startsWith('/')&&!r.file.includes('Downloads'));
}
console.log(`Validated ${ids.size} source-labelled references. No unreviewed community submissions included.`);
