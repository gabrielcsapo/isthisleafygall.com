// These are conservative retrieval heuristics, not calibrated disease probabilities.
export function dot(a, b) {
  if (!a || !b || a.length !== b.length) throw new Error('Incompatible image features.');
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}
export function compareEmbedding(embedding, database) {
  if (embedding.length !== 512 || embedding.some(value => !Number.isFinite(value))) throw new Error('Invalid image features.');
  const categories = ['leafy', 'normal', 'crown'].map(category => ({ category, score: Math.max(...database.references.filter(reference => reference.category === category).map(reference => dot(embedding, reference.embedding))) })).sort((a, b) => b.score - a.score);
  const descriptions = database.descriptions.map(description => ({ category: description.category, score: dot(embedding, description.embedding) }));
  const plant = Math.max(...descriptions.filter(item => item.category === 'plant').map(item => item.score));
  const other = Math.max(...descriptions.filter(item => item.category === 'other').map(item => item.score));
  if (other > plant + .025) return { category: 'unclear', reason: 'subject' };
  if (categories[0].score < .72) return { category: 'unclear', reason: 'similarity' };
  if (categories[0].score - categories[1].score < .035) return { category: 'unclear', reason: 'mixed-matches', candidates: categories.slice(0, 2).map(item => item.category) };
  // A single similar specimen can be misleading. Require support from another
  // reference group, unless this is essentially an exact reference-image match.
  if (categories[0].score < .985) {
    const groups = new Set(database.references.filter(reference => reference.category === categories[0].category && dot(embedding, reference.embedding) >= .70).map(reference => reference.group_id || reference.id || reference.file));
    if (groups.size < 2) return { category: 'unclear', reason: 'limited-support' };
  }
  return { category: categories[0].category, reason: 'reference-match' };
}
export const resultCopy = {
  leafy: { title: 'Closest match: leafy gall.', label: 'Worth a closer look', tone: 'amber', description: 'Your photo is visually closest to our leafy gall reference photos. Look for a tightly packed mass of small, distorted shoots at the crown.', action: 'Keep this plant apart and pause sharing tubers or cuttings. A plant diagnostic clinic can advise on confirmation.', image: 'leafy-detail.jpg' },
  normal: { title: 'Closest match: normal growth.', label: 'An encouraging comparison', tone: 'green', description: 'Your photo is visually closest to our normal-growth reference. Distinct shoots developing stems and leaves can be normal—even when there are several.', action: 'Keep watching how the shoots develop. This comparison cannot rule out an infection.', image: 'normal-growth.jpg' },
  crown: { title: 'Closest match: crown gall.', label: 'A different possibility', tone: 'amber', description: 'Your photo is visually closest to our crown gall reference. Look for an irregular, solid swelling rather than a cluster of leafy shoots.', action: 'Avoid sharing or dividing this plant while you investigate. Ask a diagnostic clinic about confirmation.', image: 'crown-gall.jpg' },
  unclear: { title: 'No reliable reference match.', label: 'More evidence needed', tone: 'neutral', description: 'The checker couldn’t reliably match this photo to our references. Even a clear photo may be outside the examples it knows. This result does not establish whether the plant is healthy.', action: 'Compare the guide and another angle of the crown. Watch how the shoots develop; ask a plant diagnostic clinic if growth remains abnormal.', image: null }
};

// Use the same explanation on screen and in copied results. An abstention can
// reflect conflicting references even when the photo itself is clear.
export function getResultCopy(result) {
  const copy = resultCopy[result.category] || resultCopy.unclear;
  if (result.category !== 'unclear') return copy;
  if (result.reason === 'subject') return { ...copy, description: 'The checker couldn’t recognise a useful close-up of a dahlia crown in this photo. Try showing the base of the plant and its shoots.' };
  if (result.reason === 'mixed-matches') {
    const names = { normal: 'normal growth', leafy: 'leafy gall', crown: 'crown gall' };
    const candidates = [...new Set(result.candidates || [])].filter(category => names[category]);
    return { ...copy, title: 'The reference matches are mixed.', label: 'No reliable distinction',
      description: candidates.length === 2 ? `This photo resembles both ${names[candidates[0]]} and ${names[candidates[1]]} references. The checker cannot reliably separate them.` : 'This photo resembles more than one reference category. The checker cannot reliably separate them.',
      action: candidates.includes('normal') && candidates.includes('leafy') ? 'Watch whether shoots develop separate stems and leaves or remain tightly packed and distorted. Compare another angle of the crown, and ask a plant diagnostic clinic if you’re unsure.' : 'Compare another angle of the crown and how the growth develops. A plant diagnostic clinic can advise if the growth remains abnormal.' };
  }
  if (result.reason === 'limited-support') return { ...copy, description: 'One reference group looks similar, but our small reference set does not provide enough supporting examples for a reliable match.', action: 'Compare the visual guide and another angle of the crown. If growth looks abnormal, ask a plant diagnostic clinic.' };
  return copy;
}
