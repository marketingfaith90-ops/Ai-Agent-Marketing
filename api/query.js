const sessions = new Map();
let bizCache = null;
let bizCacheTime = null;
const CACHE_TTL = 15 * 60 * 1000;

const BASE = "https://scheduler.ordereautomation.xyz/api";

async function getBusinesses(KEY) {
  if (bizCache && bizCacheTime && (Date.now() - bizCacheTime) < CACHE_TTL) return bizCache;
  const r = await fetch(`${BASE}/listbusinesses?apiKey=${KEY}`);
  const d = await r.json();
  bizCache = d.data || [];
  bizCacheTime = Date.now();
  return bizCache;
}

async function getPublishedPosts(KEY, businessId, monthStart, monthEnd) {
  // Fetch with business_id filter - works perfectly as confirmed
  let start = 0, all = [];
  while (true) {
    const r = await fetch(`${BASE}/listpublishedposts?apiKey=${KEY}&business_id=${businessId}&start=${start}`, {
      signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    if (d.error || !d.data || d.data.length === 0) break;
    // Filter to current month only
    const monthPosts = d.data.filter(p => {
      const date = new Date(p.published_at || p.created_at);
      return date >= monthStart && date <= monthEnd;
    });
    all = all.concat(monthPosts);
    if (d.data.length < 50) break;
    start += 50;
  }
  return all;
}

async function getScheduledPosts(KEY, businessId) {
  const now = new Date();
  let start = 0, all = [];
  while (start <= 200) {
    const r = await fetch(`${BASE}/listscheduledposts?apiKey=${KEY}&start=${start}`, {
      signal: AbortSignal.timeout(5000)
    });
    const d = await r.json();
    if (d.error || !d.data || d.data.length === 0) break;
    // Filter by business name since scheduled doesn't have business_id filter yet
    const upcoming = d.data.filter(p => {
      return p.business_name?.toLowerCase() === all._bizName?.toLowerCase() &&
             new Date(p.scheduled_date_time) >= now;
    });
    all = all.concat(upcoming);
    if (d.data.length < 50) break;
    start += 50;
  }
  return all;
}

function extractPlatforms(platformPostIds) {
  if (!platformPostIds) return { facebook: 0, instagram: 0 };
  const keys = Object.keys(platformPostIds);
  return {
    facebook: keys.filter(k => k.startsWith("facebook_")).length,
    instagram: keys.filter(k => k.startsWith("instagram_")).length
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const KEY = process.env.SCHEDULEPRO_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ORDERE AI Agent Live",
      version: "19.0 - SchedulePro only",
      anthropic_key: ANTHROPIC_KEY ? "SET" : "MISSING",
      schedulepro_key: KEY ? "SET" : "MISSING"
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

    // Find business in message
    const businesses = await getBusinesses(KEY);
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

      // Fetch published posts with business_id filter + scheduled posts in parallel
      const [publishedPosts, allScheduled] = await Promise.all([
        getPublishedPosts(KEY, biz.id, monthStart, monthEnd),
        fetch(`${BASE}/listscheduledposts?apiKey=${KEY}&start=0`, { signal: AbortSignal.timeout(5000) })
          .then(r => r.json()).then(d => d.data || []).catch(() => [])
      ]);

      // Filter scheduled by business name and upcoming
      const upcoming = allScheduled
        .filter(p => p.business_name?.toLowerCase() === name.toLowerCase())
        .filter(p => new Date(p.scheduled_date_time) >= now);

      // Count platforms from published posts
      let fbCount = 0, igCount = 0;
      const fbPosts = [], igPosts = [];

      publishedPosts.forEach(p => {
        const platforms = extractPlatforms(p.platform_post_ids);
        const date = fmt(p.published_at || p.created_at);
        const offer = p.content?.match(/🎉[^\n]*/)?.[0] || null;
        if (platforms.facebook > 0) {
          fbCount++;
          fbPosts.push({ date, offer });
        }
        if (platforms.instagram > 0) {
          igCount++;
          igPosts.push({ date, offer });
        }
        // If no specific platform found, count as facebook
        if (platforms.facebook === 0 && platforms.instagram === 0) {
          fbCount++;
          fbPosts.push({ date, offer });
        }
      });

      dataContext = `LIVE DATA FOR: ${name} — ${monthName}\n\n`;

      dataContext += `FACEBOOK POSTS THIS MONTH (${fbCount}):\n`;
      if (fbPosts.length > 0) {
        fbPosts.forEach((p, i) => {
          dataContext += `${i+1}. ${p.date}\n`;
          if (p.offer) dataContext += `   ${p.offer}\n`;
        });
      } else {
        dataContext += `No Facebook posts this month\n`;
      }
      dataContext += "\n";

      dataContext += `INSTAGRAM POSTS THIS MONTH (${igCount}):\n`;
      if (igPosts.length > 0) {
        igPosts.forEach((p, i) => {
          dataContext += `${i+1}. ${p.date}\n`;
        });
      } else {
        dataContext += `No Instagram posts this month\n`;
      }
      dataContext += "\n";

      dataContext += `TOTAL PUBLISHED: ${publishedPosts.length} posts this month\n\n`;

      dataContext += `UPCOMING SCHEDULED (${upcoming.length}):\n`;
      if (upcoming.length > 0) {
        upcoming.forEach((p, i) => {
          const offer = p.content?.match(/🎉[^\n]*/)?.[0] || "no offer";
          dataContext += `${i+1}. ${fmt(p.scheduled_date_time)} — ${offer}\n`;
        });
      } else {
        dataContext += `No upcoming posts scheduled\n`;
      }
    }

    const systemPrompt = `You are the ORDERE AI Assistant — an intelligent, professional WhatsApp assistant for ORDERE, a UK-based Online Ordering and Marketing Solution serving 700+ restaurants across the UK.

ABOUT ORDERE:
ORDERE provides restaurants with their own branded online ordering website and full digital marketing management. ORDERE has two internal departments — Marketing Department and Support Department. You are the first point of contact and must identify which department handles each query.

TIME: ${now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK (${timeOfDay})
TODAY: ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
CURRENT MONTH: ${monthName}
IDENTIFIED BUSINESS: ${session.business ? session.business.business_name : "Not yet identified"}

TONE: Professional, warm and direct. Plain text only. No emojis. No asterisks. No markdown. WhatsApp style.

CONVERSATION FLOW:

No business yet: "Good ${timeOfDay}. Welcome to ORDERE. How can I assist you today? Please share your business name and postcode."

Business given WITH query: Skip greeting. Answer directly with live data.

Business given alone: "Thank you. I have found your account — ${session.business?.business_name || "your business"}. How can I help you today?"

Business already known: Answer directly. Never ask for name again.

QUERY TYPES — INTERNAL ROUTING (never share with customers):

MARKETING DEPARTMENT — handle with live data and AI intelligence:
Marketing update, social media posts, Facebook, Instagram, Google Business Profile, scheduled posts, upcoming posts, content, SMS marketing, email marketing, Google Ads, Facebook Ads, boosted posts, online presence, digital marketing

SUPPORT DEPARTMENT — acknowledge and forward:
Device issues, printer, website down, online ordering issues, missing orders, pending orders, payment, billing, money, invoices, refunds, technical issues, app problems, login, menu changes, any operational problem

HOW TO ANSWER:

MARKETING UPDATE — use live data only, no unsolicited advice:
"Here is your marketing update for [Business Name] — [Month].

Facebook: [X] posts published this month
[list each with date and time]

Instagram: [X] posts published this month
[list each with date and time]

Upcoming scheduled: [X] posts
[list each with date, time and offer]

Total published this month: [X] posts

Is there anything else I can help you with?"

SUPPORT QUERY:
"Thank you for reaching out. I have noted your query regarding [brief issue] for ${session.business?.business_name || "your account"}.
I am forwarding this to our Support Department right away and they will contact you shortly.
For urgent matters please call 03333 444 948.
Is there anything else I can help you with?"

SPEAK TO TEAM: "Of course. You can reach our team on 03333 444 948. Is there anything else I can help you with?"

ANY OTHER QUESTION: Use full AI intelligence as a marketing and business consultant. Give real, specific, practical advice. Never refuse. Never say you cannot help.

RULES:
- No emojis. Plain text only. No asterisks.
- Never mention JustEat, Uber Eats, Deliveroo or any competitor.
- Never invent data — only use live data for numbers and dates.
- Never give unsolicited advice.
- Never ask for business name again once identified.
- Always end with: "Is there anything else I can help you with?"
- If angry: apologise sincerely, escalate, give 03333 444 948.

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
