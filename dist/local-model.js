export async function loadBinary(entry, baseURL, onProgress = () => {}) {
  if (!Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > 100_000_000 || !Array.isArray(entry.parts) || !entry.parts.length) throw new Error('Invalid model manifest.');
  const output = new Uint8Array(entry.size);
  let offset = 0;
  for (const part of entry.parts) {
    const url = new URL(part, baseURL);
    if (url.origin !== new URL(baseURL).origin) throw new Error('Model files must stay on this site.');
    const response = await fetch(url);
    if (!response.ok) throw new Error('An on-device model file could not be downloaded.');
    const data = new Uint8Array(await response.arrayBuffer());
    if (offset + data.length > output.length) throw new Error('Invalid model file size.');
    output.set(data, offset); offset += data.length;
    onProgress(offset / entry.size);
  }
  if (offset !== entry.size) throw new Error('Incomplete model download.');
  return output;
}
export function configureLocalModel(env, binaries, baseURL, onProgress = () => {}) {
  // Transformers.js disables local models by default in browsers and workers.
  // Enable this site's model while continuing to forbid remote model services.
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.useWasmCache = false;
  env.localModelPath = new URL('models/', baseURL).href;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.wasmPaths = { mjs: new URL('vendor/ort-wasm-simd-threaded.jsep.mjs', baseURL).href };
  env.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, baseURL);
    if (url.origin !== new URL(baseURL).origin) throw new Error('Remote model requests are disabled.');
    if (url.pathname.endsWith('/models/mobileclip/onnx/vision_model.onnx')) {
      if (options?.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': String(binaries.vision.size) } });
      const data = await loadBinary(binaries.vision, baseURL, value => onProgress('model', value));
      return new Response(data, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(data.length) } });
    }
    return fetch(input, options);
  };
}
