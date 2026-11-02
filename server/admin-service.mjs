import { createHash,randomUUID } from 'node:crypto';
import { compareEmbedding } from '../dist/inference.js';
import { consentForTraining,ReviewError,validEmail } from './reviews.mjs';

const categories=['leafy','normal','crown','other','unclear'];
const accepted=['leafy','normal','crown'];
const stateKey='admin/state.json';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const validId=id=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id || '');
const emptyState=()=>({revision:0,reviews:{},releases:[],activeVersion:null,prepared:null});
function vector(value) {if(!Array.isArray(value) || value.length!==512 || value.some(x=>!Number.isFinite(x)))throw new ReviewError(400,'Could not read the image features. Generate them again.');const norm=Math.sqrt(value.reduce((s,x)=>s+x*x,0));if(Math.abs(norm-1)>.01)throw new ReviewError(400,'Image features are invalid. Generate them again.');return value.map(x=>x/norm);}

export function evaluateReferences(base,references,evaluation=[]) {
  function check(rows,ref,leaveOut) {let match=0,abstain=0,wrong=0;for(const row of rows){const result=compareEmbedding(row.embedding,{...base,references:leaveOut?ref.filter(x=>x.group_id!==row.group_id):ref});if(result.category===row.category)match++;else if(result.category==='unclear')abstain++;else wrong++;}return {total:rows.length,match,abstain,wrong};}
  const baseline=check(base.references,base.references,true),regression=check(base.references,references,true),heldOut=check(evaluation,references,false);
  return {passed:regression.wrong<=baseline.wrong && heldOut.wrong===0,baseline,regression,heldOut,notice:'Development check of visual labels, not a disease accuracy estimate. Related plant groups are kept apart.'};
}

