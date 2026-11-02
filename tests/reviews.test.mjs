import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createReviewService, validateReview, normalizeReviewPhoto, trainingEntry, reviewNotification, REVIEW_PERMISSION, CONSENT_VERSION } from '../server/reviews.mjs';
import { createReviewHandler, safeSupportUrl } from '../server/review-http.mjs';
import { readFile } from 'node:fs/promises';

function memoryStore() {
  const files=new Map();return { files,
    async putBytes(key,value){files.set(key,Buffer.from(value));},
    async putJson(key,value){files.set(key,Buffer.from(JSON.stringify(value)));},
    async getBytes(key){if(!files.has(key))throw new Error('missing');return Buffer.from(files.get(key));},
    async getJson(key){return files.has(key)?JSON.parse(files.get(key)):null;},
    async delete(key){files.delete(key);},
    async list(prefix,limit=1000){return [...files.keys()].filter(key=>key.startsWith(prefix)).slice(0,limit);}
  };
}
const fields=(overrides={})=>({requestId:randomUUID(),email:'visitor@example.com',reviewPermission:'yes',trainingPermission:'no',modelCategory:'unclear',notes:'Please look at the crown.',...overrides});
const photo=()=>sharp({create:{width:120,height:100,channels:3,background:'#9eb27d'}}).withExif({IFD0:{Artist:'Private test photographer',ImageDescription:'Private test location'}}).jpeg().toBuffer();

test('review requires valid email and ownership permission but training remains optional',()=>{
  assert.equal(validateReview(fields()).trainingAllowed,false);
  assert.equal(validateReview(fields({trainingPermission:'yes'})).trainingAllowed,true);
  for(const bad of [{email:'x@example.com\r\nBcc: victim@example.com'},{email:'not-an-email'},{reviewPermission:'no'},{trainingPermission:undefined},{website:'spam'},{requestId:'../../private'}])assert.throws(()=>validateReview(fields(bad)));
});
test('uploaded image bytes are decoded and re-encoded without embedded metadata',async()=>{
  const original=await photo();assert.ok((await sharp(original).metadata()).exif);
  const normalized=await normalizeReviewPhoto(original), metadata=await sharp(normalized).metadata();
  assert.equal(metadata.format,'jpeg');assert.equal(metadata.exif,undefined);
  assert.doesNotMatch(normalized.toString(),/Private test/);
  await assert.rejects(normalizeReviewPhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')));
  await assert.rejects(normalizeReviewPhoto(Buffer.from('not a photo')));
});
test('submissions survive mail failure, retry once, and deduplicate identical requests',async()=>{
  const storage=memoryStore();let time=new Date('2026-11-02T12:00:00Z'), attempts=0;
  const service=createReviewService({storage,now:()=>time,sendNotification:async()=>{if(++attempts===1)throw new Error('temporary mail outage');}});
  const data=fields(), image=await photo();
  const result=await service.submit(data,image);await service.deliver(result.id);
  assert.equal((await storage.getJson(`pending/${result.id}.json`)).consent.trainingAllowed,false);
  time=new Date(time.getTime()+61000);await service.retryPending();
  assert.equal(attempts,2);assert.equal(await storage.getJson(`pending/${result.id}.json`),null);
  const record=await storage.getJson(`submissions/${result.id}.json`);
  assert.equal(record.notification.status,'sent');assert.equal(record.consent.reviewPermission,REVIEW_PERMISSION);
  assert.deepEqual(await service.submit(data,image),result);assert.equal(attempts,2);
  await assert.rejects(service.submit({...data,trainingPermission:'yes'},image),/request has changed/);
});
test('training exports require explicit permission and human review, and exclude contact data',()=>{
  const base={id:randomUUID(),email:'private@example.com',notes:'Private notes',photo:{sha256:'abc'},consent:{trainingAllowed:false,version:CONSENT_VERSION,reviewPermission:REVIEW_PERMISSION,acceptedAt:'today'},review:{category:'normal',reviewedAt:'today',evidence:'human_visual_review'}};
  assert.equal(trainingEntry(base),null);
  assert.equal(trainingEntry({...base,consent:{...base.consent,trainingAllowed:true},review:{category:'unreviewed'}}),null);
  assert.equal(trainingEntry({...base,consent:{...base.consent,trainingAllowed:true},review:{category:'normal',reviewedAt:'today',evidence:'model_prediction'}}),null);
  const accepted=trainingEntry({...base,consent:{...base.consent,trainingAllowed:true}});
  assert.equal(accepted.labelStatus,'human_visual_review');assert.doesNotMatch(JSON.stringify(accepted),/private|email|notes/i);
});
test('notification goes only to the owner and replying addresses the visitor',()=>{
  const record={id:randomUUID(),email:'visitor@example.com',createdAt:'today',modelCategory:'unclear',notes:'Some context',consent:{trainingAllowed:false}};
  const email=reviewNotification(record,Buffer.from('test-image'),{from:'Review <review@example.com>',to:'owner@example.com'});
  assert.deepEqual(email.to,['owner@example.com']);assert.equal(email.reply_to,'visitor@example.com');assert.equal(email.attachments.length,1);
  assert.match(email.text,/NO — review only/);assert.match(email.text,/not reviewed|unverified/);
});
test('public upload endpoint rejects cross-site requests and validates a real multipart submission',async t=>{
  const storage=memoryStore();const service=createReviewService({storage,sendNotification:async()=>{}});
  const handler=createReviewHandler({NODE_ENV:'production',SUPPORT_URL:'https://ko-fi.com/example'},service);
  const server=createServer(async(req,res)=>{if(!await handler.handle(req,res,new URL(req.url,'http://localhost').pathname)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>{handler.close();server.closeAllConnections();server.close();});
  const bad=await fetch(`${origin}/api/reviews`,{method:'POST',headers:{Origin:'https://other.example'},body:'no'});assert.equal(bad.status,403);
  const form=new FormData();for(const [key,value]of Object.entries(fields()))form.set(key,value);form.set('photo',new Blob([await photo()],{type:'image/jpeg'}),'private-original-name.jpg');
  const response=await fetch(`${origin}/api/reviews`,{method:'POST',headers:{Origin:'https://isthisleafygall.com'},body:form});
  assert.equal(response.status,201);const result=await response.json();assert.deepEqual(Object.keys(result),['id']);
  await service.deliver(result.id);assert.ok(storage.files.has(`photos/${result.id}.jpg`));
  assert.doesNotMatch([...storage.files.keys()].join(','),/private-original/);
  const config=await(await fetch(`${origin}/submission-config.json`)).json();assert.deepEqual(config,{enabled:true,supportUrl:'https://ko-fi.com/example'});
});
test('review UI is voluntary, training is unchecked, and GitHub remains only a source link',async()=>{
  const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  const client=await readFile(new URL('../dist/reviews.js',import.meta.url),'utf8');
  assert.doesNotMatch(html,/issues\/new\?template=reference-photo/);
  assert.match(html,/Source code/);assert.match(html,/name="trainingPermission" type="checkbox" value="yes">/);
  assert.match(client,/form\.addEventListener\('submit'/);assert.match(client,/canvas\.toBlob/);
  assert.equal(safeSupportUrl('https://ko-fi.com/real-page'),'https://ko-fi.com/real-page');
  for(const url of ['javascript:alert(1)','https://ko-fi.com.evil.test/page','https://ko-fi.com/','https://ko-fi.com/name?token=secret'])assert.equal(safeSupportUrl(url),null);
});
