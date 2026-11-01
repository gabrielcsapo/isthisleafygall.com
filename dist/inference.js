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
  if (categories[0].score < .72 || categories[0].score - categories[1].score < .035) return { category: 'unclear', reason: 'similarity' };
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
  unclear: { title: 'We can’t tell from this one.', label: 'No clear visual match', tone: 'neutral', description: 'This photo doesn’t give a clear match to our small reference set. That says nothing certain about whether your plant is healthy.', action: 'Try a sharp, well-lit close-up with the crown centred and visible. If you’re still unsure, ask a plant diagnostic clinic.', image: null }
};
