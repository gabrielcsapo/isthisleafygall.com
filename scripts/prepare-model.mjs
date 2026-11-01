import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { env, AutoTokenizer, CLIPTextModelWithProjection, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';
import { prepareRuntime, revision, modelDir, downloadModelFile } from './lib/runtime-files.mjs';
await prepareRuntime();
const cacheDir = resolve('.cache/mobileclip');
await mkdir(`${cacheDir}/onnx`, { recursive: true });
await Promise.all(['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/text_model_quantized.onnx'].map(name => downloadModelFile(name, `${cacheDir}/${name}`)));
env.allowRemoteModels = false;
env.localModelPath = `${resolve('.cache/vision')}/`;
const processor = await AutoProcessor.from_pretrained('mobileclip', { local_files_only: true });
const vision = await CLIPVisionModelWithProjection.from_pretrained('mobileclip', { dtype: 'fp32', device: 'cpu', local_files_only: true });
const catalog = JSON.parse(await readFile('data/references.json', 'utf8'));
const references = catalog.references.map(reference => ({ ...reference }));
for (const reference of references) {
  const image = await RawImage.read(resolve(reference.file));
  const output = await vision(await processor(image));
  reference.embedding = output.image_embeds.normalize().tolist()[0];
}
// The text model is used only during preparation, never shipped to visitors.
env.localModelPath = `${resolve('.cache')}/`;
const tokenizer = await AutoTokenizer.from_pretrained('mobileclip', { local_files_only: true });
const text = await CLIPTextModelWithProjection.from_pretrained('mobileclip', { dtype: 'q8', device: 'cpu', local_files_only: true });
const descriptions = [
  { category: 'plant', text: 'A close-up photograph of dahlia tubers, roots and sprouts.' },
  { category: 'plant', text: 'A close-up photograph of a plant crown with roots and new shoots.' },
  { category: 'other', text: 'A photograph of a person or a human face.' },
  { category: 'other', text: 'A photograph of an animal or a pet.' },
  { category: 'other', text: 'A screenshot of a website, text or a document.' },
  { category: 'other', text: 'A photograph of an object, a room, a car or a building.' },
  { category: 'other', text: 'A photograph of flowers, a tree, grass or a garden landscape.' },
  { category: 'other', text: 'A photograph of food on a plate.' },
];
const output = await text(tokenizer(descriptions.map(x => x.text), { padding: 'max_length', truncation: true }));
const vectors = output.text_embeds.normalize().tolist();
descriptions.forEach((item, i) => { item.embedding = vectors[i]; });
await writeFile('dist/models/references.json', JSON.stringify({ model: 'Xenova/mobileclip_s0', revision, catalogVersion: catalog.version, labelPolicy: catalog.label_policy, references, descriptions }));
await writeFile('dist/reference-catalog.json', JSON.stringify(catalog, null, 2));
await vision.dispose(); await text.dispose();
console.log('On-device reference vectors ready.');
