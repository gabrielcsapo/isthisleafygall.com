import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { eventProperties, cleanEvent, analyticsOptions } from '../dist/analytics.js';

test('analytics accepts only known events and coarse outcome enums', () => {
  assert.equal(eventProperties('arbitrary_event', {photo:'data:image/jpeg'}), null);
  assert.deepEqual(eventProperties('photo_selected', {name:'private.jpg', pixels:[1,2], image:'secret'}), {});
  assert.deepEqual(eventProperties('inspection_completed', {category:'unclear', reason:'mixed-matches', embedding:[1,2], filename:'private.jpg'}), {category:'unclear',reason:'mixed-matches'});
  assert.deepEqual(eventProperties('inspection_completed', {category:'private content', reason:'user input'}), {});
});
test('SDK metadata never includes URL queries, referrer paths, file content or exception text', () => {
  const input = {event:'inspection_completed',properties:{category:'leafy',reason:'reference-match',filename:'private.jpg',message:'sensitive',photo:'data:image/jpeg', $current_url:'https://example.com/?email=private', $initial_referrer:'https://source.test/private?token=secret', $browser:'Safari', $raw_user_agent:'Browser test agent', $cookieless_mode:true, distinct_id:'$posthog_cookieless',token:'phc_public'}};
  const output = cleanEvent(input,'https://isthisleafygall.com','https://facebook.com/groups/private?token=secret');
  assert.equal(output.properties.$referrer, 'https://facebook.com/');
  assert.equal(output.properties.$current_url,'https://isthisleafygall.com/');
  assert.equal(output.properties.$cookieless_mode,true);
  assert.equal(output.properties.$raw_user_agent,'Browser test agent');
  assert.equal(output.properties.$process_person_profile,false);
  assert.doesNotMatch(JSON.stringify(output), /private|secret|sensitive|image\/jpeg/);
  assert.equal(cleanEvent({event:'$snapshot',properties:{}},'https://example.com',''),null);
});
test('analytics recording and automatic content collection remain disabled', () => {
  const config = analyticsOptions('https://us.i.posthog.com','https://isthisleafygall.com','');
  assert.equal(config.cookieless_mode,'always');
  assert.equal(config.person_profiles,'never');
  assert.equal(config.persistence,'memory');
  assert.equal(config.disable_session_recording,true);
  assert.equal(config.disable_external_dependency_loading,true);
  assert.equal(config.autocapture,false);
  assert.equal(config.capture_exceptions,false);
});
test('runtime configuration exposes only a public project token and rejects private tokens', async t => {
  for (const projectToken of ['phc_public_test','phx_private_test']) {
    const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',POSTHOG_PROJECT_TOKEN:projectToken,POSTHOG_API_HOST:'https://us.i.posthog.com',POSTHOG_PERSONAL_API_KEY:'phx_never_expose'}});
    t.after(()=>child.kill());
    const port=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Server did not start')),5000);
      child.once('error',reject);child.stdout.on('data',data=>{const match=String(data).match(/port (\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
    });
    const response=await fetch(`http://127.0.0.1:${port}/analytics-config.json`);
    const config=await response.json();
    assert.equal(response.headers.get('cache-control'),'no-store');
    if(projectToken.startsWith('phc_')) assert.deepEqual(config,{enabled:true,projectToken,apiHost:'https://us.i.posthog.com'});
    else assert.deepEqual(config,{enabled:false});
    assert.doesNotMatch(JSON.stringify(config),/phx_/);
    child.kill();
  }
});
