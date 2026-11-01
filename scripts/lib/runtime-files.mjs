import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
export const revision='757d59c9c6870a76a4b0306f05f5061bca15c39f';
export const modelDir=resolve('.cache/vision/mobileclip');
export async function downloadModelFile(name,destination){
 if(existsSync(destination))return;
 const response=await fetch(`https://huggingface.co/Xenova/mobileclip_s0/resolve/${revision}/${name}`,{signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw new Error(`Download failed: ${name} (${response.status})`);
 await writeFile(destination,new Uint8Array(await response.arrayBuffer()));
}
export async function prepareRuntime(){
 await mkdir(`${modelDir}/onnx`,{recursive:true});await mkdir('dist/models/mobileclip/onnx',{recursive:true});await mkdir('dist/vendor',{recursive:true});
 await Promise.all(['config.json','preprocessor_config.json','LICENSE','onnx/vision_model.onnx'].map(name=>downloadModelFile(name,`${modelDir}/${name}`)));
 for(const file of ['config.json','preprocessor_config.json','LICENSE'])await copyFile(`${modelDir}/${file}`,`dist/models/mobileclip/${file}`);
 await copyFile('node_modules/@huggingface/transformers/dist/transformers.min.js','dist/vendor/transformers.min.js');
 await copyFile('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs','dist/vendor/ort-wasm-simd-threaded.jsep.mjs');
 await copyFile('node_modules/@huggingface/transformers/LICENSE','dist/vendor/TRANSFORMERS-LICENSE');
 const license=await fetch('https://raw.githubusercontent.com/microsoft/onnxruntime/v1.30.0/LICENSE');
 if(!license.ok)throw new Error('ONNX license download failed');await writeFile('dist/vendor/ONNX-LICENSE',await license.text());
 async function shard(source,prefix){
  const data=await readFile(source),parts=[],hash=createHash('sha256').update(data).digest('hex').slice(0,12);
  for(let offset=0,index=0;offset<data.length;offset+=20*1024*1024,index++){
   const file=`${prefix}-${hash}-${index}.bin`;await writeFile(`dist/${file}`,data.subarray(offset,offset+20*1024*1024));parts.push(file);
  }
  return{size:data.length,parts};
 }
 await writeFile('dist/models/binaries.json',JSON.stringify({vision:await shard(`${modelDir}/onnx/vision_model.onnx`,'models/mobileclip/onnx/vision'),wasm:await shard('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm','vendor/runtime')}));
}
