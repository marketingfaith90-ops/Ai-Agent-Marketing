export default async function handler(req, res) {
  const FB_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;
  
  try {
    // Try multiple endpoints to find all accessible pages
    const [accountsRes, businessRes] = await Promise.all([
      fetch(`https://graph.facebook.com/v19.0/me/accounts?limit=200&fields=name,id,category&access_token=${FB_TOKEN}`).then(r => r.json()),
      fetch(`https://graph.facebook.com/v19.0/me?fields=name,id,businesses&access_token=${FB_TOKEN}`).then(r => r.json())
    ]);

    const pages = (accountsRes.data || []).map(p => p.name);
    const yasminPages = (accountsRes.data || []).filter(p => 
      p.name?.toLowerCase().includes("yasmin")
    );
    const starPages = (accountsRes.data || []).filter(p => 
      p.name?.toLowerCase().includes("star anise")
    );

    return res.status(200).json({
      token_owner: businessRes.name,
      total_pages_accessible: pages.length,
      yasmin_pages: yasminPages.map(p => ({ name: p.name, id: p.id })),
      star_anise_pages: starPages.map(p => ({ name: p.name, id: p.id })),
      businesses: businessRes.businesses?.data?.map(b => ({ name: b.name, id: b.id })) || [],
      first_10_pages: pages.slice(0, 10),
      error_accounts: accountsRes.error || null
    });

  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
}
