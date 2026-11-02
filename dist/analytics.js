// Only explicit, content-free usage events reach analytics. Photos, file names,
// pixels, embeddings and error messages never enter this module.
const categories = ['leafy', 'normal', 'crown', 'unclear'];
const schemas = {
  $pageview: {}, photo_selected: {}, inspection_started: {}, inspection_cancelled: {},
  inspection_completed: { category: categories, reason: ['reference-match', 'similarity', 'mixed-matches', 'limited-support', 'subject'] },
  inspection_failed: { stage: ['worker', 'loading', 'preparing'] },
  reference_opened: { category: categories.slice(0, 3) }, guide_shared: {}, reference_submission_opened: {}
};
export function eventProperties(name, properties = {}) {
  if (!Object.hasOwn(schemas, name)) return null;
  return Object.fromEntries(Object.entries(schemas[name]).filter(([key, values]) => values.includes(properties[key])).map(([key]) => [key, properties[key]]));
}
const safeMetadata = new Set(['token', 'distinct_id', '$cookieless_mode', '$process_person_profile', '$is_identified', '$lib', '$lib_version', '$raw_user_agent', '$browser', '$browser_version', '$os', '$os_version', '$device_type', '$screen_height', '$screen_width', '$viewport_height', '$viewport_width', '$host', '$pathname', '$current_url', '$referrer', '$referring_domain']);
export function cleanEvent(event, origin, referrer) {
  const custom = eventProperties(event?.event, event?.properties);
  if (!custom) return null;
  const properties = Object.fromEntries(Object.entries(event.properties || {}).filter(([key]) => safeMetadata.has(key)));
  let referringDomain = '';
  try { referringDomain = new URL(referrer).hostname; } catch {}
  // This is a one-page site. Never send URL queries, fragments or referrer paths.
  Object.assign(properties, custom, { site: 'isthisleafygall.com', $current_url: `${origin}/`, $host: new URL(origin).host, $pathname: '/', $referrer: referringDomain ? `https://${referringDomain}/` : '', $referring_domain: referringDomain, $process_person_profile: false });
  return { event: event.event, properties, ...(event.uuid ? {uuid:event.uuid} : {}), ...(event.timestamp ? {timestamp:event.timestamp} : {}) };
}
export function analyticsOptions(apiHost, origin, referrer) {
  return {
    api_host: apiHost, ui_host: apiHost.startsWith('https://eu.') ? 'https://eu.posthog.com' : 'https://us.posthog.com',
    defaults: '2026-08-30', cookieless_mode: 'always', persistence: 'memory', person_profiles: 'never', respect_dnt: true,
    autocapture: false, capture_pageview: false, capture_pageleave: false, capture_dead_clicks: false,
    rageclick: false, capture_heatmaps: false, capture_exceptions: false, capture_performance: false,
    disable_session_recording: true, disable_surveys: true, disable_web_experiments: true,
    disable_external_dependency_loading: true, advanced_disable_feature_flags: true,
    advanced_disable_feature_flags_on_first_load: true,
    before_send: event => cleanEvent(event, origin, referrer)
  };
}
async function initialize() {
  if (typeof window === 'undefined') return;
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) { console.info('[Usage analytics] Disabled by browser privacy preference.'); return; }
  try {
    const response = await fetch(new URL('./analytics-config.json', import.meta.url), { cache: 'no-store' });
    if (!response.ok) return;
    const config = await response.json();
    if (!config.enabled || !/^phc_[a-zA-Z0-9_]+$/.test(config.projectToken) || !['https://us.i.posthog.com', 'https://eu.i.posthog.com'].includes(config.apiHost)) return;
    const { default: posthog } = await import('./vendor/posthog.js');
    posthog.init(config.projectToken, analyticsOptions(config.apiHost, location.origin, document.referrer));
    console.info('[Usage analytics] Cookieless tracking initialized.');
    return posthog;
  } catch (error) { console.info('[Usage analytics] Unavailable:', error.message); /* Inspection remains available. */ }
}
const ready = initialize();
export function track(name, properties) {
  const safe = eventProperties(name, properties);
  if (!safe) return;
  void ready.then(client => client?.capture(name, safe)).catch(() => {});
}
track('$pageview');
