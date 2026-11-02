import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
export function reviewStorageConfig(env = process.env) {
  const endpoint=env.REVIEW_S3_ENDPOINT, bucket=env.REVIEW_S3_BUCKET, accessKeyId=env.REVIEW_S3_ACCESS_KEY_ID, secretAccessKey=env.REVIEW_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  try { if (new URL(endpoint).protocol !== 'https:' && env.NODE_ENV === 'production') return null; } catch { return null; }
  return { endpoint,bucket,region:env.REVIEW_S3_REGION || 'auto',credentials:{accessKeyId,secretAccessKey} };
}
export function createReviewStorage(config) {
  const client=new S3Client({endpoint:config.endpoint,region:config.region,credentials:config.credentials,forcePathStyle:true,maxAttempts:3,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  const send=command=>client.send(command,{abortSignal:AbortSignal.timeout(20000)});
  const store={
    async putBytes(key,bytes,type) { await send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:bytes,ContentType:type,CacheControl:'private, no-store'})); },
    async putJson(key,value) { await store.putBytes(key,Buffer.from(JSON.stringify(value)), 'application/json'); },
    async getBytes(key) { const result=await send(new GetObjectCommand({Bucket:config.bucket,Key:key})); return Buffer.from(await result.Body.transformToByteArray()); },
    async getJson(key) { try {return JSON.parse(await store.getBytes(key));} catch(error) { if(error.name==='NoSuchKey' || error.$metadata?.httpStatusCode===404)return null;throw error; } },
    async getJsonVersion(key) {try {const result=await send(new GetObjectCommand({Bucket:config.bucket,Key:key}));return {value:JSON.parse(await result.Body.transformToString()),etag:result.ETag};}catch(error){if(error.name==='NoSuchKey' || error.$metadata?.httpStatusCode===404)return {value:null,etag:null};throw error;}},
    async putJsonVersion(key,value,etag) {try {await send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:Buffer.from(JSON.stringify(value)),ContentType:'application/json',CacheControl:'private, no-store',...(etag?{IfMatch:etag}:{IfNoneMatch:'*'})}));}catch(error){if([409,412].includes(error.$metadata?.httpStatusCode)){const conflict=new Error('This review changed in another tab. Refresh and try again.');conflict.status=409;throw conflict;}throw error;}},
    async delete(key) { await send(new DeleteObjectCommand({Bucket:config.bucket,Key:key})); },
    async list(prefix,limit=1000) {
      const keys=[];let token;
      do { const page=await send(new ListObjectsV2Command({Bucket:config.bucket,Prefix:prefix,MaxKeys:Math.min(1000,limit-keys.length),ContinuationToken:token}));keys.push(...(page.Contents || []).map(x=>x.Key));token=page.NextContinuationToken; } while(token && keys.length<limit);
      return keys;
    }
  };
  return store;
}
