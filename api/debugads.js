export default async function handler(req, res) {
  const FB_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;
  const KEY = process.env.SCHEDULEPRO_API_KEY;
  const BASE = "https://scheduler.ordereautomation.xyz/api";

  try {
    const bizRes = await fetch(`${BASE}/listbusinesses?apiKey=${KEY}`);
    const bizData = await bizRes.json();
    const kadir = bizData.data?.find(b => b.business_name.toLowerCase().includes("kadir"));
    if (!kadir) return res.status(200).json({ error: "Kadir not found" });

    const accRes = await fetch(`${BASE}/listaccounts?apiKey=${KEY}&business_id=${kadir.id}`);
    const accData = await accRes.json();
    const fbAcc = accData.data?.find(a => a.platform === "facebook");
    const pageId = fbAcc?.account_id;
    if (!pageId) return res.status(200).json({ error: "No FB page", accounts: accData.data });

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const since = monthStart.toISOString().split("T")[0];
    const until = new Date().toISOString().split("T")[0];
    const sinceTs = Math.floor(monthStart.getTime() / 1000);

    const ptRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=access_token,name,adaccount&access_token=${FB_TOKEN}`);
    const ptData = await ptRes.json();
    const pageToken = ptData.access_token || FB_TOKEN;

    const [promoRes, insRes, adRes] = await Promise.all([
      fetch(`https://graph.facebook.com/v19.0/${pageId}/promotable_posts?fields=message,created_time,is_published,story&since=${sinceTs}&limit=10&access_token=${pageToken}`).then(r=>r.json()),
      fetch(`https://graph.facebook.com/v19.0/${pageId}/insights?metric=page_post_engagements,page_impressions&since=${since}&until=${until}&access_token=${pageToken}`).then(r=>r.json()),
      ptData.adaccount ? fetch(`https://graph.facebook.com/v19.0/${ptData.adaccount.id}/ads?fields=name,status,insights{reach,impressions,clicks}&access_token=${pageToken}`).then(r=>r.json()) : Promise.resolve({data:[]})
    ]);

    return res.status(200).json({
      business: kadir.business_name,
      page_id: pageId,
      page_name: ptData.name,
      has_page_token: !!ptData.access_token,
      ad_account: ptData.adaccount || null,
      promotable_posts_count: promoRes.data?.length || 0,
      promotable_posts: promoRes.data?.slice(0,3) || [],
      promotable_error: promoRes.error || null,
      ads: adRes.data || [],
      ads_error: adRes.error || null,
      page_insights: insRes.data?.slice(0,2) || [],
      insights_error: insRes.error || null
    });
  } catch(err) {
    return res.status(200).json({ error: err.message });
  }
}
