import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function createAdminAuth(env=process.env, fetcher=fetch, now=()=>Date.now()) {
  const origin=env.ADMIN_ORIGIN || 'https://isthisleafygall.com';
  const secure=origin.startsWith('https:'), prefix=secure?'__Host-':'';
  const sessionName=`${prefix}gall_admin`, stateName=`${prefix}gall_oauth`;
  const enabled=Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET?.length>=32 && /^\d+$/.test(env.ADMIN_GITHUB_ID || '') && (secure || (env.NODE_ENV!=='production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))));
  const key=createHmac('sha256',env.GITHUB_CLIENT_SECRET || 'disabled').update('leafygall-admin-sessions-v1').digest();
  function sign(data) {const body=Buffer.from(JSON.stringify(data)).toString('base64url');return `${body}.${createHmac('sha256',key).update(body).digest('base64url')}`;}
  function read(value) {
    try {if(!value || value.length>4000)return null;const [body,mac,...extra]=value.split('.');if(extra.length)return null;const a=Buffer.from(mac,'base64url'),b=createHmac('sha256',key).update(body).digest();if(a.length!==b.length || !timingSafeEqual(a,b))return null;const data=JSON.parse(Buffer.from(body,'base64url'));return data.expires>now()?data:null;}catch{return null;}
  }
  function cookies(req) {return Object.fromEntries((req.headers.cookie || '').split(';').map(x=>{const i=x.indexOf('=');return i<0?['','']:[x.slice(0,i).trim(),x.slice(i+1)];}));}
  function cookie(name,value,seconds) {return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure?'; Secure':''}`;}
  function session(req) {if(!enabled)return null;const data=read(cookies(req)[sessionName]);return data?.kind==='session' && data.id===env.ADMIN_GITHUB_ID?data:null;}
  function mutateAllowed(req,user) {return Boolean(user && req.headers.origin===origin && req.headers['sec-fetch-site']!=='cross-site' && req.headers['x-csrf-token']===user.csrf);}
  function redirect(res,location,values=[]) {res.writeHead(303,{Location:location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...(values.length?{'Set-Cookie':values}:{})});res.end();}
  function fail(res) {redirect(res,'/admin?signin=failed',[cookie(stateName,'',0)]);}
  return {enabled,origin,session,mutateAllowed,
    async handle(req,res,url) {
      if(!['/auth/github','/auth/github/callback','/auth/logout'].includes(url.pathname))return false;
      res.setHeader('Cache-Control','no-store');
      if(!enabled){res.writeHead(503);res.end('Admin sign-in is not configured.');return true;}
      if(url.pathname==='/auth/logout') {
        const user=session(req);if(req.method!=='POST' || !mutateAllowed(req,user)){res.writeHead(403);res.end();return true;}
        res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':cookie(sessionName,'',0)});res.end('{}');return true;
      }
      if(req.method!=='GET'){res.writeHead(405);res.end();return true;}
      if(url.pathname==='/auth/github') {
        const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
        const review=/^[a-f0-9-]{36}$/.test(url.searchParams.get('review') || '')?url.searchParams.get('review'):'';
        const target=new URL('https://github.com/login/oauth/authorize');
        target.search=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,redirect_uri:`${origin}/auth/github/callback`,scope:'',login:'gabrielcsapo',allow_signup:'false',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
        redirect(res,target.href,[cookie(stateName,sign({kind:'oauth',state,verifier,review,expires:now()+600000}),600)]);return true;
      }
      const pending=read(cookies(req)[stateName]);
      if(pending?.kind!=='oauth' || !pending.state || url.searchParams.get('state')!==pending.state || !url.searchParams.get('code')){fail(res);return true;}
      try {
        const tokenResponse=await fetcher('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code:url.searchParams.get('code'),redirect_uri:`${origin}/auth/github/callback`,code_verifier:pending.verifier}),signal:AbortSignal.timeout(15000)});
        const token=await tokenResponse.json();if(!tokenResponse.ok || !token.access_token)throw new Error();
        const profileResponse=await fetcher('https://api.github.com/user',{headers:{Authorization:`Bearer ${token.access_token}`,Accept:'application/vnd.github+json','User-Agent':'isthisleafygall-admin','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)});
        const profile=await profileResponse.json();if(!profileResponse.ok || String(profile.id)!==env.ADMIN_GITHUB_ID)throw new Error();
        // OAuth access/refresh tokens are deliberately not persisted in the session.
        const user={kind:'session',id:String(profile.id),login:String(profile.login),csrf:randomBytes(32).toString('base64url'),expires:now()+8*3600000};
        redirect(res,`/admin${pending.review?`#${pending.review}`:''}`,[cookie(stateName,'',0),cookie(sessionName,sign(user),8*3600)]);
      }catch{fail(res);}
      return true;
    }
  };
}
