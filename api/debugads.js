export default async function handler(req, res) {
  const FB_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;
  const KEY = process.env.SCHEDULEPRO_API_KEY;
  const BASE = process.env.SCHEDULEPRO_API_URL || "https://scheduler.ordereautomation.xyz/api";

  try {
    // Get Kadir's Kitchen business ID
    const bizRes = await fetch(`${BASE}/listbusinesses?apiKey=${KEY}`);
    const bizData = await bizRes.json();
    const kadir = bizData.data?.find(b => b.business_name.toLowerCase().includes("kadir"));

    if (!kadir) return res.status(200).json({ error: "Kadir not found" });

    // Get accounts
    const accRes = await fetch(`${BASE}/listaccounts?apiKey=${KEY}&business_id=${kadir.id}`);
    const accData = await accRes.json();
    const fbAccount = accData.data?.find(a => a.platform === "facebook");
    const pageId = fbAccount?.account_id;

    if (!pageId) return res.status(200).json({ error: "No Facebook page found", accounts: accData.data });

    // Get page token
    const ptRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=access_token,name,adaccount&access_token=${FB_TOKEN}`);
    const ptData = await ptRes.json();
    const pageToken = ptData.access_token || FB_TOKEN;

    // Try to get ad account
    const adAccount = ptData.adaccount;

    // Try promotable posts
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const since = Math.floor(monthStart.getTime() / 1000);
    const until = Math.floor(new Date().getTime() / 1000);

    const [promoRes, adsRes] = await Promise.all([
      fetch(`https://graph.facebook.com/v19.0/${pageId}/promotable_posts?fields=message,created_time,is_published&since=${since}&limit=10&access_token=${pageToken}`).then(r => r.json()),
      adAccount ? fetch(`https://graph.facebook.com/v19.0/${adAccount.id}/campaigns?fields=name,status,insights{reach,impressions,clicks}&access_token=${pageToken}`).then(r => r.json()) : Promise.resolve({ data: [] })
    ]);

    return res.status(200).json({
      business: kadir.business_name,
      page_id: pageId,
      page_name: ptData.name,
      page_token_received: !!ptData.access_token,
      ad_account: adAccount || "none",
      promotable_posts: promoRes,
      campaigns: adsRes
    });

  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
}
