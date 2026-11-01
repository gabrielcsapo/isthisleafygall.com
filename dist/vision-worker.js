import { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from './vendor/transformers.min.js';
import { compareEmbedding } from './inference.js';
import { configureLocalModel, loadBinary } from './local-model.js';
// Only static model files are fetched. Photo pixels stay in this worker's memory.
const baseURL = new URL('./', import.meta.url);
let engine;
let phase = 'loading the checker';
async function loadEngine() {
  if (engine) return engine;
  engine = (async () => {
    self.postMessage({ type: 'progress', text: 'Loading the on-device checker… First use downloads about 75 MB.' });
    const manifest = await fetch(new URL('models/binaries.json', baseURL));
    if (!manifest.ok) throw new Error('The on-device checker could not be loaded.');
    const binaries = await manifest.json();
    configureLocalModel(env, binaries, baseURL, (_, value) => self.postMessage({ type: 'progress', text: `Loading the image model… ${Math.round(value * 100)}%` }));
    phase = 'loading the runtime';
    env.backends.onnx.wasm.wasmBinary = await loadBinary(binaries.wasm, baseURL, value => self.postMessage({ type: 'progress', text: `Loading the local runtime… ${Math.round(value * 100)}%` }));
    phase = 'loading the model';
    const [processor, model, response] = await Promise.all([
      AutoProcessor.from_pretrained('mobileclip', { local_files_only: true }),
      CLIPVisionModelWithProjection.from_pretrained('mobileclip', { dtype: 'fp32', device: 'wasm', local_files_only: true }),
      fetch(new URL('models/references.json', baseURL)),
    ]);
    if (!response.ok) throw new Error('The reference images could not be loaded.');
    return { processor, model, database: await response.json() };
  })();
  try { return await engine; } catch (error) { engine = undefined; throw error; }
}
self.addEventListener('message', async event => {
  if (event.data.type !== 'inspect') return;
  const { pixels, width, height, id } = event.data;
  try {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > 1536 || height > 1536 || pixels.byteLength !== width * height * 4) throw new Error('Choose a clear photo at least 64 pixels across.');
    const { processor, model, database } = await loadEngine();
    self.postMessage({ type: 'progress', text: 'Comparing your photo on this device…' });
    phase = 'preparing the photo';
    const image = new RawImage(new Uint8ClampedArray(pixels), width, height, 4);
    const inputs = await processor(image);
    phase = 'inspecting the photo';
    const output = await model(inputs);
    const result = compareEmbedding(output.image_embeds.normalize().tolist()[0], database);
    self.postMessage({ type: 'result', id, result });
  } catch (error) {
    const message = error.message?.includes('64 pixels') ? error.message
      : phase.startsWith('loading') ? 'The on-device checker couldn’t finish loading. Try again, or use the reference photos below.'
      : 'The checker couldn’t inspect this photo on your device. Try a different photo, or use the reference photos below.';
    self.postMessage({ type: 'error', id, message, diagnostic: `${phase}: ${error.name || 'Error'}: ${error.message || 'Unknown error'}` });
  }
});
