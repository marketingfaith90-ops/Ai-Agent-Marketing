const sessions = new Map();
const BASE = "https://scheduler.ordereautomation.xyz/api";

async function getPublishedThisMonth(KEY, businessId, monthStart, monthEnd) {
  let start = 0, all = [];
  while (true) {
    const url = `${BASE}/listpublishedposts?apiKey=${KEY}&business_id=${businessId}&start=${start}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    if (d.error || !d.data || d.data.length === 0) break;
    const filtered = d.data.filter(p => {
      const date = new Date(p.published_at || p.created_at);
      return date >= monthStart && date <= monthEnd;
    });
    all = all.concat(filtered);
    // Stop if we've gone past this month (posts are newest first)
    const oldest = d.data[d.data.length - 1];
    const oldestDate = new Date(oldest.published_at || oldest.created_at);
    if (oldestDate < monthStart) break;
    if (d.data.length < 50) break;
    start += 50;
  }
  return all;
}

async function getUpcomingScheduled(KEY, businessName) {
  const now = new Date();
  let start = 0, all = [];
  while (start <= 150) {
    const r = await fetch(`${BASE}/listscheduledposts?apiKey=${KEY}&start=${start}`, {
      signal: AbortSignal.timeout(5000)
    });
    const d = await r.json();
    if (d.error || !d.data || d.data.length === 0) break;
    const matches = d.data.filter(p =>
      p.business_name?.toLowerCase() === businessName.toLowerCase() &&
      new Date(p.scheduled_date_time) >= now
    );
    all = all.concat(matches);
    if (d.data.length < 50) break;
    start += 50;
  }
  return all;
}

function getPlatforms(post) {
  const ids = post.platform_post_ids || {};
  const keys = Object.keys(ids);
  return {
    facebook: keys.some(k => k.startsWith("facebook_")),
    instagram: keys.some(k => k.startsWith("instagram_"))
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
      version: "20.0",
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

    // Always try to find business in current message
    const bizRes = await fetch(`${BASE}/listbusinesses?apiKey=${KEY}`);
    const bizData = await bizRes.json();
    const businesses = bizData.data || [];
    const msgLower = message.toLowerCase();
    let matchedBiz = null, bestScore = 0;

    for (const biz of businesses) {
      const name = biz.business_name.toLowerCase();
      if (msgLower.includes(name)) { matchedBiz = biz; bestScore = 99; break; }
      const nameWords = name.split(/\s+/).filter(w => w.length > 2);
      const score = nameWords.filter(w =>
        msgLower.split(/\s+/).some(m => m.includes(w) || w.includes(m))
      ).length;
      if (score > bestScore) { bestScore = score; matchedBiz = biz; }
    }

    // Only update session business if we found one in THIS message
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
      }) + " at " + new Date(d).toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit"
      });

      // Fetch published + scheduled in parallel
      const [published, upcoming] = await Promise.all([
        getPublishedThisMonth(KEY, biz.id, monthStart, monthEnd),
        getUpcomingScheduled(KEY, name)
      ]);

      // Split by platform
      const fbPosts = published.filter(p => getPlatforms(p).facebook);
      const igPosts = published.filter(p => getPlatforms(p).instagram);
      // Posts with no platform tag count as facebook
      const noPlatformPosts = published.filter(p => {
        const plat = getPlatforms(p);
        return !plat.facebook && !plat.instagram;
      });
      const totalFb = fbPosts.length + noPlatformPosts.length;
      const totalIg = igPosts.length;

      dataContext = `LIVE DATA FOR: ${name} — ${monthName}\n`;
      dataContext += `Business ID: ${biz.id}\n\n`;

      dataContext += `FACEBOOK POSTS THIS MONTH (${totalFb}):\n`;
      [...fbPosts, ...noPlatformPosts].forEach((p, i) => {
        const offer = p.content?.match(/🎉[^\n]*/)?.[0] || null;
        dataContext += `${i+1}. ${fmt(p.published_at || p.created_at)}${offer ? ' — ' + offer : ''}\n`;
      });
      dataContext += "\n";

      dataContext += `INSTAGRAM POSTS THIS MONTH (${totalIg}):\n`;
      if (igPosts.length > 0) {
        igPosts.forEach((p, i) => {
          dataContext += `${i+1}. ${fmt(p.published_at || p.created_at)}\n`;
        });
      } else {
        dataContext += `No Instagram posts this month\n`;
      }
      dataContext += "\n";

      dataContext += `TOTAL PUBLISHED: ${published.length} posts\n\n`;

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

    const systemPrompt = `You are the ORDERE AI Assistant — an intelligent, professional WhatsApp assistant for ORDERE, a UK-based Online Ordering and Marketing Solution serving 700+ restaurants.

ABOUT ORDERE: Provides branded ordering websites and full digital marketing. Two departments: Marketing and Support.

TIME: ${now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK (${timeOfDay})
TODAY: ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
CURRENT MONTH: ${monthName}
IDENTIFIED BUSINESS: ${session.business ? session.business.business_name : "Not yet identified"}

TONE: Professional and direct. Plain text only. No emojis. No asterisks. No markdown. WhatsApp style.

CONVERSATION:
No business yet: "Good ${timeOfDay}. Welcome to ORDERE. How can I assist you today? Please share your business name and postcode."
Business with query in same message: Skip greeting. Answer directly.
Business name alone: "Thank you. I have found your account — ${session.business?.business_name || "your business"}. How can I help you today?"
Business already known: Answer directly using the LIVE DATA below.

MARKETING UPDATE FORMAT (use exact live data — no guessing):
"Here is your marketing update for [Business Name] — [Month].

Facebook: [X] posts published this month
[list each with date and time]

Instagram: [X] posts published this month
[list each with date and time — or say "No Instagram posts this month"]

Upcoming scheduled: [X] posts
[list each with date, time and offer]

Total published this month: [X] posts

Is there anything else I can help you with?"

SUPPORT QUERY:
"Thank you for reaching out. I have noted your query regarding [issue] for ${session.business?.business_name || "your account"}. I am forwarding this to our Support Department right away and they will contact you shortly. For urgent matters please call 03333 444 948. Is there anything else I can help you with?"

SPEAK TO TEAM: "Of course. You can reach our team on 03333 444 948. Is there anything else I can help you with?"

ANY OTHER QUESTION: Full AI intelligence as marketing consultant. Give real value. Never refuse.

CRITICAL RULES:
- Only use the LIVE DATA below — never invent numbers or dates
- The business is ${session.business ? session.business.business_name : "not yet identified"} — do not mix up with other businesses
- Never mention JustEat, Uber Eats, Deliveroo
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
        messages: [...session.history, { role: "user", content: message }]
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
      business: session.business?.business_name,
      data_check: session.business ? `Fetching for: ${session.business.business_name} (${session.business.id})` : "no business"
    });

  } catch (err) {
    console.error("Error:", err.message);
    return res.status(200).json({
      reply: "I am having a technical issue right now. Please try again or call 03333 444 948.",
      error: err.message
    });
  }
}
