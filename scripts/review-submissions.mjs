import { mkdir,writeFile,readdir,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { reviewStorageConfig,createReviewStorage } from '../server/review-storage.mjs';
import { trainingEntry } from '../server/reviews.mjs';
import { createAdminService } from '../server/admin-service.mjs';
const config=reviewStorageConfig();
if(!config)throw new Error('Configure the private review bucket credentials first.');
const storage=createReviewStorage(config);
const base=JSON.parse(await readFile(new URL('../dist/models/references.json',import.meta.url)));
const admin=createAdminService({storage,base});
const [command,...args]=process.argv.slice(2);
async function records() {
  const state=await storage.getJson('admin/state.json');
  const results=new Map();
  for(const prefix of ['pending/','submissions/'])for(const key of await storage.list(prefix,100000))if(key.endsWith('.json')) {
    const record=await storage.getJson(key);if(record){const review=state?.reviews?.[record.id];if(review?.reviewedAt)record.review={category:review.category,reviewedAt:review.reviewedAt,evidence:'human_visual_review'};if(review?.trainingWithdrawn)record.consent.trainingAllowed=false;results.set(record.id,{record,key});}
  }
  return [...results.values()].sort((a,b)=>a.record.createdAt.localeCompare(b.record.createdAt));
}
if(command==='list') {
  for(const {record} of await records())console.log(JSON.stringify({id:record.id,submitted:record.createdAt,review:record.review.category,trainingAllowed:record.consent.trainingAllowed,notification:record.notification.status}));
} else if(command==='label') {
  const [id,category]=args;
  if(!['leafy','normal','crown','other','unclear'].includes(category))throw new Error('Use: label <submission-id> leafy|normal|crown|other|unclear');
  const item=(await records()).find(x=>x.record.id===id);
  if(!item)throw new Error('Submission not found.');
  const queue=await admin.list(),itemView=queue.items.find(x=>x.id===id);
  await admin.save(id,{revision:queue.revision,category,group:itemView.group,notes:itemView.reviewNotes},'owner-cli');console.log(`Recorded visual-review label for ${id}. This is not laboratory confirmation.`);
} else if(command==='revoke-training' || command==='delete') {
  const [id,confirmation]=args;
  const item=(await records()).find(x=>x.record.id===id);
  if(!item)throw new Error('Submission not found.');
  if(command==='revoke-training') {
    await admin.exclude(id,{revision:(await admin.list()).revision,withdrawTraining:true},'owner-cli');
    item.record.consent.trainingAllowed=false;item.record.consent.withdrawnAt=new Date().toISOString();
    await storage.putJson(item.key,item.record);console.log(`Excluded ${id} from future training exports.`);
  } else {
    if(confirmation!=='--confirm')throw new Error('Deletion is permanent. Use delete <id> --confirm only for an authorized deletion request.');
    await admin.forget(id);
    await storage.delete(item.record.photo.key);await storage.delete(`pending/${id}.json`);await storage.delete(`submissions/${id}.json`);
    console.log(`Deleted private submission ${id}. Remove it from prior exports too.`);
  }
} else if(command==='export') {
  const directory=resolve(args[0] || '.cache/reviewed-training');await mkdir(directory,{recursive:true});
  if((await readdir(directory)).length)throw new Error('Use an empty export directory so withdrawn photos cannot remain from an older export.');
  const manifest=[];
  for(const {record} of await records()) {
    const entry=trainingEntry(record);if(!entry)continue;
    const file=`${record.id}.jpg`;await writeFile(resolve(directory,file),await storage.getBytes(record.photo.key));manifest.push({...entry,file});
  }
  await writeFile(resolve(directory,'manifest.json'),JSON.stringify({notice:'Private, permissioned visual-review examples; not laboratory-confirmed labels. Emails and notes are excluded.',examples:manifest},null,2));
  console.log(`Exported ${manifest.length} consented, human-reviewed photos to ${directory}.`);
} else throw new Error('Use list, label <id> <category>, revoke-training <id>, delete <id> --confirm, or export [empty-directory].');
