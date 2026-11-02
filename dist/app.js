import { getResultCopy } from './inference.js';
const siteUrl = new URL('/', window.location.href).href;
const $ = selector => document.querySelector(selector);
let photo, worker, activeRequest = 0, busy = false, lastResult, toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3200); }
async function copyText(text, message) {
  try { await navigator.clipboard.writeText(text); toast(message); }
  catch { $('#copy-text').value = text; $('#copy-dialog').showModal(); $('#copy-text').select(); }
}
$('#share-guide').addEventListener('click', () => copyText(siteUrl, 'Guide link copied.'));
document.querySelectorAll('[data-help]').forEach(button => button.addEventListener('click', () => $('#help-dialog').showModal()));
$('#show-sources').addEventListener('click', () => $('#sources-dialog').showModal());
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const b = dialog.getBoundingClientRect(); if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) dialog.close(); } }));
const examples = {
  leafy: { title: 'Leafy gall', image: 'leafy-detail.jpg', description: 'A tightly packed cluster of small, distorted shoots, often at the crown or soil line. Simply having lots of eyes does not establish leafy gall.', source: 'Wild Horse Gardens', url: 'https://wildhorsegardens.com/dahlia-disease-biology-part-2-leafy-gall-rhodococcus-fascians/' },
  normal: { title: 'Normal growth', image: 'normal-growth.jpg', description: 'Individual shoots developing recognisable stems and leaves. Several eyes can sprout on the same healthy clump. This photo is shown by UC ANR as normal dahlia growth.', source: 'UC ANR', url: 'https://ucanr.edu/node/164427/printable/print' },
  crown: { title: 'Crown gall', image: 'crown-gall.jpg', description: 'Irregular, tumour-like tissue on the crown or roots. A solid swelling rather than a cluster of leafy shoots. Crown gall is associated with a different bacterium from leafy gall.', source: 'Dahlia Doctor', url: 'https://www.dahliadoctor.com/blogs/second-blog/dahlia-gall-disease-unmasking-crown-gall-and-leafy-gall' }
};
document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => {
  const e = examples[button.dataset.example];
  $('#example-photo').src = `assets/${e.image}`; $('#example-photo').alt = `${e.title} reference photo`;
  $('#example-title').textContent = e.title; $('#example-description').textContent = e.description;
  $('#example-source').href = e.url; $('#example-source').textContent = `Photo & further reading: ${e.source} ↗`;
  $('#example-dialog').showModal();
}));
function errorText(message) { $('#file-error').textContent = message; $('#file-error').hidden = !message; }
function showState(state) { for (const name of ['ready', 'loading', 'result', 'error']) $(`#${name}-state`).hidden = name !== state; }
function stopInspection() {
  activeRequest++; busy = false;
  if (worker) { worker.terminate(); worker = undefined; }
  $('#remove-photo').disabled = false;
}
function clearPhoto() {
  stopInspection();
  if (photo) URL.revokeObjectURL(photo.url);
  photo = undefined; lastResult = undefined;
  $('#preview-image').removeAttribute('src'); $('#photo-input').value = ''; $('#camera-input').value = '';
  $('#inspection').hidden = true; $('#drop-zone').hidden = false; errorText('');
  $('#choose-photo').focus();
}
async function selectPhoto(file) {
  if (!file || busy) return;
  errorText('');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { errorText('Please choose a JPG, PNG or WebP photo. For HEIC photos, export a JPG first.'); return; }
  if (file.size > 15 * 1024 * 1024) { errorText('That photo is over 15 MB. Choose a smaller version.'); return; }
  const request = ++activeRequest;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (request !== activeRequest) { URL.revokeObjectURL(url); return; }
    if (Math.min(image.naturalWidth, image.naturalHeight) < 64) throw new Error('That photo is too small. Choose a clear photo at least 64 pixels across.');
    if (image.naturalWidth * image.naturalHeight > 50_000_000) throw new Error('That photo is too large to process. Choose a smaller copy under 50 megapixels.');
    if (photo) URL.revokeObjectURL(photo.url);
    photo = { url, image }; lastResult = undefined;
    $('#preview-image').src = url;
    $('#drop-zone').hidden = true; $('#inspection').hidden = false; showState('ready'); $('#inspect-photo').focus();
  } catch (error) { URL.revokeObjectURL(url); if (request === activeRequest) errorText(error.message?.startsWith('That photo') ? error.message : 'This file couldn’t be opened as a photo. Try a different JPG, PNG or WebP.'); }
}
$('#choose-photo').addEventListener('click', () => $('#photo-input').click());
$('#take-photo').addEventListener('click', () => $('#camera-input').click());
for (const id of ['#photo-input', '#camera-input']) $(id).addEventListener('change', event => { selectPhoto(event.target.files[0]); event.target.value = ''; });
$('#remove-photo').addEventListener('click', clearPhoto);
$('#try-another').addEventListener('click', clearPhoto);
$('#change-photo').addEventListener('click', () => $('#photo-input').click());
$('#cancel-inspection').addEventListener('click', () => { stopInspection(); showState('ready'); $('#inspect-photo').focus(); });
const dropZone = $('#drop-zone');
let dragDepth = 0;
for (const type of ['dragenter', 'dragover']) dropZone.addEventListener(type, event => { event.preventDefault(); if (type === 'dragenter') dragDepth++; dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropZone.classList.remove('drag-over'); } });
dropZone.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; dropZone.classList.remove('drag-over'); if (event.dataTransfer.files.length !== 1) errorText('Choose one photo at a time.'); else selectPhoto(event.dataTransfer.files[0]); });
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
window.addEventListener('paste', event => { if (document.querySelector('dialog[open]') || busy) return; const file = [...(event.clipboardData?.files || [])].find(item => item.type.startsWith('image/')); if (file) selectPhoto(file); });
function renderResult(result) {
  lastResult = result;
  const copy = getResultCopy(result);
  $('#result-label').textContent = copy.label; $('#result-label').className = `result-label ${copy.tone}`;
  $('#result-title').textContent = copy.title; $('#result-description').textContent = copy.description;
  $('#result-action').textContent = copy.action;
  showState('result'); $('#result-title').focus();
}
function onWorkerMessage(event) {
  const message = event.data;
  if (message.type === 'progress') { if (busy) $('#loading-text').textContent = message.text; return; }
  if (message.id !== activeRequest) return;
  busy = false; $('#remove-photo').disabled = false;
  if (message.type === 'result') renderResult(message.result);
  if (message.type === 'error') { console.error('[Leafy gall checker]', message.diagnostic || message.message); stopInspection(); $('#inspection-error').textContent = message.message; showState('error'); }
}
async function inspect() {
  if (!photo || busy) return;
  busy = true; const id = ++activeRequest;
  $('#remove-photo').disabled = true; showState('loading'); $('#loading-text').textContent = 'Preparing your photo on this device…';
  try {
    if (!('Worker' in window) || !('WebAssembly' in window)) throw new Error('This browser doesn’t support the on-device checker. Try a recent browser, or compare the reference photos below.');
    const scale = Math.min(1, 1536 / Math.max(photo.image.naturalWidth, photo.image.naturalHeight));
    const width = Math.round(photo.image.naturalWidth * scale), height = Math.round(photo.image.naturalHeight * scale);
    if (Math.min(width, height) < 64) throw new Error('Choose a less panoramic close-up of the plant crown.');
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); context.drawImage(photo.image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data.buffer;
    if (!worker) { worker = new Worker(new URL('./vision-worker.js', import.meta.url), { type: 'module' }); worker.addEventListener('message', onWorkerMessage); worker.addEventListener('error', () => { if (!busy) return; stopInspection(); $('#inspection-error').textContent = 'The on-device checker couldn’t load. Check your connection and try again. Your photo has not been uploaded.'; showState('error'); }); }
    worker.postMessage({ type: 'inspect', id, pixels, width, height }, [pixels]);
  } catch (error) { busy = false; $('#remove-photo').disabled = false; $('#inspection-error').textContent = error.message; showState('error'); }
}
$('#inspect-photo').addEventListener('click', inspect);
$('#retry-inspection').addEventListener('click', inspect);
$('#copy-result').addEventListener('click', () => { if (!lastResult) return; const copy = getResultCopy(lastResult); copyText(`${copy.title} ${copy.description} ${copy.action}\n\nExperimental visual comparison, not a confirmed diagnosis. ${siteUrl}`, 'Result copied.'); });
window.addEventListener('pagehide', clearPhoto);
