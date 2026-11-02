import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { compareEmbedding, dot, resultCopy, getResultCopy } from '../dist/inference.js';
import { configureLocalModel } from '../dist/local-model.js';
const db = JSON.parse(await readFile(new URL('../dist/models/references.json', import.meta.url)));
test('browser worker defaults are changed to permit only this site’s local model', () => {
  const env = { allowLocalModels: false, allowRemoteModels: true, backends: { onnx: { wasm: {} } } };
  configureLocalModel(env, {}, 'https://example.com/');
  assert.equal(env.allowLocalModels, true);
  assert.equal(env.allowRemoteModels, false);
  assert.equal(env.localModelPath, 'https://example.com/models/');
});
test('reference vectors are finite and unit length', () => {
  for (const item of [...db.references, ...db.descriptions]) {
    assert.equal(item.embedding.length, 512);
    assert.ok(item.embedding.every(Number.isFinite));
    assert.ok(Math.abs(dot(item.embedding, item.embedding) - 1) < .0001);
  }
});
test('known reference vectors retrieve their category', () => {
  for (const item of db.references) assert.equal(compareEmbedding(item.embedding, db).category, item.category);
});
test('an unrelated vector abstains', () => {
  assert.equal(compareEmbedding(db.descriptions.find(item => item.category === 'other').embedding, db).category, 'unclear');
});
test('close category scores abstain rather than inventing certainty', () => {
  const vector = db.references.find(item => item.category === 'normal').embedding;
  const ambiguous = { ...db, references: ['normal', 'leafy', 'crown'].map(category => ({ category, embedding: vector })) };
  const result = compareEmbedding(vector, ambiguous);
  assert.equal(result.category, 'unclear');
  assert.equal(result.reason, 'mixed-matches');
  assert.equal(result.candidates.length, 2);
  const copy = getResultCopy(result);
  assert.match(copy.title, /mixed/);
  for (const category of result.candidates) assert.match(copy.description, new RegExp(category === 'normal' ? 'normal growth' : `${category} gall`));
  assert.doesNotMatch(copy.action, /sharp|well-lit/);
});
test('invalid image features fail explicitly', () => {
  assert.throws(() => compareEmbedding([NaN], db), /Invalid image features/);
  assert.throws(() => dot([1], [1, 2]), /Incompatible/);
});
test('all result categories explain their limitations and next action', () => {
  for (const category of ['leafy','normal','crown','unclear']) {
    const copy = resultCopy[category]; assert.ok(copy.title && copy.description && copy.action);
  }
  assert.match(resultCopy.normal.action, /cannot rule out/);
});
test('automatic inspection stays local; optional review uploads are separate', async () => {
  const worker = await readFile(new URL('../dist/vision-worker.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const local = await readFile(new URL('../dist/local-model.js', import.meta.url), 'utf8');
  assert.match(local, /env\.allowRemoteModels = false/);
  assert.match(local, /Remote model requests are disabled/);
  assert.match(worker, /device: 'wasm'/);
  assert.doesNotMatch(worker, /https?:\/\//);
  assert.doesNotMatch(app, /fetch\(|XMLHttpRequest|sendBeacon|FormData/);
  assert.match(html, /connect-src 'self'/);
});
test('model shards fit static hosting limits and reconstruct exact binary sizes', { skip: !existsSync(new URL('../dist/models/binaries.json', import.meta.url)) }, async () => {
  const { stat } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(new URL('../dist/models/binaries.json', import.meta.url)));
  for (const entry of Object.values(manifest)) {
    let total = 0;
    for (const file of entry.parts) {
      const size = (await stat(new URL(`../dist/${file}`, import.meta.url))).size;
      assert.ok(size <= 25 * 1024 * 1024); total += size;
    }
    assert.equal(total, entry.size);
  }
});

test('reference catalog keeps evidence and related views distinct', async () => {
  const catalog = JSON.parse(await readFile(new URL('../data/references.json', import.meta.url)));
  assert.equal(catalog.references.length, db.references.length);
  assert.equal(new Set(catalog.references.map(x => x.id)).size, catalog.references.length);
  for (const r of catalog.references) {
    assert.ok(r.source_url && r.publisher && r.group_id && r.label_status && r.sha256);
    if (r.label_status === 'lab_confirmed') assert.ok(r.confirmation_url);
    assert.ok(!r.file.includes('Downloads'));
  }
});
test('related views cannot create false independent support', () => {
  const axis = Array(512).fill(0); axis[0] = 1;
  const opposite = axis.map(x => -x);
  const query = [...axis]; query[0] = .9; query[1] = Math.sqrt(1 - .9 ** 2);
  const database = {
    references: [
      {category:'leafy', group_id:'same-plant', embedding:axis},
      {category:'leafy', group_id:'same-plant', embedding:axis},
      {category:'normal', group_id:'normal', embedding:opposite},
      {category:'crown', group_id:'crown', embedding:opposite},
    ],
    descriptions: [{category:'plant',embedding:axis},{category:'other',embedding:opposite}],
  };
  assert.deepEqual(compareEmbedding(query, database), {category:'unclear',reason:'limited-support'});
  database.references[1].group_id = 'another-plant';
  assert.equal(compareEmbedding(query, database).category, 'leafy');
});