export function createAdminService({storage,base,sendReply,now=()=>new Date()}) {
  let localQueue=Promise.resolve();
  const serial=fn=>{const task=localQueue.then(fn);localQueue=task.catch(()=>{});return task;};
  async function stateVersion(){const result=await storage.getJsonVersion(stateKey);return {...result,value:result.value || emptyState()};}
  async function record(id) {if(!validId(id))throw new ReviewError(404,'Submission not found.');const item=(await storage.getJson(`submissions/${id}.json`)) || (await storage.getJson(`pending/${id}.json`));if(!item)throw new ReviewError(404,'Submission not found.');return item;}
  async function records() {const keys=await Promise.all(['submissions/','pending/'].map(prefix=>storage.list(prefix,10000)));const map=new Map();for(const key of keys.flat().filter(x=>x.endsWith('.json'))){const item=await storage.getJson(key);if(item)map.set(item.id,item);}return [...map.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  function view(item,state) {const review=state.reviews[item.id] || {};return {id:item.id,createdAt:item.createdAt,email:item.email,notes:item.notes,modelCategory:item.modelCategory,photoSha256:item.photo.sha256,trainingAllowed:consentForTraining(item) && !review.trainingWithdrawn,category:review.category || item.review?.category || 'unreviewed',reviewNotes:review.notes || '',group:review.group || `plant-${item.id.slice(0,8)}`,reviewedAt:review.reviewedAt || item.review?.reviewedAt,approved:Boolean(review.reference),role:review.reference?.role || 'reference',replies:(review.replies || []).map(x=>({id:x.id,body:x.body,status:x.status,createdAt:x.createdAt,sentAt:x.sentAt})),revision:state.revision};}
  async function change(fn) {return serial(async()=>{const current=await stateVersion();const result=await fn(current.value);current.value.revision++;await storage.putJsonVersion(stateKey,current.value,current.etag);return result;});}
  function audit(review,actor,action){review.history=[...(review.history || []),{actor,action,at:now().toISOString()}].slice(-100);}
  async function selected(state) {
    const references=[],evaluation=[];
    const groups=new Map(),photos=new Set(base.references.map(x=>x.sha256).filter(Boolean));
    for(const [id,review] of Object.entries(state.reviews))if(review.reference) {
      const item=await record(id),entry=review.reference;
      if(!consentForTraining(item) || review.trainingWithdrawn || !accepted.includes(review.category) || !review.reviewedAt || entry.photoSha256!==item.photo.sha256 || entry.modelRevision!==base.revision)throw new ReviewError(409,'An approved example changed or no longer has permission. Review its approval again.');
      if(photos.has(item.photo.sha256))throw new ReviewError(409,'The approved set contains a duplicate photo. Keep one copy.');photos.add(item.photo.sha256);
      const group=`community:${hash(review.group).slice(0,24)}`;
      const known=groups.get(group);if(known && (known.role!==entry.role || known.category!==review.category))throw new ReviewError(409,'Photos of the same plant must have the same label and stay in one reference or evaluation group.');groups.set(group,{role:entry.role,category:review.category});
      const safe={id:`community-${id}`,category:review.category,group_id:group,embedding:vector(entry.embedding),label_status:'human_visual_review'};
      (entry.role==='evaluation'?evaluation:references).push(safe);
    }
    return {references,evaluation};
  }
  async function publicDatabase() {
    const {value:state}=await stateVersion();if(!state.activeVersion)return base;
    const release=await storage.getJson(`reference-releases/${state.activeVersion}.json`);if(!release)return base;
    // Removing an approval immediately removes it from the live index, even before the next release.
    const allowed=new Set(Object.entries(state.reviews).filter(([,r])=>r.reference && r.reference.role==='reference' && !r.trainingWithdrawn && r.category===r.reference.category).map(([id])=>`community-${id}`));
    return {...base,referenceVersion:release.version,references:[...base.references,...release.references.filter(r=>allowed.has(r.id))]};
  }
  async function deliverReply(id,replyId) {
    return serial(async()=>{
      const current=await stateVersion(),review=current.value.reviews[id],reply=review?.replies?.find(r=>r.id===replyId);
      if(!reply || reply.status==='sent' || (reply.nextAttemptAt && new Date(reply.nextAttemptAt)>now()))return;
      const item=await record(id);
      try {if(!validEmail(item.email))throw new Error();await sendReply(item,reply);reply.status='sent';reply.sentAt=now().toISOString();}
      catch {reply.attempts=(reply.attempts || 0)+1;reply.nextAttemptAt=new Date(now().getTime()+Math.min(3600,60*2**Math.min(reply.attempts-1,6))*1000).toISOString();}
      current.value.revision++;await storage.putJsonVersion(stateKey,current.value,current.etag);
    });
  }
  return {
    async list(){const [{value:state},items]=await Promise.all([stateVersion(),records()]);return {items:items.map(x=>view(x,state)),revision:state.revision,activeVersion:state.activeVersion,releases:state.releases.slice(-20).reverse(),modelRevision:base.revision,prepared:state.prepared?{version:state.prepared.version,report:state.prepared.report,referenceCount:state.prepared.references.length,evaluationCount:state.prepared.evaluationCount}:null};},
    async photo(id){const item=await record(id);return storage.getBytes(item.photo.key);},
    async save(id,input,actor) {return change(async state=>{const item=await record(id);if(input.revision!==state.revision)throw new ReviewError(409,'This queue changed in another tab. Refresh and try again.');if(!categories.includes(input.category) || typeof input.notes!=='string' || input.notes.length>2000 || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.group || ''))throw new ReviewError(400,'Choose a label, a plant group and notes under 2,000 characters.');const review=state.reviews[id] ||= {};const changed=review.category!==input.category || review.group!==input.group;review.category=input.category;review.group=input.group;review.notes=input.notes;review.reviewedAt=now().toISOString();if(changed)delete review.reference;audit(review,actor,'review_saved');state.prepared=null;return view(item,state);});},
    async approve(id,input,actor) {return change(async state=>{const item=await record(id),review=state.reviews[id];if(input.revision!==state.revision)throw new ReviewError(409,'This queue changed. Refresh and try again.');if(!review || !review.reviewedAt || !accepted.includes(review.category))throw new ReviewError(400,'Save a leafy gall, normal growth or crown gall review first.');if(!consentForTraining(item) || review.trainingWithdrawn)throw new ReviewError(403,'This photo does not have permission to improve the checker.');if(input.photoSha256!==item.photo.sha256 || input.modelRevision!==base.revision || !['reference','evaluation'].includes(input.role))throw new ReviewError(400,'Generate features for this photo using the current checker.');review.reference={embedding:vector(input.embedding),photoSha256:item.photo.sha256,modelRevision:base.revision,category:review.category,role:input.role,approvedAt:now().toISOString()};audit(review,actor,`approved_${input.role}`);state.prepared=null;});},
    async exclude(id,input,actor){return change(async state=>{await record(id);if(input.revision!==state.revision)throw new ReviewError(409,'This queue changed. Refresh and try again.');const review=state.reviews[id] ||= {};delete review.reference;if(input.withdrawTraining===true)review.trainingWithdrawn=true;state.prepared=null;audit(review,actor,input.withdrawTraining?'training_withdrawn':'approval_removed');});},
    async forget(id){return change(async state=>{await record(id);delete state.reviews[id];state.prepared=null;});},
    async prepare(actor){return change(async state=>{const {references,evaluation}=await selected(state);const report=evaluateReferences(base,[...base.references,...references],evaluation);state.prepared={version:randomUUID(),references,evaluationCount:evaluation.length,digest:hash(state.reviews),report,preparedAt:now().toISOString(),actor};return {version:state.prepared.version,referenceCount:references.length,evaluationCount:evaluation.length,report};});},
    async publish(version,actor){return change(async state=>{const draft=state.prepared;if(!draft || draft.version!==version || !draft.report.passed || draft.digest!==hash(state.reviews))throw new ReviewError(409,'Run the reference checks again before publishing.');await selected(state);const release={version:draft.version,references:draft.references,report:draft.report,publishedAt:now().toISOString(),actor};await storage.putJson(`reference-releases/${release.version}.json`,release);state.activeVersion=release.version;state.releases.push({version:release.version,publishedAt:release.publishedAt,count:release.references.length});state.prepared=null;return {version:release.version};});},
    async rollback(version,actor){return change(async state=>{if(version!==null && !state.releases.some(x=>x.version===version))throw new ReviewError(404,'Reference version not found.');if(version){const release=await storage.getJson(`reference-releases/${version}.json`);const {references}=await selected(state);const allowed=new Map(references.map(x=>[x.id,hash(x)]));if(!release || release.references.some(x=>allowed.get(x.id)!==hash(x)))throw new ReviewError(409,'This version includes examples whose approval changed. Publish a new version instead.');}state.activeVersion=version;state.prepared=null;state.releases.push({version,publishedAt:now().toISOString(),action:'rollback',actor});return {version};});},
    publicDatabase,
    async reply(id,input,actor){if(!sendReply)throw new ReviewError(503,'Replies need a verified sending domain first.');if(!validId(input.requestId) || typeof input.body!=='string' || input.body.trim().length<10 || input.body.length>5000)throw new ReviewError(400,'Write a reply between 10 and 5,000 characters.');await change(async state=>{await record(id);const review=state.reviews[id] ||= {},replies=review.replies ||= [];const previous=replies.find(x=>x.id===input.requestId);if(previous){if(previous.body!==input.body.trim())throw new ReviewError(409,'This reply changed. Refresh before sending a different reply.');return;}if(replies.some(x=>x.status==='pending'))throw new ReviewError(409,'A reply is already waiting to send.');replies.push({id:input.requestId,body:input.body.trim(),status:'pending',createdAt:now().toISOString(),actor});audit(review,actor,'reply_queued');});await deliverReply(id,input.requestId);const {value:state}=await stateVersion();return {status:state.reviews[id].replies.find(x=>x.id===input.requestId).status};},
    async retryReplies(){if(!sendReply)return;const {value:state}=await stateVersion();for(const [id,review]of Object.entries(state.reviews))for(const reply of review.replies || [])if(reply.status==='pending')await deliverReply(id,reply.id);}
  };
}
