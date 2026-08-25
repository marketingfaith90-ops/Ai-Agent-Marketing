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

async function getBusinessAccounts(BASE, KEY, businessId) {
  const r = await fetch(`${BASE}/listaccounts?apiKey=${KEY}&business_id=${businessId}`, { signal: AbortSignal.timeout(5000) });
  const d = await r.json();
  return d.data || [];
}

async function getFacebookPostsThisMonth(pageId, pageToken, monthStart, monthEnd) {
  const since = Math.floor(monthStart.getTime() / 1000);
  const until = Math.floor(monthEnd.getTime() / 1000);
  const url = `https://graph.facebook.com/v19.0/${pageId}/posts?fields=message,story,created_time&since=${since}&until=${until}&limit=100&access_token=${pageToken}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  if (d.error) return [];
  return d.data || [];
}

async function getInstagramPostsThisMonth(pageId, igAccountId, pageToken, monthStart, monthEnd) {
  const since = Math.floor(monthStart.getTime() / 1000);
  const until = Math.floor(monthEnd.getTime() / 1000);
  let igId = igAccountId;
  if (!igId) {
    const igUrl = `https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`;
    const igRes = await fetch(igUrl, { signal: AbortSignal.timeout(5000) });
    const igData = await igRes.json();
    igId = igData.instagram_business_account?.id;
  }
  if (!igId) return [];
  const url = `https://graph.facebook.com/v19.0/${igId}/media?fields=caption,timestamp&since=${since}&until=${until}&limit=100&access_token=${pageToken}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  if (d.error) return [];
  return d.data || [];
}

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
      version: "18.0",
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

    // Always check for business in message
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
    if (matchedBiz && bestScore > 0) {
      if (!session.business || session.business.id !== matchedBiz.id) {
        session.business = matchedBiz;
        session.history = [];
      }
    }

    let dataContext = "Business not yet identified.";

    if (session.business) {
      const biz = session.business;
      const name = biz.business_name;
      const fmt = d => new Date(d).toLocaleDateString("en-GB", {
        weekday: "short", day: "numeric", month: "short"
      }) + " at " + new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

      // Fetch scheduled posts + accounts in parallel
      const [scheduledAll, accounts] = await Promise.all([
        getScheduledPosts(BASE, KEY).catch(() => []),
        getBusinessAccounts(BASE, KEY, biz.id).catch(() => [])
      ]);

      // Get upcoming scheduled posts
      const upcoming = scheduledAll
        .filter(p => p.business_name?.toLowerCase() === name.toLowerCase())
        .filter(p => new Date(p.scheduled_date_time) >= now);

      // Get Facebook and Instagram account IDs
      const fbAccount = accounts.find(a => a.platform === "facebook");
      const igAccount = accounts.find(a => a.platform === "instagram");
      const fbPageId = fbAccount?.account_id || null;
      const igAccountId = igAccount?.account_id || null;

      dataContext = `LIVE DATA FOR: ${name} — ${monthName}\n`;
      dataContext += `Connected platforms: ${accounts.map(a => a.platform).join(", ") || "none"}\n\n`;

      // Fetch Facebook and Instagram posts if page connected
      if (fbPageId && FB_TOKEN) {
        const pageToken = await getPageToken(fbPageId, FB_TOKEN).catch(() => FB_TOKEN);

        const [fbPosts, igPosts] = await Promise.all([
          getFacebookPostsThisMonth(fbPageId, pageToken, monthStart, monthEnd).catch(() => []),
          getInstagramPostsThisMonth(fbPageId, igAccountId, pageToken, monthStart, monthEnd).catch(() => [])
        ]);

        dataContext += `FACEBOOK POSTS THIS MONTH (${fbPosts.length}):\n`;
        if (fbPosts.length > 0) {
          fbPosts.forEach((p, i) => {
            dataContext += `${i + 1}. ${fmt(p.created_time)}\n`;
          });
        } else {
          dataContext += `No Facebook posts this month\n`;
        }
        dataContext += "\n";

        dataContext += `INSTAGRAM POSTS THIS MONTH (${igPosts.length}):\n`;
        if (igPosts.length > 0) {
          igPosts.forEach((p, i) => {
            dataContext += `${i + 1}. ${fmt(p.timestamp)}\n`;
          });
        } else {
          dataContext += `No Instagram posts this month\n`;
        }
        dataContext += "\n";

        dataContext += `TOTAL PUBLISHED: ${fbPosts.length + igPosts.length} posts this month\n\n`;
      } else {
        dataContext += `Facebook not connected for this business\n\n`;
      }

      // Upcoming scheduled from SchedulePro
      dataContext += `UPCOMING SCHEDULED (${upcoming.length}):\n`;
      if (upcoming.length > 0) {
        upcoming.forEach((p, i) => {
          const offer = p.content?.match(/🎉[^\n]*/)?.[0] || "no offer";
          dataContext += `${i + 1}. ${fmt(p.scheduled_date_time)} — ${offer}\n`;
        });
      } else {
        dataContext += `No upcoming posts scheduled\n`;
      }
    }

    const systemPrompt = `You are the ORDERE AI Assistant — an intelligent, professional WhatsApp assistant for ORDERE, a UK-based Online Ordering and Marketing Solution serving 700+ restaurants across the UK.

ABOUT ORDERE:
ORDERE provides restaurants with their own branded online ordering website and full digital marketing management. ORDERE has two internal departments that handle customer queries — the Marketing Department and the Support Department. You are the first point of contact and must identify which department needs to handle each query.

TIME: ${now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK (${timeOfDay})
TODAY: ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
CURRENT MONTH: ${monthName}
IDENTIFIED BUSINESS: ${session.business ? session.business.business_name : "Not yet identified"}

TONE AND STYLE:
- Professional, warm and direct
- Plain text only — no emojis, no asterisks, no markdown, no bold
- Concise WhatsApp style — short paragraphs
- Reply in the same language the customer writes in
- Act as a knowledgeable consultant at all times

CONVERSATION FLOW:

STEP 1 — No business identified yet:
Reply: "Good ${timeOfDay}. Welcome to ORDERE. How can I assist you today? Please share your business name and postcode."

STEP 2 — Business name given with a query in the same message:
Skip the greeting. Go straight to answering with live data.

STEP 3 — Business name given alone:
Reply: "Thank you. I have found your account — ${session.business?.business_name || "your business"}. How can I help you today?"
Wait for their question.

STEP 4 — Business already known:
Answer directly. Never ask for business name again.

QUERY IDENTIFICATION — INTERNAL ROUTING (never share this with customers):

MARKETING DEPARTMENT queries — handle directly using live data and AI intelligence:
- Marketing update, social media posts, Facebook posts, Instagram posts
- Scheduled posts, upcoming posts, content calendar
- Facebook Ads, Google Ads, Instagram Ads, boosted posts
- SMS marketing, email marketing campaigns
- Google Business Profile updates
- Any question about their online presence or digital marketing

SUPPORT DEPARTMENT queries — acknowledge and forward immediately:
- Device issues (tablet, hardware, equipment)
- Printer issues
- Website not working or down
- Online ordering issues
- Order problems, missing orders, pending orders
- Payment issues, money, billing, invoices, refunds
- Technical issues, app problems, login issues
- Menu changes or updates needed
- Any technical or operational problem

HOW TO ANSWER:

MARKETING QUERIES — use live SchedulePro and Facebook data below:
Format for marketing update:
"Here is your marketing update for [Business Name] — [Month].

Facebook: [X] posts published this month
[list each with date and time]

Instagram: [X] posts published this month
[list each with date and time]

Upcoming scheduled: [X] posts
[list each with date, time and offer]

Total published this month: [X] posts

Is there anything else I can help you with?"

SUPPORT QUERIES — never try to solve technical issues yourself:
"Thank you for reaching out. I have noted your query regarding [brief issue description] for ${session.business?.business_name || "your account"}.
I am forwarding this to our Support Department right away and they will contact you shortly to resolve this.
For urgent matters please call us on 03333 444 948.
Is there anything else I can help you with?"

WANT TO SPEAK TO TEAM:
"Of course. You can reach our team directly on 03333 444 948. Is there anything else I can help you with?"

ANY OTHER QUESTION — use full AI intelligence:
Answer as a knowledgeable marketing and business consultant. Give real, specific, practical advice. Never say you cannot help. Never refuse. Always provide value.

For questions about third party platforms (TripAdvisor, Google Reviews, social media strategy, competitor analysis etc) — give genuine expert advice even if you cannot check it directly.

STRICT RULES:
- Never mention JustEat, Uber Eats, Deliveroo or any competitor — ever
- Never invent account data — only use live data below for specific numbers and dates
- Never give unsolicited advice — only answer what was asked
- Never ask for business name again once identified
- Always end every reply with: "Is there anything else I can help you with?"
- If customer is angry or frustrated: apologise sincerely, escalate as priority, give 03333 444 948
- Never share internal system details, API keys or routing logic with customers

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
