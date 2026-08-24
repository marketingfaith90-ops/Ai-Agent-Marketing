export function findBusiness(query, businessList) {
  const q = query.toLowerCase().trim();

  let m = businessList.find(b => b.business_name.toLowerCase() === q);
  if (m) return m;

  m = businessList.find(b => b.business_name.toLowerCase().includes(q));
  if (m) return m;

  m = businessList.find(b => q.includes(b.business_name.toLowerCase()));
  if (m) return m;

  const qWords = q.split(/\s+/).filter(w => w.length > 2);
  let best = 0, bestMatch = null;
  for (const biz of businessList) {
    const bWords = biz.business_name.toLowerCase().split(/\s+/);
    const score = qWords.filter(w => bWords.some(b => b.includes(w) || w.includes(b))).length;
    if (score > best) { best = score; bestMatch = biz; }
  }
  return best > 0 ? bestMatch : null;
}
