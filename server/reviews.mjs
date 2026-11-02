import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
export const CONSENT_VERSION = '2026-11-02';
export const REVIEW_PERMISSION = 'I have permission to share this photo for private review and to be contacted by email about it.';
export const TRAINING_PERMISSION = 'You may use my photo to improve the checker through reviewed reference matching, training and evaluation. My email will stay private.';
const categories = ['leafy', 'normal', 'crown', 'unclear', 'not_checked'];
export class ReviewError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(value);
}
export function validateReview(fields) {
  const email = String(fields.email || '').trim();
  if (!validEmail(email)) throw new ReviewError(400, 'Enter a valid email address so we can reply.');
  if (fields.reviewPermission !== 'yes') throw new ReviewError(400, 'Confirm you have permission to submit this photo for review.');
  if (!['yes','no'].includes(fields.trainingPermission)) throw new ReviewError(400, 'Choose whether your photo may help improve the checker.');
  if (fields.website) throw new ReviewError(400, 'The submission could not be accepted.');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(fields.requestId || '')) throw new ReviewError(400, 'Please reopen the form and try again.');
  const notes = String(fields.notes || '').trim();
  if (notes.length > 1000) throw new ReviewError(400, 'Keep your notes under 1,000 characters.');
  return { email, notes, id: fields.requestId.toLowerCase(), modelCategory: categories.includes(fields.modelCategory) ? fields.modelCategory : 'not_checked', trainingAllowed: fields.trainingPermission === 'yes' };
}
export async function normalizeReviewPhoto(bytes) {
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isWebp = bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw new ReviewError(400, 'Choose a JPG, PNG or WebP photo.');
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'error' });
    const metadata = await image.metadata();
    if ((metadata.pages || 1) > 1 || Math.min(metadata.width || 0, metadata.height || 0) < 64) throw new Error('dimensions');
    // Re-encoding strips EXIF/GPS and original filenames; originals are not saved.
    return await image.rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:86}).toBuffer();
  } catch { throw new ReviewError(400, 'This photo could not be opened. Choose a clear JPG, PNG or WebP under 16 megapixels.'); }
}
export function consentForTraining(record) {
  return record.consent?.trainingAllowed === true && record.consent?.version === CONSENT_VERSION && record.consent?.reviewPermission === REVIEW_PERMISSION;
}
export function trainingEntry(record) {
  if (!consentForTraining(record) || !['leafy','normal','crown','other'].includes(record.review?.category) || record.review.evidence !== 'human_visual_review' || !record.review.reviewedAt) return null;
  return { id:record.id, category:record.review.category, labelStatus:'human_visual_review', reviewedAt:record.review.reviewedAt, consentVersion:record.consent.version, consentedAt:record.consent.acceptedAt, sha256:record.photo.sha256 };
}
export function createReviewService({ storage, sendNotification, now = () => new Date() }) {
  const inFlight = new Map();
  async function find(id) {
    return (await storage.getJson(`submissions/${id}.json`)) || (await storage.getJson(`pending/${id}.json`));
  }
  async function deliver(id) {
    if (inFlight.has(id)) return inFlight.get(id);
    const work = (async () => {
      const pendingKey = `pending/${id}.json`;
      const record = await storage.getJson(pendingKey);
      if (!record) return;
      if(await storage.getJson(`deleted/${id}.json`)){await storage.delete(pendingKey);return;}
      const delivered = await storage.getJson(`submissions/${id}.json`);
      if (delivered?.notification?.status === 'sent') { await storage.delete(pendingKey); return; }
      if (record.notification.nextAttemptAt && new Date(record.notification.nextAttemptAt) > now()) return;
      try {
        const photo = await storage.getBytes(record.photo.key);
        await sendNotification(record, photo);
        if(await storage.getJson(`deleted/${id}.json`)){await storage.delete(pendingKey);return;}
        record.notification = { status:'sent', sentAt:now().toISOString(), attempts:record.notification.attempts + 1 };
        await storage.putJson(`submissions/${id}.json`,record);
        if(await storage.getJson(`deleted/${id}.json`))await storage.delete(`submissions/${id}.json`);
        await storage.delete(pendingKey);
      } catch {
        if(await storage.getJson(`deleted/${id}.json`)){await storage.delete(pendingKey);return;}
        // The durable pending record survives deploys and provider outages.
        record.notification.attempts++;
        record.notification.nextAttemptAt = new Date(now().getTime() + Math.min(3600,60 * 2 ** Math.min(record.notification.attempts - 1,6)) * 1000).toISOString();
        await storage.putJson(pendingKey,record);
        console.error('[Photo review] Notification pending:',id);
      }
    })();
    inFlight.set(id,work);
    try { await work; } finally { inFlight.delete(id); }
  }
  return {
    find,
    async submit(fields, bytes) {
      const values = validateReview(fields);
      if(await storage.getJson(`deleted/${values.id}.json`))throw new ReviewError(410,'This submission was deleted. Reopen the form to make a new request.');
      const photo = await normalizeReviewPhoto(bytes);
      const sha256 = createHash('sha256').update(photo).digest('hex');
      const fingerprint = createHash('sha256').update(JSON.stringify({...values,sha256})).digest('hex');
      const previous = await find(values.id);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ReviewError(409,'This request has changed. Reopen the form to send a new photo.');
        return { id:values.id };
      }
      const key = `photos/${values.id}.jpg`;
      const record = { id:values.id, createdAt:now().toISOString(), email:values.email, notes:values.notes, modelCategory:values.modelCategory, fingerprint,
        photo:{key,sha256,contentType:'image/jpeg'},
        consent:{version:CONSENT_VERSION,reviewPermission:REVIEW_PERMISSION,trainingPermission:TRAINING_PERMISSION,trainingAllowed:values.trainingAllowed,acceptedAt:now().toISOString()},
        review:{category:'unreviewed'}, notification:{status:'pending',attempts:0} };
      await storage.putBytes(key,photo,'image/jpeg');
      try { await storage.putJson(`pending/${values.id}.json`,record); }
      catch(error) { await storage.delete(key).catch(()=>{}); throw error; }
      void deliver(values.id).catch(()=>console.error('[Photo review] Delivery will retry:',values.id));
      return { id:values.id };
    },
    deliver,
    async retryPending() {
      const keys = await storage.list('pending/',20);
      for (const key of keys) if (key.endsWith('.json')) await deliver(key.slice('pending/'.length,-5));
    }
  };
}
export function reviewNotification(record, photo, {from,to}) {
  return { from, to:[to], reply_to:record.email,
    subject:`Dahlia photo review: ${record.id}`,
    text:[`A visitor requested a photo review. Open https://isthisleafygall.com/admin#${record.id} to review it on the site, or reply to this email to answer them.`, `Review ID: ${record.id}`, `Submitted: ${record.createdAt}`, `Visitor email: ${record.email}`, `Checker comparison (unverified): ${record.modelCategory}`, `Training permission: ${record.consent.trainingAllowed ? 'YES' : 'NO — review only; exclude from training'}`, `Notes from the visitor:\n${record.notes || '(none)'}`, 'The attached photo has been resized and its embedded metadata removed. Stored privately in Railway.','Please do not describe a visual review as laboratory confirmation.'].join('\n\n'),
    attachments:[{filename:`dahlia-review-${record.id}.jpg`,content:photo.toString('base64')}] };
}
export function makeResendNotifier(config, fetcher = fetch) {
  return async (record,photo) => {
    const response = await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json','Idempotency-Key':`leafy-gall-review-${record.id}`},body:JSON.stringify(reviewNotification(record,photo,config)),signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('Review notification delivery failed.');
  };
}
