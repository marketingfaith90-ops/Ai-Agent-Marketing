export default async function handler(req, res) {
  const FB_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;
  try {
    // Check what ad accounts are accessible with this token
    const [meRes, adAccountsRes] = await Promise.all([
      fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${FB_TOKEN}`).then(r=>r.json()),
      fetch(`https://graph.facebook.com/v19.0/me/adaccounts?fields=name,account_id,account_status&limit=20&access_token=${FB_TOKEN}`).then(r=>r.json())
    ]);

    return res.status(200).json({
      me: meRes,
      ad_accounts: adAccountsRes.data || [],
      ad_accounts_error: adAccountsRes.error || null
    });
  } catch(err) {
    return res.status(200).json({ error: err.message });
  }
}
