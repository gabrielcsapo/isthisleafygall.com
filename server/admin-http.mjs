import { readFile } from 'node:fs/promises';
import { createAdminAuth } from './admin-auth.mjs';
import { createAdminService } from './admin-service.mjs';
import { reviewStorageConfig,createReviewStorage } from './review-storage.mjs';
import { ReviewError } from './reviews.mjs';

export function createReplySender(env,fetcher=fetch) {
  if(!env.RESEND_API_KEY || !env.REVIEW_REPLY_FROM_EMAIL || !env.REVIEW_NOTIFY_TO || /@resend\.dev[>\s]*$/.test(env.REVIEW_REPLY_FROM_EMAIL))return null;
  return async(item,reply)=>{
    const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`review-reply-${reply.id}`},body:JSON.stringify({from:env.REVIEW_REPLY_FROM_EMAIL,to:[item.email],reply_to:env.REVIEW_NOTIFY_TO,subject:'Your dahlia photo review',text:`${reply.body}\n\nReview reference: ${item.id}\nIs this leafy gall?\nhttps://isthisleafygall.com\n\nThis is a visual assessment, not laboratory confirmation. No photo or email is posted publicly.`}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Reply delivery pending.');
  };
}
export async function readAdminJson(req) {
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))throw new ReviewError(415,'Use the review dashboard to save changes.');
  let size=0;const chunks=[];req.setTimeout(20000,()=>req.destroy());
  for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>64000)throw new ReviewError(413,'This change is too large.');chunks.push(chunk);}
  try {const result=JSON.parse(Buffer.concat(chunks));if(!result || typeof result!=='object' || Array.isArray(result))throw new Error();return result;}catch{throw new ReviewError(400,'The change could not be read. Refresh and try again.');}
}
export function createAdminHandler(env=process.env,dependencies={}) {
  const auth=dependencies.auth || createAdminAuth(env,dependencies.fetcher);
  const config=reviewStorageConfig(env);
  const base=dependencies.base || readFile(new URL('../dist/models/references.json',import.meta.url),'utf8').then(JSON.parse);
  const sendReply=createReplySender(env,dependencies.fetcher);
  const service=dependencies.service || (config?Promise.resolve(base).then(base=>createAdminService({storage:createReviewStorage(config),base,sendReply})):null);
  const ready=Boolean(service && auth.enabled),replyReady=Boolean(sendReply);
  function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Vary':'Cookie'});res.end(JSON.stringify(value));}
  const retry=async()=>{try{const admin=await service;await admin?.retryDeletes?.();await admin?.retryReplies();}catch{console.error('[Photo review] Maintenance queue will retry.');}};
  const timer=service?setInterval(retry,60000):null;timer?.unref();if(service)void retry();
  return {close:()=>clearInterval(timer),
    async handle(req,res,url){
      try {
        if(await auth.handle(req,res,url))return true;
        if(url.pathname==='/reference-index.json' && ['GET','HEAD'].includes(req.method)) {
          let data;try{data=service?await(await service).publicDatabase():await base;}catch{data=await base;}
          res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:JSON.stringify(data));return true;
        }
        if(!url.pathname.startsWith('/api/admin/'))return false;
        const user=auth.session(req);
        if(url.pathname==='/api/admin/session' && req.method==='GET'){json(res,200,{enabled:ready,authenticated:Boolean(user),...(user?{login:user.login,csrf:user.csrf,replyReady}:{})});return true;}
        if(!ready){json(res,503,{error:'Admin sign-in is not configured yet.'});return true;}
        if(!user){json(res,401,{error:'Sign in with your owner GitHub account.'});return true;}
        if(req.method!=='GET' && !auth.mutateAllowed(req,user)){json(res,403,{error:'Refresh the dashboard before saving changes.'});return true;}
        const admin=await service;
        if(url.pathname==='/api/admin/reviews' && req.method==='GET'){json(res,200,await admin.list());return true;}
        const match=url.pathname.match(/^\/api\/admin\/reviews\/([a-f0-9-]+)(?:\/(photo|approve|exclude|reply|delete))?$/);
        if(match && match[2]==='photo' && req.method==='GET') {const image=await admin.photo(match[1]);res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Vary':'Cookie'});res.end(image);return true;}
        if(match && req.method==='POST') {const input=await readAdminJson(req);const fn={approve:'approve',exclude:'exclude',reply:'reply',delete:'erase'}[match[2]] || (!match[2]?'save':null);if(!fn)throw new ReviewError(404,'Not found.');json(res,200,(await admin[fn](match[1],input,user.login)) || {ok:true});return true;}
        if(req.method==='POST' && ['/api/admin/references/prepare','/api/admin/references/publish','/api/admin/references/rollback'].includes(url.pathname)) {const input=await readAdminJson(req),action=url.pathname.split('/').at(-1);const result=action==='prepare'?await admin.prepare(user.login):await admin[action](input.version,user.login);json(res,200,result);return true;}
        json(res,404,{error:'Not found.'});return true;
      }catch(error){req.resume();if(!error.status)console.error('[Photo review] Admin operation temporarily unavailable.');json(res,error.status || 503,{error:error.status?error.message:'The operation could not finish. Refresh and try again.'});return true;}
    }
  };
}
