import { track } from './analytics.js';
export function setupReviews({getPhoto,getResult}) {
  const $=selector=>document.querySelector(selector), dialog=$('#review-dialog'), form=$('#review-form');
  let image, ownedUrl, requestId, busy=false;
  const resetImage=()=>{if(ownedUrl)URL.revokeObjectURL(ownedUrl);ownedUrl=undefined;image=undefined;$('#review-preview').removeAttribute('src');$('#review-preview').hidden=true;};
  const setStatus=(text,error=false)=>{$('#review-status').textContent=text;$('#review-status').className=error?'form-status form-error':'form-status';};
  const settings=fetch('./submission-config.json',{cache:'no-store'}).then(r=>r.ok?r.json():{enabled:false}).then(value=>{
    if(value.supportUrl){$('#support-donate').href=value.supportUrl;$('#support-donate').hidden=false;}
    return value;
  }).catch(()=>({enabled:false}));
  async function openReview() {
    if(busy)return;
    $('#support-dialog').close();form.reset();form.hidden=false;$('#review-success').hidden=true;setStatus('');resetImage();requestId=crypto.randomUUID();
    const current=getPhoto();if(current){image=current.image;$('#review-preview').src=current.url;$('#review-preview').hidden=false;}
    $('#review-file').required=!image;dialog.showModal();track('review_form_opened');
    const value=await settings;$('#review-send').disabled=!value.enabled;
    if(!value.enabled)setStatus('Photo review is temporarily unavailable. Please try again later.',true);
    $('#review-email').focus();
  }
  document.querySelectorAll('[data-review]').forEach(button=>button.addEventListener('click',openReview));
  $('#review-file').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;setStatus('');
    if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>15*1024*1024){setStatus('Choose a JPG, PNG or WebP under 15 MB.',true);event.target.value='';return;}
    const nextUrl=URL.createObjectURL(file), nextImage=new Image();nextImage.src=nextUrl;
    try{
      await nextImage.decode();
      if(nextImage.naturalWidth*nextImage.naturalHeight>16_000_000 || Math.min(nextImage.naturalWidth,nextImage.naturalHeight)<64)throw new Error();
      resetImage();ownedUrl=nextUrl;image=nextImage;requestId=crypto.randomUUID();
      $('#review-preview').src=nextUrl;$('#review-preview').hidden=false;$('#review-file').required=false;
    }catch{URL.revokeObjectURL(nextUrl);event.target.value='';setStatus('Choose a clear photo between 64 pixels across and 16 megapixels.',true);}
  });
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{if(!busy)resetImage();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy || !form.reportValidity())return;
    if(!image){setStatus('Choose the photo you want us to review.',true);return;}
    if(!(await settings).enabled){setStatus('Photo review is temporarily unavailable. Please try again later.',true);return;}
    busy=true;dialog.setAttribute('aria-busy','true');$('#review-send').disabled=true;$('#review-close').disabled=true;setStatus('Sending your photo for review…');
    const fields=new FormData(form), selectedImage=image;
    try {
      const scale=Math.min(1,1600/Math.max(selectedImage.naturalWidth,selectedImage.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.round(selectedImage.naturalWidth*scale);canvas.height=Math.round(selectedImage.naturalHeight*scale);
      const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(selectedImage,0,0,canvas.width,canvas.height);
      const photo=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
      if(!photo || photo.size>4*1024*1024)throw new Error('Choose a smaller photo and try again.');
      fields.delete('review-file');fields.set('photo',photo,'review.jpg');fields.set('requestId',requestId);
      fields.set('reviewPermission',$('#review-permission').checked?'yes':'no');fields.set('trainingPermission',$('#training-permission').checked?'yes':'no');
      fields.set('modelCategory',selectedImage===getPhoto()?.image ? (getResult()?.category || 'not_checked') : 'not_checked');
      const response=await fetch('./api/reviews',{method:'POST',body:fields,signal:AbortSignal.timeout(45000)});
      const result=await response.json();if(!response.ok)throw new Error(result.error || 'Your photo was not submitted. Please try again.');
      $('#review-reference').textContent=result.id;form.hidden=true;$('#review-success').hidden=false;track('review_submitted');resetImage();form.reset();
    }catch(error){setStatus(error.name==='TimeoutError'?'The connection timed out. Try sending again; the same request won’t create a duplicate.':error.message,true);track('review_submission_failed');}
    finally{busy=false;dialog.removeAttribute('aria-busy');$('#review-send').disabled=false;$('#review-close').disabled=false;}
  });
  $('#show-support').addEventListener('click',()=>{$('#support-dialog').showModal();track('support_opened');});
  $('#support-donate').addEventListener('click',()=>track('support_donation_opened'));
}
