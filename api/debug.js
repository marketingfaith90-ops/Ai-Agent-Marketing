export default async function handler(req, res) {
  const SCHEDULEPRO_KEY = process.env.SCHEDULEPRO_API_KEY;
  const SCHEDULEPRO_URL = process.env.SCHEDULEPRO_API_URL || "https://scheduler.ordereautomation.xyz/api";

  try {
    const url = `${SCHEDULEPRO_URL}/listbusinesses?apiKey=${SCHEDULEPRO_KEY}`;
    const r = await fetch(url);
    const d = await r.json();
    return res.status(200).json({
      key_set: !!SCHEDULEPRO_KEY,
      key_length: SCHEDULEPRO_KEY?.length,
      url_used: url.replace(SCHEDULEPRO_KEY, "***"),
      status: r.status,
      error: d.error,
      business_count: d.data?.length || 0,
      first_3: d.data?.slice(0, 3).map(b => b.business_name) || []
    });
  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
}
