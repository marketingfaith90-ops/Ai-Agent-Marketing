const sessions = new Map();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ORDERE AI Agent Live",
      version: "5.0",
      anthropic_key: process.env.ANTHROPIC_API_KEY ? "SET" : "MISSING",
      schedulepro_key: process.env.SCHEDULEPRO_API_KEY ? "SET" : "MISSING"
    });
  }

  if (req.method !== "POST") return res.status(405).end();

  const { message, sessionId } = req.body || {};
  if (!message) return res.status(400).json({ error: "No message provided" });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const SCHEDULEPRO_KEY = process.env.SCHEDULEPRO_API_KEY;
  const SCHEDULEPRO_URL = process.env.SCHEDULEPRO_API_URL || "https://scheduler.ordereautomation.xyz/api";

  const sid = sessionId || "default";
  if (!sessions.has(sid)) sessions.set(sid, { history: [], business: null });
  const session = sessions.get(sid);

  try {
    const now = new Date();
    const hour = parseInt(now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit" }));
    const timeOfDay = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

    // Find business from message if not already in session
    if (!session.business) {
      const bizRes = await fetch(`${SCHEDULEPRO_URL}/listbusinesses?apiKey=${SCHEDULEPRO_KEY}`);
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

    // Fetch live SchedulePro data if business known
    let dataContext = "Business not yet identified.";
    if (session.business) {
      const biz = session.business;
      const fmt = d => new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + " at " + new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      const [s, p, f, a] = await Promise.all([
        fetch(`${SCHEDULEPRO_URL}/listscheduledposts?apiKey=${SCHEDULEPRO_KEY}&start=0`).then(r => r.json()),
        fetch(`${SCHEDULEPRO_URL}/listpublishedposts?apiKey=${SCHEDULEPRO_KEY}&start=0`).then(r => r.json()),
        fetch(`${SCHEDULEPRO_URL}/listfailedposts?apiKey=${SCHEDULEPRO_KEY}&start=0`).then(r => r.json()),
        fetch(`${SCHEDULEPRO_URL}/listaccounts?apiKey=${SCHEDULEPRO_KEY}&business_id=${biz.id}`).then(r => r.json())
      ]);
      const name = biz.business_name;
      const match = arr => (arr.data || []).filter(p => p.business_name?.toLowerCase() === name.toLowerCase());
      const scheduled = match(s);
      const published = match(p);
      const failed = match(f);
      const accounts = a.data || [];
      const upcoming = scheduled.filter(p => new Date(p.scheduled_date_time) >= now);

      dataContext = `LIVE DATA — ${name}\n`;
      dataContext += `Platforms: ${accounts.map(a => a.platform).join(", ") || "none connected"}\n`;
      dataContext += `Published: ${published.length} | Upcoming: ${upcoming.length} | Failed: ${failed.length}\n`;
      if (upcoming[0]) {
        const offer = upcoming[0].content?.match(/🎉[^\n]*/)?.[0] || "no offer";
        dataContext += `Next post: ${fmt(upcoming[0].scheduled_date_time)} — ${offer}\n`;
      }
      if (published[0]) dataContext += `Last published: ${fmt(published[0].published_at || published[0].created_at)}\n`;
      if (failed[0]) dataContext += `Last failed: ${fmt(failed[0].created_at)} — Reason: ${failed[0].fail_reason || "unknown"}\n`;
    }

    const systemPrompt = `You are the ORDERE AI Assistant. ORDERE is a UK-based Online Ordering and Marketing Solution for 700+ restaurants.

TIME: ${now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK (${timeOfDay})
DATE: ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
BUSINESS: ${session.business ? session.business.business_name : "Not identified yet"}

TONE:
- Professional and clear. No emojis. No exclamation marks. No filler words.
- Short, direct answers. WhatsApp style.
- Warm but not overly friendly. Like a trusted business advisor.

CONVERSATION RULES:

If no business identified and customer sends any message:
Reply: "Good ${timeOfDay}. Welcome to ORDERE. How can I assist you today? Please share your business name and postcode."

If business just identified this message:
Reply: "Thank you. I have found your account — ${session.business?.business_name || "your business"}. How can I help you today?"
Say nothing else. Wait for their question.

If business already known and customer asks something:
Answer directly. Do not mention the business name lookup again.

HOW TO ANSWER:

Account questions (posts, schedule, offers, platforms, marketing activity):
Use only the live data below. Give exact numbers and dates.

Marketing and growth questions (how to get more orders, boost marketing, social media, ads, SMS, email):
Answer as a knowledgeable marketing consultant. Give practical, specific advice for UK restaurant owners. Reference ORDERE services naturally where relevant: social media posting, Google Business Profile management, Facebook and Instagram ads, SMS campaigns, email marketing, branded direct ordering website. Be genuinely helpful.

Support issues (device, printer, website, orders not received, payment, billing, technical, login):
Reply: "Understood. I have noted your query regarding [issue summary] for ${session.business?.business_name || "your account"}. I am forwarding this to our Support Team now and they will contact you shortly. For urgent matters call 03333 444 948."

Any other question:
Answer using your intelligence. Be a helpful consultant. Never refuse to help.

RULES:
- No emojis ever
- Never mention JustEat, Uber Eats, Deliveroo or any competitor
- Never invent account data — only use live data below for specific numbers and dates
- Never ask for business name again once identified
- End every reply with: "Is there anything else I can help you with?"
- If customer is upset: apologise, escalate, give number 03333 444 948

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

    return res.status(200).json({ reply, sessionId: sid, business: session.business?.business_name });

  } catch (err) {
    console.error("Error:", err.message);
    return res.status(200).json({
      reply: "I am having a technical issue right now. Please try again or call 03333 444 948.",
      error: err.message
    });
  }
}
