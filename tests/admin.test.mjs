import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID,createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createAdminAuth } from '../server/admin-auth.mjs';
import { createAdminService,evaluateReferences } from '../server/admin-service.mjs';
import { createAdminHandler,createReplySender } from '../server/admin-http.mjs';
import { CONSENT_VERSION,REVIEW_PERMISSION } from '../server/reviews.mjs';
const base=JSON.parse(await readFile(new URL('../dist/models/references.json',import.meta.url)));
function memoryStorage(){const files=new Map(),versions=new Map();return {files,async getJson(key){return files.has(key)?structuredClone(files.get(key)):null;},async putJson(key,value){files.set(key,structuredClone(value));versions.set(key,(versions.get(key)||0)+1);},async getJsonVersion(key){return {value:await this.getJson(key),etag:versions.has(key)?String(versions.get(key)):null};},async putJsonVersion(key,value,etag){if((versions.has(key)?String(versions.get(key)):null)!==etag){const error=new Error('conflict');error.status=409;throw error;}await this.putJson(key,value);},async list(prefix){return [...files.keys()].filter(x=>x.startsWith(prefix));},async getBytes(){return Buffer.from('private-image');}};}
async function setup(options={}){const storage=memoryStorage(),id=randomUUID();await storage.putJson(`submissions/${id}.json`,{id,createdAt:new Date().toISOString(),email:'private@example.com',notes:'Private visitor notes',modelCategory:'leafy',photo:{key:`photos/${id}.jpg`,sha256:randomUUID()},consent:{version:CONSENT_VERSION,trainingAllowed:options.allowed!==false,reviewPermission:REVIEW_PERMISSION},review:{category:'unreviewed'}});const service=createAdminService({storage,base,...options});return {service,storage,id};}
async function save(service,id,category='leafy',group='private-plant-name'){const {revision}=await service.list();return service.save(id,{revision,category,group,notes:'Private review notes'},'owner');}
async function approve(service,id,role='reference'){const {revision,items}=await service.list();return service.approve(id,{revision,role,photoSha256:items.find(x=>x.id===id).photoSha256,modelRevision:base.revision,embedding:base.references.find(x=>x.category==='leafy').embedding},'owner');}
function response(){return {headers:{},writeHead(status,headers={}){this.status=status;Object.assign(this.headers,headers);},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}};}
test('GitHub sign-in uses PKCE, bound state and an expiring owner-only session',async()=>{
  const env={GITHUB_CLIENT_ID:'public-client',GITHUB_CLIENT_SECRET:'s'.repeat(40),ADMIN_GITHUB_ID:'1854811'},calls=[];let profileId=1854811,time=0;
  const auth=createAdminAuth(env,async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.includes('access_token')?{access_token:'not-persisted',refresh_token:'also-not-persisted'}:{id:profileId,login:'gabrielcsapo'}));},()=>time);
  const start=response();await auth.handle({method:'GET',headers:{}},start,new URL('https://isthisleafygall.com/auth/github?review='+randomUUID()));
  const location=new URL(start.headers.Location),pending=start.headers['Set-Cookie'][0].split(';')[0];assert.equal(location.searchParams.get('scope'),'');assert.equal(location.searchParams.get('code_challenge_method'),'S256');assert.match(pending,/HttpOnly|__Host-/);
  const bad=response();await auth.handle({method:'GET',headers:{cookie:pending}},bad,new URL('https://isthisleafygall.com/auth/github/callback?code=x&state=wrong'));assert.match(bad.headers.Location,/failed/);assert.equal(calls.length,0);
  const callback=new URL('https://isthisleafygall.com/auth/github/callback');callback.search=new URLSearchParams({state:location.searchParams.get('state'),code:'one-time-code'}).toString();
  const ok=response();await auth.handle({method:'GET',headers:{cookie:pending}},ok,callback);const sessionCookie=ok.headers['Set-Cookie'][1];assert.match(sessionCookie,/Secure/);assert.match(sessionCookie,/HttpOnly/);assert.match(sessionCookie,/SameSite=Lax/);assert.doesNotMatch(Buffer.from(sessionCookie.split('=')[1].split('.')[0],'base64url').toString(),/not-persisted/);
  const req={headers:{cookie:sessionCookie.split(';')[0]}};const user=auth.session(req);assert.equal(user.login,'gabrielcsapo');assert.equal(auth.mutateAllowed({...req,headers:{...req.headers,origin:'https://evil.test','x-csrf-token':user.csrf}},user),false);assert.equal(auth.mutateAllowed({headers:{origin:'https://isthisleafygall.com','x-csrf-token':user.csrf}},user),true);
  const tampered={headers:{cookie:req.headers.cookie+'x'}};assert.equal(auth.session(tampered),null);time=9*3600000;assert.equal(auth.session(req),null);
  time=0;profileId=999;const stranger=response();await auth.handle({method:'GET',headers:{cookie:pending}},stranger,callback);assert.match(stranger.headers.Location,/failed/);
  const exchange=calls[0].options.body;assert.equal(createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'),location.searchParams.get('code_challenge'));
});
test('approval requires permission, a human label and the matching model/photo',async()=>{
  const {service,id}=await setup();await assert.rejects(approve(service,id),/review first/);await save(service,id);const {revision}=await service.list();await assert.rejects(service.approve(id,{revision,modelRevision:'wrong'},'owner'),/current checker/);await approve(service,id);
  const other=await setup({allowed:false});await save(other.service,other.id);await assert.rejects(approve(other.service,other.id),/permission/);
  const current=await service.list();await assert.rejects(service.save(id,{revision:current.revision-1,category:'normal',group:'same',notes:''},'owner'),/another tab/);
});
test('checked publication exposes only feature labels, supports rollback, and exclusion is immediate',async()=>{
  const {service,id}=await setup();await save(service,id);await approve(service,id);assert.equal((await service.publicDatabase()).references.length,base.references.length);
  const draft=await service.prepare('owner');assert.ok(draft.report.passed);await service.publish(draft.version,'owner');const index=await service.publicDatabase();assert.equal(index.references.length,base.references.length+1);const community=index.references.at(-1);assert.deepEqual(Object.keys(community).sort(),['id','category','group_id','embedding','label_status'].sort());assert.doesNotMatch(JSON.stringify(community),/private|email|notes/);
  await service.rollback(null,'owner');assert.equal((await service.publicDatabase()).references.length,base.references.length);await service.rollback(draft.version,'owner');assert.equal((await service.publicDatabase()).references.length,base.references.length+1);
  await service.exclude(id,{revision:(await service.list()).revision,withdrawTraining:true},'owner');assert.equal((await service.publicDatabase()).references.length,base.references.length);await assert.rejects(service.rollback(draft.version,'owner'),/approval changed/);await assert.rejects(approve(service,id),/permission/);
});
test('a changed label invalidates prepared publication and duplicate photos cannot inflate support',async()=>{
  const {service,storage,id}=await setup();await save(service,id);await approve(service,id);const draft=await service.prepare('owner');await save(service,id,'normal');await assert.rejects(service.publish(draft.version,'owner'),/checks again/);
  await save(service,id);await approve(service,id);const second=randomUUID(),original=await storage.getJson(`submissions/${id}.json`);await storage.putJson(`submissions/${second}.json`,{...original,id:second});await save(service,second);await approve(service,second);await assert.rejects(service.prepare('owner'),/duplicate photo/);
});
test('the same plant cannot appear in both matching and held-out sets',async()=>{
  const {service,storage,id}=await setup();await save(service,id);await approve(service,id);const second=randomUUID(),original=await storage.getJson(`submissions/${id}.json`);await storage.putJson(`submissions/${second}.json`,{...original,id:second,photo:{...original.photo,sha256:randomUUID()}});await save(service,second);await approve(service,second,'evaluation');await assert.rejects(service.prepare('owner'),/same plant/);
  const report=evaluateReferences(base,base.references);assert.equal(report.passed,true);assert.equal(report.regression.total,base.references.length);
});
test('replies are durable, retry with the same id, and cannot change after submission',async()=>{
  let attempts=0,time=new Date('2026-11-02T16:00:00Z');const {service,id}=await setup({now:()=>time,sendReply:async()=>{if(++attempts===1)throw new Error('offline');}});const input={requestId:randomUUID(),body:'A helpful human-written review.'};assert.equal((await service.reply(id,input,'owner')).status,'pending');time=new Date(time.getTime()+61000);await service.retryReplies();assert.equal((await service.reply(id,input,'owner')).status,'sent');assert.equal(attempts,2);await assert.rejects(service.reply(id,{...input,body:'Changed message text'},'owner'),/reply changed/);
});
test('admin HTTP blocks anonymous image reads and CSRF, while reference index stays public',async t=>{
  const {service,id}=await setup();const auth={enabled:true,handle:async()=>false,session:req=>req.headers.authorization==='owner'?{login:'owner',csrf:'token'}:null,mutateAllowed:(req)=>req.headers.origin==='https://isthisleafygall.com' && req.headers['x-csrf-token']==='token'};
  const handler=createAdminHandler({}, {service,base,auth});const server=createServer(async(req,res)=>{if(!await handler.handle(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{handler.close();server.closeAllConnections();server.close();});const origin=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/api/admin/reviews/${id}/photo`)).status,401);const anon=await(await fetch(`${origin}/api/admin/session`)).json();assert.deepEqual(anon,{enabled:true,authenticated:false});assert.equal((await fetch(`${origin}/reference-index.json`)).status,200);
  const forbidden=await fetch(`${origin}/api/admin/reviews/${id}`,{method:'POST',headers:{Authorization:'owner','Content-Type':'application/json',Origin:'https://evil.test','X-CSRF-Token':'token'},body:'{}'});assert.equal(forbidden.status,403);
  const queue=await fetch(`${origin}/api/admin/reviews`,{headers:{Authorization:'owner'}});assert.match(queue.headers.get('cache-control'),/no-store/);assert.equal((await queue.json()).items.length,1);
});
test('dashboard has no analytics and replies always use the submission recipient',async()=>{
  const html=await readFile(new URL('../dist/admin/index.html',import.meta.url),'utf8'),js=await readFile(new URL('../dist/admin/admin.js',import.meta.url),'utf8');assert.doesNotMatch(html+js,/posthog|analytics\.js|innerHTML|localStorage/);let sent;
  const sender=createReplySender({RESEND_API_KEY:'server-secret',REVIEW_REPLY_FROM_EMAIL:'reviews@example.com',REVIEW_NOTIFY_TO:'owner@example.com'},async(url,options)=>{sent=JSON.parse(options.body);return new Response('{}');});await sender({id:randomUUID(),email:'visitor@example.com'},{id:randomUUID(),body:'Human review'});assert.deepEqual(sent.to,['visitor@example.com']);assert.equal(sent.reply_to,'owner@example.com');assert.equal(createReplySender({RESEND_API_KEY:'x',REVIEW_REPLY_FROM_EMAIL:'onboarding@resend.dev'}),null);
});
