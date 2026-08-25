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

// Get accounts for business - returns facebook page ID, instagram ID etc
async function getBusinessAccounts(BASE, KEY, businessId) {
  const r = await fetch(`${BASE}/listaccounts?apiKey=${KEY}&business_id=${businessId}`, { signal: AbortSignal.timeout(5000) });
  const d = await r.json();
  return d.data || [];
}

// Facebook posts this month using page ID directly
async function getFacebookPostsThisMonth(pageId, pageToken, monthStart, monthEnd) {
  const since = Math.floor(monthStart.getTime() / 1000);
  const until = Math.floor(monthEnd.getTime() / 1000);
  const url = `https://graph.facebook.com/v19.0/${pageId}/posts?fields=message,story,created_time&since=${since}&until=${until}&limit=100&access_token=${pageToken}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  if (d.error) {
    console.log("FB posts error:", d.error.message);
    return [];
  }
  return d.data || [];
}

// Instagram posts this month using Instagram account ID directly
async function getInstagramPostsThisMonth(igAccountId, pageToken, monthStart, monthEnd) {
  const since = Math.floor(monthStart.getTime() / 1000);
  const until = Math.floor(monthEnd.getTime() / 1000);
  const url = `https://graph.facebook.com/v19.0/${igAccountId}/media?fields=caption,timestamp&since=${since}&until=${until}&limit=100&access_token=${pageToken}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  if (d.error) {
    console.log("IG posts error:", d.error.message);
    return [];
  }
  return d.data || [];
}

// Get ad account from Facebook page
async function getAdAccount(pageId, pageToken) {
  const url = `https://graph.facebook.com/v19.0/${pageId}?fields=adaccount&access_token=${pageToken}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const d = await r.json();
  return d.adaccount || null;
}

// Get campaigns AND boosted posts for a page
async function getAdsData(pageId, adAccountId, pageToken, monthStart) {
  const since = monthStart.toISOString().split("T")[0];
  const until = new Date().toISOString().split("T")[0];
  const sinceTs = Math.floor(monthStart.getTime() / 1000);
  const untilTs = Math.floor(new Date().getTime() / 1000);

  const results = { campaigns: [], boosted: [] };

  // 1. Get campaigns from ad account
  if (adAccountId) {
    const url = `https://graph.facebook.com/v19.0/${adAccountId}/campaigns?fields=name,status,insights{reach,impressions,clicks,actions}&time_range={"since":"${since}","until":"${until}"}&access_token=${pageToken}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    if (!d.error) results.campaigns = d.data || [];
  }

  // 2. Get boosted posts directly from page
  const boostedUrl = `https://graph.facebook.com/v19.0/${pageId}/promotable_posts?fields=message,created_time,story,is_published&since=${sinceTs}&until=${untilTs}&limit=20&access_token=${pageToken}`;
  const boostedRes = await fetch(boostedUrl, { signal: AbortSignal.timeout(8000) });
  const boostedData = await boostedRes.json();
  if (!boostedData.error) {
    // Get insights for each boosted post
    const posts = boostedData.data || [];
    for (const post of posts.slice(0, 5)) {
      const insUrl = `https://graph.facebook.com/v19.0/${post.id}/insights?metric=post_impressions,post_reach,post_clicks&access_token=${pageToken}`;
      const insRes = await fetch(insUrl, { signal: AbortSignal.timeout(5000) });
      const insData = await insRes.json();
      if (!insData.error && insData.data) {
        const metrics = {};
        insData.data.forEach(m => { metrics[m.name] = m.values?.[0]?.value || 0; });
        if (metrics.post_reach > 0) {
          results.boosted.push({
            name: post.message?.substring(0, 50) || post.story || "Boosted post",
            reach: metrics.post_reach,
            views: metrics.post_impressions,
            clicks: metrics.post_clicks,
            created_time: post.created_time
          });
        }
      }
    }
  }

  return results;
}

