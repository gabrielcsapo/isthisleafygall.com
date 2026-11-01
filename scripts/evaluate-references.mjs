import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { compareEmbedding } from '../dist/inference.js';
const database = JSON.parse(await readFile('dist/models/references.json','utf8'));
const results = database.references.map(reference => {
  const heldOut = { ...database, references: database.references.filter(other => other.group_id !== reference.group_id) };
  const result = compareEmbedding(reference.embedding, heldOut);
  return { id:reference.id, group:reference.group_id, expected:reference.category, result:result.category, outcome:result.category === reference.category ? 'match' : result.category === 'unclear' ? 'abstain' : 'wrong-category' };
});
const summary={method:'Leave related-view group out; published labels, not lab ground truth. This small convenience sample is not a disease accuracy benchmark.',referenceCount:results.length,groups:new Set(results.map(x=>x.group)).size,match:results.filter(x=>x.outcome==='match').length,abstain:results.filter(x=>x.outcome==='abstain').length,wrongCategory:results.filter(x=>x.outcome==='wrong-category').length};
await mkdir('.cache/evaluation',{recursive:true});
await writeFile('.cache/evaluation/group-holdout.json',JSON.stringify({summary,results},null,2));
console.log(JSON.stringify(summary,null,2));
console.log(JSON.stringify(results.filter(x=>x.outcome==='wrong-category'),null,2));
