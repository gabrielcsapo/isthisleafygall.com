import { createServer } from 'node:http';
import { createReviewHandler } from './server/review-http.mjs';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./dist/', import.meta.url)).replace(/\/$/, '');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.jpg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.svg':'image/svg+xml', '.ttf':'font/ttf', '.wasm':'application/wasm', '.bin':'application/octet-stream' };
const reviews = createReviewHandler();
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400);res.end('Bad request');return; }
  if (await reviews.handle(req,res,pathname)) return;
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, { Allow:'GET, HEAD' }); res.end('Method not allowed'); return; }
  if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type':'text/plain', 'Cache-Control':'no-store' });res.end(req.method === 'HEAD' ? undefined : 'ok');return; }
  if (pathname === '/analytics-config.json') {
    const projectToken = process.env.POSTHOG_PROJECT_TOKEN || '';
    const apiHost = process.env.POSTHOG_API_HOST || '';
    const enabled = /^phc_[a-zA-Z0-9_]+$/.test(projectToken) && ['https://us.i.posthog.com', 'https://eu.i.posthog.com'].includes(apiHost);
    res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(enabled ? {enabled,projectToken,apiHost} : {enabled:false})); return;
  }
  const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root + sep) || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) { res.writeHead(404);res.end('Not found');return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not-file');
    const extension = extname(file);
    const tag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    res.setHeader('Content-Type', mime[extension] || 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', /-[a-f0-9]{12}-\d+\.bin$/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.setHeader('ETag', tag);
    if (req.headers['if-none-match'] === tag) { res.writeHead(304);res.end();return; }
    res.setHeader('Content-Length', info.size);
    if (req.method === 'HEAD') { res.writeHead(200);res.end();return; }
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch { res.writeHead(404, { 'Content-Type':'text/plain' });res.end('Not found'); }
});
server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log(`Leafy gall guide listening on port ${server.address().port}`));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => { reviews.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
