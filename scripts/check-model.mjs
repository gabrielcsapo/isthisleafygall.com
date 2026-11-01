import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';
import { compareEmbedding, dot } from '../dist/inference.js';
env.allowRemoteModels = false; env.localModelPath = `${resolve('.cache/vision')}/`;
const processor = await AutoProcessor.from_pretrained('mobileclip', { local_files_only: true });
const vision = await CLIPVisionModelWithProjection.from_pretrained('mobileclip', { dtype: 'fp32', device: 'cpu', local_files_only: true });
const database = JSON.parse(await readFile('dist/models/references.json', 'utf8'));
for (const file of process.argv.slice(2)) {
 const image=await RawImage.read(resolve(file)); const output=await vision(await processor(image)); const embedding=output.image_embeds.normalize().tolist()[0];
 const refs=database.references.map(x=>({file:x.file,score:dot(embedding,x.embedding)})).sort((a,b)=>b.score-a.score);
 const texts=database.descriptions.map(x=>({type:x.category,text:x.text,score:dot(embedding,x.embedding)})).sort((a,b)=>b.score-a.score).slice(0,2);
 console.log(JSON.stringify({file,result:compareEmbedding(embedding,database),refs,texts}));
}
await vision.dispose();
