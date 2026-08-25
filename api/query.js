const sessions = new Map();

// Shared cache across requests
let globalCache = null;
let cacheTime = null;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

async function fetchAllPages(BASE, KEY, endpoint) {
  let start = 0;
  let all = [];
  while (true) {
    const r = await fetch(`${BASE}/${endpoint}?apiKey=${KEY}&start=${start}`, {
      signal: AbortSignal.timeout(5000)
    });
    const d = await r.json();
    if (!d.data || d.data.length === 0) break;
    all = all.concat(d.data);
    if (d.data.length < 50) break;
    start += 50;
    if (start > 2000) break; // safety limit - 2000 posts max
  }
  return all;
}

async function getCache(BASE, KEY) {
  // Return fresh cache if available
  if (globalCache && cacheTime && (Date.now() - cacheTime) < CACHE_TTL) {
    return globalCache;
  }

  // Fetch all 3 endpoints fully - all pages, no limit
  const [scheduled, published, failed] = await Promise.all([
    fetchAllPages(BASE, KEY, "listscheduledposts"),
    fetchAllPages(BASE, KEY, "listpublishedposts"),
    fetchAllPages(BASE, KEY, "listfailedposts")
  ]);

  globalCache = { scheduled, published, failed };
  cacheTime = Date.now();
  console.log(`Cache: ${scheduled.length} scheduled, ${published.length} published, ${failed.length} failed`);
  return globalCache;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const KEY = process.env.SCHEDULEPRO_API_KEY;
  const BASE = process.env.SCHEDULEPRO_API_URL || "https://scheduler.ordereautomation.xyz/api";
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ORDERE AI Agent Live",
      version: "11.0",
      anthropic_key: ANTHROPIC_KEY ? "SET" : "MISSING",
      schedulepro_key: KEY ? "SET" : "MISSING",
      cache: globalCache
        ? `${globalCache.scheduled.length} scheduled, ${globalCache.published.length} published — built ${Math.round((Date.now() - cacheTime) / 1000)}s ago`
        : "empty — will build on first query"
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

    // Find business
    if (!session.business) {
      const bizRes = await fetch(`${BASE}/listbusinesses?apiKey=${KEY}`);
      const bizData = await bizRes.json();
      const businesses = bizData.data || [];
      const msgLower = message.toLowerCase();
      let matchedBiz = null;
      let bestScore = 0;
      for (const biz of businesses) {
        const name = biz.business_name.toLowerCase();
        if (msgLower.includes(name)) { matchedBiz = biz; bestScore = 99; break; }
        const nameWords = name.split(/\s+/).filter(w => w.length > 2);
        const score = nameWords.filter(w => msgLower.split(/\s+/).some(m => m.includes(w) || w.includes(m))).length;
        if (score > bestScore) { bestScore = score; matchedBiz = biz; }
      }
      if (matchedBiz && bestScore > 0) session.business = matchedBiz;
    }

    // Build data context
    let dataContext = "Business not yet identified.";
    if (session.business) {
      const biz = session.business;
      const name = biz.business_name;
      const fmt = d => new Date(d).toLocaleDateString("en-GB", {
        weekday: "short", day: "numeric", month: "short"
      }) + " at " + new Date(d).toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit"
      });

      // Get all posts from cache + accounts in parallel
      const [allPosts, accRes] = await Promise.all([
        getCache(BASE, KEY),
        fetch(`${BASE}/listaccounts?apiKey=${KEY}&business_id=${biz.id}`)
          .then(r => r.json()).catch(() => ({ data: [] }))
      ]);

      const match = arr => arr.filter(p =>
        p.business_name?.toLowerCase() === name.toLowerCase()
      );

      const scheduled = match(allPosts.scheduled);
      const published = match(allPosts.published);
      const failed = match(allPosts.failed);
      const accounts = accRes.data || [];
      const upcoming = scheduled.filter(p => new Date(p.scheduled_date_time) >= now);

      dataContext = `LIVE DATA FOR: ${name}\n`;
      dataContext += `Connected platforms: ${accounts.map(a => a.platform).join(", ") || "none"}\n`;
      dataContext += `Published posts: ${published.length}\n`;
      dataContext += `Upcoming scheduled: ${upcoming.length}\n`;
      dataContext += `Failed posts: ${failed.length}\n\n`;

      if (upcoming.length > 0) {
        dataContext += `UPCOMING POSTS:\n`;
        upcoming.slice(0, 10).forEach((p, i) => {
          const offer = p.content?.match(/🎉[^\n]*/)?.[0] || "no offer";
          dataContext += `${i + 1}. ${fmt(p.scheduled_date_time)} — ${offer}\n`;
        });
        dataContext += "\n";
      }

      if (published.length > 0) {
        dataContext += `PUBLISHED POSTS:\n`;
        published.slice(0, 10).forEach((p, i) => {
          const offer = p.content?.match(/🎉[^\n]*/)?.[0] || "no offer";
          dataContext += `${i + 1}. ${fmt(p.published_at || p.created_at)} — ${offer}\n`;
        });
        dataContext += "\n";
      }

      if (failed.length > 0) {
        dataContext += `FAILED POSTS:\n`;
        failed.forEach((p, i) => {
          dataContext += `${i + 1}. ${fmt(p.created_at)} — ${p.fail_reason || "unknown"}\n`;
        });
      }
    }

    const systemPrompt = `You are the ORDERE AI Assistant — a professional WhatsApp assistant and marketing consultant for ORDERE, a UK Online Ordering and Marketing Solution for 700+ restaurants.

TIME: ${now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK (${timeOfDay})
DATE: ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
IDENTIFIED BUSINESS: ${session.business ? session.business.business_name : "Not yet identified"}

TONE:
- Professional and direct. No emojis. No exclamation marks.
- Plain text only. No asterisks. No markdown.
- Concise. WhatsApp style.
- Reply in same language as customer.

CONVERSATION RULES:

No business yet: "Good ${timeOfDay}. Welcome to ORDERE. How can I assist you today? Please share your business name and postcode."

Business given WITH query in same message: Skip greeting. Answer query directly with live data.

Business given alone: "Thank you. I have found your account — ${session.business?.business_name || "your business"}. How can I help you today?"

Business already known: Answer directly. Never ask for business name again.

HOW TO ANSWER:

MARKETING UPDATE / STATUS:
Use ONLY live data. No advice unless asked.
Format:
"Here is your current marketing status for [Business Name].

Published posts: [X] total
Upcoming scheduled: [X] posts
[List each upcoming: date, time, offer]
[Failed posts if any]

Is there anything else I can help you with?"

MARKETING ADVICE (only when asked): Specific advice for UK restaurants. Reference ORDERE services.

SUPPORT ISSUES: "Understood. I have noted your query regarding [issue] for ${session.business?.business_name || "your account"}. I am forwarding this to our Support Team now and they will contact you shortly. For urgent matters please call 03333 444 948. Is there anything else I can help you with?"

SPEAK TO TEAM: "Of course. You can reach our team directly on 03333 444 948. Is there anything else I can help you with?"

ANY OTHER QUESTION: Use full intelligence. Give real value. Never refuse.

RULES:
- No emojis ever
- Plain text only
- Never mention JustEat, Uber Eats, Deliveroo
- Never invent account data
- Never give unsolicited advice
- Never ask for business name again once identified
- Always end with: "Is there anything else I can help you with?"
- If angry: apologise, escalate, give 03333 444 948

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
        messages: [
          ...session.history,
          { role: "user", content: message }
        ]
      })
    });

    const claudeData = await claudeRes.json();
    if (claudeData.error) throw new Error(claudeData.error.message);

    const reply = claudeData.content[0].text;
    session.history.push({ role: "user", content: message });
    session.history.push({ role: "assistant", content: reply });
    if (session.history.length > 20) session.history.splice(0, 2);

    return res.status(200).json({
      reply,
      sessionId: sid,
      business: session.business?.business_name
    });

  } catch (err) {
    console.error("Error:", err.message);
    return res.status(200).json({
      reply: "I am having a technical issue right now. Please try again or call 03333 444 948.",
      error: err.message
    });
  }
}
