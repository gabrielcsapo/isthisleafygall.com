import { createHmac, randomBytes } from 'node:crypto';
import { MAX_REQUEST_BYTES, ReviewError, validEmail, createReviewService, makeResendNotifier } from './reviews.mjs';
import { reviewStorageConfig, createReviewStorage } from './review-storage.mjs';
export function safeSupportUrl(value) {
  try { const url=new URL(value);if(url.protocol==='https:' && ['ko-fi.com','www.ko-fi.com'].includes(url.hostname) && url.pathname!=='/' && !url.username && !url.password && !url.search && !url.hash)return url.href; } catch {}
  return null;
}
export function createReviewHandler(env=process.env, serviceOverride) {
  const storageConfig=reviewStorageConfig(env);
  const enabled=Boolean(serviceOverride || (storageConfig && env.RESEND_API_KEY && env.REVIEW_FROM_EMAIL && validEmail(env.REVIEW_NOTIFY_TO)));
  const service=serviceOverride || (enabled ? createReviewService({storage:createReviewStorage(storageConfig),sendNotification:makeResendNotifier({apiKey:env.RESEND_API_KEY,from:env.REVIEW_FROM_EMAIL,to:env.REVIEW_NOTIFY_TO})}) : null);
  const rate=new Map(), salt=randomBytes(32);let active=0;
  function reply(res,status,data) { res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data)); }
  function allowedOrigin(origin) {
    return ['https://isthisleafygall.com','https://www.isthisleafygall.com',env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : ''].includes(origin) || (env.NODE_ENV!=='production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || ''));
  }
  const retry=async()=>{try {await service?.retryPending();}catch{console.error('[Photo review] Pending queue is temporarily unavailable.');}};
  const timer=service ? setInterval(retry,60000) : null; timer?.unref();
  if(service)void retry();
  return {
    close:()=>clearInterval(timer),
    async handle(req,res,pathname) {
      if(pathname==='/submission-config.json' && ['GET','HEAD'].includes(req.method)) { reply(res,200,{enabled,supportUrl:safeSupportUrl(env.SUPPORT_URL)});return true; }
      if(pathname!=='/api/reviews')return false;
      if(req.method!=='POST') {reply(res,405,{error:'Use the photo-review form to submit a photo.'});return true;}
      if(!service) {reply(res,503,{error:'Photo review is temporarily unavailable. Please try again later.'});return true;}
      if(!allowedOrigin(req.headers.origin) || req.headers['sec-fetch-site']==='cross-site') {reply(res,403,{error:'Submit your photo from this website.'});return true;}
      if(!/^multipart\/form-data;/i.test(req.headers['content-type'] || '')) {reply(res,415,{error:'Choose a photo using the review form.'});return true;}
      const ip=String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').at(-1).trim();
      const key=createHmac('sha256',salt).update(ip).digest('hex'), now=Date.now();
      for(const [id,value] of rate)if(value.expires<now)rate.delete(id);
      const counter=rate.get(key) || {count:0,expires:now+3600000};
      if(counter.count>=5 || rate.size>=10000) {reply(res,429,{error:'Too many submissions. Please try again in an hour.'});return true;}
      if(active>=2) {reply(res,503,{error:'Photo review is busy. Please try again in a moment.'});return true;}
      counter.count++;rate.set(key,counter);active++;
      try {
        if(Number(req.headers['content-length'])>MAX_REQUEST_BYTES)throw new ReviewError(413,'Choose a smaller photo.');
        const chunks=[];let size=0;
        req.setTimeout(20000,()=>req.destroy());
        for await(const chunk of req.iterator({destroyOnReturn:false})) {size+=chunk.length;if(size>MAX_REQUEST_BYTES)throw new ReviewError(413,'Choose a smaller photo.');chunks.push(chunk);}
        const request=new Request('http://localhost/api/reviews',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:Buffer.concat(chunks)});
        let form;
        try {form=await request.formData();}catch{throw new ReviewError(400,'The photo could not be submitted. Reopen the form and try again.');}
        const allowed=new Set(['photo','requestId','email','notes','modelCategory','reviewPermission','trainingPermission','website']);
        for(const field of form.keys())if(!allowed.has(field) || form.getAll(field).length!==1)throw new ReviewError(400,'The submission could not be accepted.');
        const photo=form.get('photo');
        if(!photo || typeof photo.arrayBuffer!=='function' || photo.size>MAX_REQUEST_BYTES || !photo.size)throw new ReviewError(400,'Choose a JPG, PNG or WebP photo.');
        const fields=Object.fromEntries([...form.entries()].filter(([name])=>name!=='photo'));
        for(const value of Object.values(fields))if(typeof value!=='string' || value.length>1200)throw new ReviewError(400,'The submission could not be accepted.');
        const result=await service.submit(fields,Buffer.from(await photo.arrayBuffer()));
        reply(res,201,result);
      } catch(error) {req.resume();if(!error.status)console.error('[Photo review] Submission storage is temporarily unavailable.');reply(res,error.status || 503,{error:error.status ? error.message : 'Your photo was not submitted. Please try again later.'});}
      finally {active--;}
      return true;
    }
  };
}
