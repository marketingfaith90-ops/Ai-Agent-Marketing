const sessions = new Map();
let spCache = null;
let spCacheTime = null;
const CACHE_TTL = 15 * 60 * 1000;

async function getScheduledPosts(BASE, KEY) {
  if (spCache && spCacheTime && (Date.now() - spCacheTime) < CACHE_TTL) return spCache;
  let start = 0, all = [];
  while (start <= 300) {
    const r = await fetch(`${BASE}/listscheduledposts?apiKey=${KEY}&start=${start}`, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    if (!d.data || d.data.length === 0) break;
    all = all.concat(d.data);
    if (d.data.length < 50) break;
    start += 50;
  }
  spCache = all;
  spCacheTime = Date.now();
  return all;
}

async function findFacebookPage(businessName, userToken) {
  const url = `https://graph.facebook.com/v19.0/me/accounts?limit=200&access_token=${userToken}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  if (!d.data) return null;
  const nameLower = businessName.toLowerCase();
  return d.data.find(p =>
    p.name?.toLowerCase().includes(nameLower) ||
    nameLower.includes(p.name?.toLowerCase())
  ) || null;
}

async function getFacebookPostsThisMonth(pageId, pageToken, monthStart, monthEnd) {
  const since = Math.floor(monthStart.getTime() / 1000);
  const until = Math.floor(monthEnd.getTime() / 1000);
  const url = `https://graph.facebook.com/v19.0/${pageId}/posts?fields=message,story,created_time&since=${since}&until=${until}&limit=100&access_token=${pageToken}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  return d.data || [];
}

async function getInstagramPostsThisMonth(pageId, pageToken, monthStart, monthEnd) {
  const igUrl = `https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`;
  const igRes = await fetch(igUrl, { signal: AbortSignal.timeout(5000) });
  const igData = await igRes.json();
  const igId = igData.instagram_business_account?.id;
  if (!igId) return [];
  const since = Math.floor(monthStart.getTime() / 1000);
  const until = Math.floor(monthEnd.getTime() / 1000);
  const url = `https://graph.facebook.com/v19.0/${igId}/media?fields=caption,timestamp&since=${since}&until=${until}&limit=100&access_token=${pageToken}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  return d.data || [];
}

async function getAdAccount(pageId, pageToken) {
  const url = `https://graph.facebook.com/v19.0/${pageId}?fields=adaccount&access_token=${pageToken}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const d = await r.json();
  return d.adaccount || null;
}

async function getAdCampaigns(adAccountId, pageToken, monthStart) {
  const since = monthStart.toISOString().split("T")[0];
  const until = new Date().toISOString().split("T")[0];
  const url = `https://graph.facebook.com/v19.0/${adAccountId}/campaigns?fields=name,status,objective,insights{reach,impressions,clicks,spend,actions}&time_range={"since":"${since}","until":"${until}"}&access_token=${pageToken}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  return d.data || [];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const KEY = process.env.SCHEDULEPRO_API_KEY;
  const BASE = process.env.SCHEDULEPRO_API_URL || "https://scheduler.ordereautomation.xyz/api";
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const FB_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ORDERE AI Agent Live",
      version: "16.0",
      anthropic_key: ANTHROPIC_KEY ? "SET" : "MISSING",
      schedulepro_key: KEY ? "SET" : "MISSING",
      facebook_token: FB_TOKEN ? "SET" : "MISSING"
    });
  }

  if (req.method !== "POST") return res.status(405).end();

  const { message, sessionId } = req.body || {};
  if (!message) return res.status(400).json({ error: "No message provided" });

  const sid = sessionId || "default";
  if (!sessions.has(sid)) sessions.set(sid, { history: [], business: null });
  const session = sessions.get(sid);

  try {
    const now = new Date();
    const hour = parseInt(now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit" }));
    const timeOfDay = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const monthName = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

    // Detect query type
    const isAdsQuery = /\bad\b|ads|campaign|boost|boosted|paid|sponsor|promoted/i.test(message);
    const isMarketingQuery = /marketing|post|schedule|publish|update|status/i.test(message);
    const isFullUpdate = isMarketingQuery && !isAdsQuery;

    // Find business
    if (!session.business) {
      const bizRes = await fetch(`${BASE}/listbusinesses?apiKey=${KEY}`);
      const bizData = await bizRes.json();
      const businesses = bizData.data || [];
      const msgLower = message.toLowerCase();
      let matchedBiz = null, bestScore = 0;
      for (const biz of businesses) {
        const name = biz.business_name.toLowerCase();
        if (msgLower.includes(name)) { matchedBiz = biz; bestScore = 99; break; }
        const nameWords = name.split(/\s+/).filter(w => w.length > 2);
        const score = nameWords.filter(w => msgLower.split(/\s+/).some(m => m.includes(w) || w.includes(m))).length;
        if (score > bestScore) { bestScore = score; matchedBiz = biz; }
      }
      if (matchedBiz && bestScore > 0) session.business = matchedBiz;
    }

    let dataContext = "Business not yet identified.";

    if (session.business) {
      const biz = session.business;
      const name = biz.business_name;
      const fmt = d => new Date(d).toLocaleDateString("en-GB", {
        weekday: "short", day: "numeric", month: "short"
      }) + " at " + new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

      // Always fetch page + scheduled
      const [scheduledAll, fbPage, accRes] = await Promise.all([
        getScheduledPosts(BASE, KEY).catch(() => []),
        FB_TOKEN ? findFacebookPage(name, FB_TOKEN).catch(() => null) : Promise.resolve(null),
        fetch(`${BASE}/listaccounts?apiKey=${KEY}&business_id=${biz.id}`).then(r => r.json()).catch(() => ({ data: [] }))
      ]);

      const upcoming = scheduledAll
        .filter(p => p.business_name?.toLowerCase() === name.toLowerCase())
        .filter(p => new Date(p.scheduled_date_time) >= now);

      const accounts = accRes.data || [];
      const pageToken = fbPage?.access_token || FB_TOKEN;

      dataContext = `LIVE DATA FOR: ${name} — ${monthName}\n\n`;

      if (fbPage) {
        // Fetch posts + ads based on query type
        if (isAdsQuery) {
          // ADS ONLY
          const adAccount = await getAdAccount(fbPage.id, pageToken).catch(() => null);
          let campaigns = [];
          if (adAccount) {
            campaigns = await getAdCampaigns(adAccount.id, pageToken, monthStart).catch(() => []);
          }

          dataContext += `ADS CAMPAIGNS THIS MONTH (${campaigns.length}):\n`;
          if (campaigns.length > 0) {
            campaigns.forEach((c, i) => {
              const ins = c.insights?.data?.[0] || {};
              const reach = ins.reach ? parseInt(ins.reach).toLocaleString() : "0";
              const views = ins.impressions ? parseInt(ins.impressions).toLocaleString() : "0";
              const clicks = ins.clicks || "0";
              const spend = ins.spend ? `£${parseFloat(ins.spend).toFixed(2)}` : "£0";
              const cpc = ins.clicks && ins.spend
                ? `£${(parseFloat(ins.spend) / parseInt(ins.clicks)).toFixed(2)}`
                : "N/A";
              const engagements = ins.actions?.find(a => a.action_type === "post_engagement")?.value || "0";
              const lpv = ins.actions?.find(a => a.action_type === "landing_page_view")?.value || "0";

              dataContext += `Campaign ${i+1}: ${c.name}\n`;
              dataContext += `Reach: ${reach} people\n`;
              dataContext += `Views: ${views}\n`;
              dataContext += `Link clicks: ${clicks}\n`;
              dataContext += `Post engagements: ${engagements}\n`;
              dataContext += `Landing page views: ${lpv}\n\n`;
            });
          } else {
            dataContext += `No ad campaigns found this month.\n`;
          }

        } else {
          // POSTS + ADS TOGETHER for full marketing update
          const [fbPosts, igPosts, adAccount] = await Promise.all([
            getFacebookPostsThisMonth(fbPage.id, pageToken, monthStart, monthEnd).catch(() => []),
            getInstagramPostsThisMonth(fbPage.id, pageToken, monthStart, monthEnd).catch(() => []),
            getAdAccount(fbPage.id, pageToken).catch(() => null)
          ]);

          let campaigns = [];
          if (adAccount) {
            campaigns = await getAdCampaigns(adAccount.id, pageToken, monthStart).catch(() => []);
          }

          // Facebook posts
          dataContext += `FACEBOOK POSTS THIS MONTH (${fbPosts.length}):\n`;
          if (fbPosts.length > 0) {
            fbPosts.forEach((p, i) => {
              dataContext += `${i+1}. ${fmt(p.created_time)}\n`;
            });
          } else {
            dataContext += `No Facebook posts this month\n`;
          }
          dataContext += "\n";

          // Instagram posts
          dataContext += `INSTAGRAM POSTS THIS MONTH (${igPosts.length}):\n`;
          if (igPosts.length > 0) {
            igPosts.forEach((p, i) => {
              dataContext += `${i+1}. ${fmt(p.timestamp)}\n`;
            });
          } else {
            dataContext += `No Instagram posts this month\n`;
          }
          dataContext += "\n";

          // Ads summary
          if (campaigns.length > 0) {
            dataContext += `ADS CAMPAIGNS THIS MONTH (${campaigns.length}):\n`;
            campaigns.forEach((c, i) => {
              const ins = c.insights?.data?.[0] || {};
              const reach = ins.reach ? parseInt(ins.reach).toLocaleString() : "0";
              const views = ins.impressions ? parseInt(ins.impressions).toLocaleString() : "0";
              const clicks = ins.clicks || "0";
              const spend = ins.spend ? `£${parseFloat(ins.spend).toFixed(2)}` : "£0";
              const cpc = ins.clicks && ins.spend
                ? `£${(parseFloat(ins.spend) / parseInt(ins.clicks)).toFixed(2)}`
                : "N/A";
              const engagements = ins.actions?.find(a => a.action_type === "post_engagement")?.value || "0";
              const lpv = ins.actions?.find(a => a.action_type === "landing_page_view")?.value || "0";

              dataContext += `Campaign ${i+1}: ${c.name}\n`;
              dataContext += `Reach: ${reach} | Views: ${views}\n`;
              dataContext += `Clicks: ${clicks} | Engagements: ${engagements} | Landing page views: ${lpv}\n\n`;
            });
          } else {
            dataContext += `ADS: No campaigns this month\n\n`;
          }

          dataContext += `TOTAL PUBLISHED: ${fbPosts.length + igPosts.length} posts\n`;
        }
      } else {
        dataContext += `Facebook page not found for: ${name}\n\n`;
      }

      // Always add upcoming scheduled
      dataContext += `\nUPCOMING SCHEDULED (${upcoming.length}):\n`;
      if (upcoming.length > 0) {
        upcoming.forEach((p, i) => {
          const offer = p.content?.match(/🎉[^\n]*/)?.[0] || "no offer";
          dataContext += `${i+1}. ${fmt(p.scheduled_date_time)} — ${offer}\n`;
        });
      } else {
        dataContext += `No upcoming posts scheduled\n`;
      }
    }

    const systemPrompt = `You are the ORDERE AI Assistant — a professional WhatsApp assistant and marketing consultant for ORDERE, a UK Online Ordering and Marketing Solution for 700+ restaurants.

TIME: ${now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK (${timeOfDay})
TODAY: ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
CURRENT MONTH: ${monthName}
IDENTIFIED BUSINESS: ${session.business ? session.business.business_name : "Not yet identified"}

TONE: Professional. Direct. Plain text only. No emojis. No asterisks. No markdown. WhatsApp style.

CONVERSATION:
No business yet: "Good ${timeOfDay}. Welcome to ORDERE. How can I assist you today? Please share your business name and postcode."
Business with query: Skip greeting. Answer directly with live data.
Business alone: "Thank you. I have found your account — ${session.business?.business_name || "your business"}. How can I help you today?"
Business already known: Answer directly. Never ask for name again.

FULL MARKETING UPDATE FORMAT:
"Here is your marketing update for [Business Name] — [Month].

Facebook: [X] posts published this month
[list dates only, no captions]

Instagram: [X] posts published this month
[list dates only, no captions]

Ads Campaigns: [X] this month
[For each campaign:]
Campaign: [name]
Reach: [number] people
Views: [number]
Link clicks: [number]
Post engagements: [number]
Landing page views: [number]

Upcoming scheduled: [X] posts
[list dates and offers]

Total published this month: [X] posts

Is there anything else I can help you with?"

ADS ONLY FORMAT:
"Here is your ads update for [Business Name] — [Month].

[X] Ads Campaign(s)

[For each:]
Campaign: [name]
Reach: [number] people
Views: [number]
Link clicks: [number]
Post engagements: [number]
Landing page views: [number]

Is there anything else I can help you with?"

SUPPORT: Forward to support team. Give 03333 444 948.
SPEAK TO TEAM: Give 03333 444 948.
MARKETING ADVICE: Only when asked. Full intelligence.
ANY OTHER QUESTION: Full intelligence. Real value. Never refuse.

RULES:
- No emojis. Plain text only. No asterisks.
- Never mention JustEat, Uber Eats, Deliveroo.
- Never invent data. Only use live data.
- Never give unsolicited advice.
- Never ask for business name again once identified.
- Always end with: "Is there anything else I can help you with?"
- If angry: apologise, escalate, give 03333 444 948.

LIVE DATA:
${dataContext}`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [...session.history, { role: "user", content: message }]
      })
    });

    const claudeData = await claudeRes.json();
    if (claudeData.error) throw new Error(claudeData.error.message);

    const reply = claudeData.content[0].text;
    session.history.push({ role: "user", content: message });
    session.history.push({ role: "assistant", content: reply });
    if (session.history.length > 20) session.history.splice(0, 2);

    return res.status(200).json({ reply, sessionId: sid, business: session.business?.business_name });

  } catch (err) {
    console.error("Error:", err.message);
    return res.status(200).json({
      reply: "I am having a technical issue right now. Please try again or call 03333 444 948.",
      error: err.message
    });
  }
}
