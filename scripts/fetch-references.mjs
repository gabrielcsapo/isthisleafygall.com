import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
const catalog = JSON.parse(await readFile('data/references.json', 'utf8'));
function digest(data) { return createHash('sha256').update(data).digest('hex'); }
for (const reference of catalog.references) {
  if (existsSync(reference.file) && digest(await readFile(reference.file)) === reference.sha256) continue;
  const url = reference.image_url.startsWith('//') ? `https:${reference.image_url}` : reference.image_url;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Reference ${reference.id}: download failed (${response.status}). Review its source before replacing it.`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (digest(data) !== reference.sha256) throw new Error(`Reference ${reference.id}: source bytes changed. Review and update the catalog explicitly.`);
  await mkdir(dirname(reference.file), { recursive: true });
  await writeFile(reference.file, data);
  console.log(`Fetched ${reference.id}`);
}
console.log(`Reference files ready: ${catalog.references.length}. Photo copyrights remain with their respective owners.`);
