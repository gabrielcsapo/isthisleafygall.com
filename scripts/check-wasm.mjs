import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { env as nativeEnv, AutoProcessor, RawImage } from '@huggingface/transformers';
import { compareEmbedding } from '../dist/inference.js';
import { configureLocalModel, loadBinary } from '../dist/local-model.js';
// Exercise the shipped browser WASM engine without controlling a browser UI.
const nativeProcess=globalThis.process;
globalThis.process=undefined;
const web = await import('../dist/vendor/transformers.min.js');
globalThis.process=nativeProcess;
const origin=process.env.MODEL_ORIGIN || 'http://127.0.0.1:4173';
const binaries=JSON.parse(await readFile('dist/models/binaries.json'));
// Match the real browser-worker default, rather than Node's permissive default.
web.env.allowLocalModels=false;
configureLocalModel(web.env,binaries,`${origin}/`);
web.env.useBrowserCache=false; web.env.useFSCache=false; web.env.useWasmCache=false;
web.env.backends.onnx.wasm.numThreads=1;
web.env.backends.onnx.wasm.wasmPaths={mjs:pathToFileURL(resolve('dist/vendor/ort-wasm-simd-threaded.jsep.mjs')).href};
web.env.backends.onnx.wasm.wasmBinary=await loadBinary(binaries.wasm,`${origin}/`);
nativeEnv.allowRemoteModels=false;nativeEnv.localModelPath=`${resolve('.cache/vision')}/`;
const processor=await AutoProcessor.from_pretrained('mobileclip',{local_files_only:true});
const model=await web.CLIPVisionModelWithProjection.from_pretrained('mobileclip',{dtype:'fp32',device:'wasm',local_files_only:true});
const database=JSON.parse(await readFile('dist/models/references.json','utf8'));
for(const file of ['leafy-gall.jpg','normal-growth.jpg','crown-gall.jpg']){
 const inputs=await processor(await RawImage.read(resolve(`dist/assets/${file}`)));
 const tensor=new web.Tensor('float32',inputs.pixel_values.data,inputs.pixel_values.dims);
 const output=await model({pixel_values:tensor});
 console.log(file,compareEmbedding(output.image_embeds.normalize().tolist()[0],database));
}
await model.dispose();