// Get boosted posts directly from Facebook page
async function getBoostedPosts(pageId, pageToken, monthStart) {
  const since = Math.floor(monthStart.getTime() / 1000);
  const until = Math.floor(new Date().getTime() / 1000);
  // Get posts with promotion status
  const url = `https://graph.facebook.com/v19.0/${pageId}/posts?fields=message,created_time,promotable_id,insights{views,reach,impressions}&since=${since}&until=${until}&limit=50&access_token=${pageToken}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  if (d.error) return [];
  
  // Also check ads on the page directly
  const adsUrl = `https://graph.facebook.com/v19.0/${pageId}/ads?fields=name,status,insights{reach,impressions,clicks,actions}&access_token=${pageToken}`;
  const adsRes = await fetch(adsUrl, { signal: AbortSignal.timeout(8000) });
  const adsData = await adsRes.json();
  
  return {
    posts: d.data || [],
    ads: adsData.data || []
  };
}

// Get page access token from page ID
async function getPageToken(pageId, userToken) {
  const url = `https://graph.facebook.com/v19.0/${pageId}?fields=access_token&access_token=${userToken}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const d = await r.json();
  return d.access_token || userToken;
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
      version: "17.0",
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

    const isAdsQuery = /\bad\b|ads|campaign|boost|boosted|paid|sponsor|promoted/i.test(message);

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

      // Get accounts + scheduled posts in parallel
      const [scheduledAll, accounts] = await Promise.all([
        getScheduledPosts(BASE, KEY).catch(() => []),
        getBusinessAccounts(BASE, KEY, biz.id).catch(() => [])
      ]);

      // Extract platform IDs from accounts
      const fbAccount = accounts.find(a => a.platform === "facebook");
      const igAccount = accounts.find(a => a.platform === "instagram");
      const fbPageId = fbAccount?.account_id || null;
      const igAccountId = igAccount?.account_id || null;

      // Upcoming scheduled posts
      const upcoming = scheduledAll
        .filter(p => p.business_name?.toLowerCase() === name.toLowerCase())
        .filter(p => new Date(p.scheduled_date_time) >= now);

      dataContext = `LIVE DATA FOR: ${name} — ${monthName}\n`;
      dataContext += `Connected platforms: ${accounts.map(a => a.platform).join(", ") || "none"}\n`;
      dataContext += `Facebook page ID: ${fbPageId || "not connected"}\n\n`;

      if (fbPageId && FB_TOKEN) {
        // Get page-specific access token
        const pageToken = await getPageToken(fbPageId, FB_TOKEN).catch(() => FB_TOKEN);

        if (isAdsQuery) {
          // ADS ONLY
          const adAccount = await getAdAccount(fbPageId, pageToken).catch(() => null);
          const adsData = await getAdsData(fbPageId, adAccount?.id, pageToken, monthStart).catch(() => ({ campaigns: [], boosted: [] }));
          const allAds = [...adsData.campaigns, ...adsData.boosted];

          dataContext += `ADS THIS MONTH (${allAds.length} total):\n`;
          if (adsData.campaigns.length > 0) {
            adsData.campaigns.forEach((c, i) => {
              const ins = c.insights?.data?.[0] || {};
              const reach = ins.reach ? parseInt(ins.reach).toLocaleString() : "0";
              const views = ins.impressions ? parseInt(ins.impressions).toLocaleString() : "0";
              const clicks = ins.clicks || "0";
              const engagements = ins.actions?.find(a => a.action_type === "post_engagement")?.value || "0";
              const lpv = ins.actions?.find(a => a.action_type === "landing_page_view")?.value || "0";
              dataContext += `Campaign ${i+1}: ${c.name}\n`;
              dataContext += `Reach: ${reach} people | Views: ${views} | Link clicks: ${clicks}\n`;
              dataContext += `Post engagements: ${engagements} | Landing page views: ${lpv}\n\n`;
            });
          }
          if (adsData.boosted.length > 0) {
            adsData.boosted.forEach((b, i) => {
              dataContext += `Boosted post ${i+1}: ${b.name}\n`;
              dataContext += `Reach: ${parseInt(b.reach).toLocaleString()} people | Views: ${parseInt(b.views).toLocaleString()} | Clicks: ${b.clicks}\n\n`;
            });
          }
          if (allAds.length === 0) {
            dataContext += `No ads or boosted posts found this month.\n`;
          }

        } else {
          // POSTS + ADS for full marketing update
          const [fbPosts, adAccount] = await Promise.all([
            getFacebookPostsThisMonth(fbPageId, pageToken, monthStart, monthEnd).catch(() => []),
            getAdAccount(fbPageId, pageToken).catch(() => null)
          ]);
          const adsData = await getAdsData(fbPageId, adAccount?.id, pageToken, monthStart).catch(() => ({ campaigns: [], boosted: [] }));

          // Instagram - use account ID if available, otherwise get from page
          let igPosts = [];
          if (igAccountId) {
            igPosts = await getInstagramPostsThisMonth(igAccountId, pageToken, monthStart, monthEnd).catch(() => []);
          } else {
            // Try to get Instagram from page
            const igUrl = `https://graph.facebook.com/v19.0/${fbPageId}?fields=instagram_business_account&access_token=${pageToken}`;
            const igRes = await fetch(igUrl).then(r => r.json()).catch(() => ({}));
            const igId = igRes.instagram_business_account?.id;
            if (igId) {
              igPosts = await getInstagramPostsThisMonth(igId, pageToken, monthStart, monthEnd).catch(() => []);
            }
          }

          const campaigns = [...(adsData?.campaigns || []), ...(adsData?.boosted || [])];

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

          // Ads
          if (adsData.campaigns.length > 0 || adsData.boosted.length > 0) {
            const totalAds = adsData.campaigns.length + adsData.boosted.length;
            dataContext += `ADS THIS MONTH (${totalAds}):\n`;
            adsData.campaigns.forEach((c, i) => {
              const ins = c.insights?.data?.[0] || {};
              const reach = ins.reach ? parseInt(ins.reach).toLocaleString() : "0";
              const views = ins.impressions ? parseInt(ins.impressions).toLocaleString() : "0";
              const clicks = ins.clicks || "0";
              const engagements = ins.actions?.find(a => a.action_type === "post_engagement")?.value || "0";
              const lpv = ins.actions?.find(a => a.action_type === "landing_page_view")?.value || "0";
              dataContext += `Campaign: ${c.name} | Reach: ${reach} | Views: ${views} | Clicks: ${clicks} | Engagements: ${engagements} | Landing page views: ${lpv}\n`;
            });
            adsData.boosted.forEach((b, i) => {
              dataContext += `Boosted post: ${b.name} | Reach: ${parseInt(b.reach).toLocaleString()} | Views: ${parseInt(b.views).toLocaleString()} | Clicks: ${b.clicks}\n`;
            });
            dataContext += "\n";
          } else {
            dataContext += `No ads this month\n\n`;
          }

          dataContext += `TOTAL PUBLISHED: ${fbPosts.length + igPosts.length} posts\n`;
        }
      } else {
        dataContext += `No Facebook account connected in SchedulePro for this business.\n\n`;
      }

      // Always add upcoming
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
[list each with date and time]

Instagram: [X] posts published this month
[list each with date and time]

Ads: [X] this month
[For each campaign or boosted post:]
Campaign/Boost: [name]
Reach: [number] people
Views: [number]
Link clicks: [number]
Post engagements: [number]
Landing page views: [number]

Upcoming scheduled: [X] posts
[list each with date, time and offer]

Total published this month: [X] posts

Is there anything else I can help you with?"

ADS ONLY FORMAT:
"Here is your ads update for [Business Name] — [Month].

[X] active ad(s) this month

[For each campaign:]
Campaign: [name]
Reach: [number] people
Views: [number]
Link clicks: [number]
Post engagements: [number]
Landing page views: [number]

[For each boosted post:]
Boosted post: [description]
Reach: [number] people
Views: [number]
Clicks: [number]

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
// This is appended - see full file
