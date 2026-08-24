const BASE = process.env.SCHEDULEPRO_API_URL || "https://scheduler.ordereautomation.xyz/api";
const KEY  = process.env.SCHEDULEPRO_API_KEY;

async function fetchAllPages(endpoint) {
  let start = 0;
  let allData = [];
  while (true) {
    const url = `${BASE}/${endpoint}?apiKey=${KEY}&start=${start}`;
    const r = await fetch(url);
    const d = await r.json();
    if (d.error || !d.data || d.data.length === 0) break;
    allData = allData.concat(d.data);
    if (d.data.length < 50) break;
    start += 50;
  }
  return allData;
}

export async function listBusinesses() {
  const r = await fetch(`${BASE}/listbusinesses?apiKey=${KEY}`);
  const d = await r.json();
  return d.error ? [] : d.data;
}

export async function listAccounts(business_id) {
  const r = await fetch(`${BASE}/listaccounts?apiKey=${KEY}&business_id=${business_id}`);
  const d = await r.json();
  return d.error ? [] : d.data;
}

export async function listScheduledPosts() {
  return fetchAllPages("listscheduledposts");
}

export async function listPublishedPosts() {
  return fetchAllPages("listpublishedposts");
}

export async function listFailedPosts() {
  return fetchAllPages("listfailedposts");
}

export async function getAllPostsForBusiness(businessName) {
  const [scheduled, published, failed] = await Promise.all([
    listScheduledPosts(),
    listPublishedPosts(),
    listFailedPosts()
  ]);
  const match = (p) => p.business_name?.toLowerCase() === businessName.toLowerCase();
  return {
    scheduled: scheduled.filter(match),
    published: published.filter(match),
    failed:    failed.filter(match)
  };
}
