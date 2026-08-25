const sessions = new Map();

async function fetchAllPages(url) {
  let start = 0;
  let allData = [];
  while (true) {
    const r = await fetch(`${url}&start=${start}`);
    const d = await r.json();
    if (d.error || !d.data || d.data.length === 0) break;
    allData = allData.concat(d.data);
    if (d.data.length < 50) break;
    start += 50;
  }
  return allData;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ORDERE AI Agent Live",
      version: "7.0",
      anthropic_key: process.env.ANTHROPIC_API_KEY ? "SET" : "MISSING",
      schedulepro_key: process.env.SCHEDULEPRO_API_KEY ? "SET" : "MISSING"
    });
  }

  if (req.method !== "POST") return res.status(405).end();

  const { message, sessionId } = req.body || {};
  if (!message) return res.status(400).json({ error: "No message provided" });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const KEY = process.env.SCHEDULEPRO_API_KEY;
  const URL = process.env.SCHEDULEPRO_API_URL || "https://scheduler.ordereautomation.xyz/api";

  const sid = sessionId || "default";
  if (!sessions.has(sid)) sessions.set(sid, { history: [], business: null });
  const session = sessions.get(sid);

  try {
    const now = new Date();
    const hour = parseInt(now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit" }));
    const timeOfDay = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

    // Find business if not in session
    if (!session.business) {
      const bizRes = await fetch(`${URL}/listbusinesses?apiKey=${KEY}`);
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

    // Fetch ALL data with pagination
    let dataContext = "Business not yet identified.";
    if (session.business) {
      const biz = session.business;
      const name = biz.business_name;
      const fmt = d => new Date(d).toLocaleDateString("en-GB", {
        weekday: "short", day: "numeric", month: "short"
      }) + " at " + new Date(d).toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit"
      });

      const [allScheduled, allPublished, allFailed, accRes] = await Promise.all([
        fetchAllPages(`${URL}/listscheduledposts?apiKey=${KEY}`),
        fetchAllPages(`${URL}/listpublishedposts?apiKey=${KEY}`),
        fetchAllPages(`${URL}/listfailedposts?apiKey=${KEY}`),
        fetch(`${URL}/listaccounts?apiKey=${KEY}&business_id=${biz.id}`).then(r => r.json())
      ]);

      const match = arr => arr.filter(p => p.business_name?.toLowerCase() === name.toLowerCase());
      const scheduled = match(allScheduled);
      const published = match(allPublished);
      const failed = match(allFailed);
      const accounts = accRes.data || [];
      const upcoming = scheduled.filter(p => new Date(p.scheduled_date_time) >= now);
      const past = scheduled.filter(p => new Date(p.scheduled_date_time) < now);

      dataContext = `LIVE DATA FOR: ${name}\n`;
      dataContext += `Connected platforms: ${accounts.map(a => a.platform).join(", ") || "none"}\n`;
      dataContext += `Total published posts: ${published.length}\n`;
      dataContext += `Total upcoming scheduled: ${upcoming.length}\n`;
      dataContext += `Past scheduled (already sent): ${past.length}\n`;
      dataContext += `Failed posts: ${failed.length}\n\n`;

      if (upcoming.length > 0) {
        dataContext += `UPCOMING POSTS:\n`;
        upcoming.slice(0, 5).forEach((p, i) => {
          const offer = p.content?.match(/🎉[^\n]*/)?.[0] || "no offer";
          dataContext += `${i+1}. ${fmt(p.scheduled_date_time)} — ${offer}\n`;
        });
        if (upcoming.length > 5) dataContext += `...and ${upcoming.length - 5} more upcoming\n`;
        dataContext += "\n";
      }

      if (published.length > 0) {
        dataContext += `RECENT PUBLISHED POSTS:\n`;
        published.slice(0, 5).forEach((p, i) => {
          const offer = p.content?.match(/🎉[^\n]*/)?.[0] || "no offer";
          dataContext += `${i+1}. ${fmt(p.published_at || p.created_at)} — ${offer}\n`;
        });
        if (published.length > 5) dataContext += `...and ${published.length - 5} more published\n`;
        dataContext += "\n";
      }

      if (failed.length > 0) {
        dataContext += `FAILED POSTS:\n`;
        failed.forEach((p, i) => {
          dataContext += `${i+1}. ${fmt(p.created_at)} — ${p.fail_reason || "unknown reason"}\n`;
        });
      }
    }

    const systemPrompt = `You are the ORDERE AI Assistant — a professional marketing consultant and business advisor for ORDERE, a UK Online Ordering and Marketing Solution for 700+ restaurants.

TIME: ${now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK (${timeOfDay})
DATE: ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
IDENTIFIED BUSINESS: ${session.business ? session.business.business_name : "Not yet identified"}

TONE:
- Professional, warm, direct. No emojis ever. No exclamation marks.
- Short clear paragraphs. WhatsApp style.
- Like a trusted senior marketing advisor.
- Reply in same language as customer.
- Use plain text only — no markdown asterisks for bold, no special formatting.

CONVERSATION FLOW:

If no business identified yet:
Reply: "Good ${timeOfDay}. Welcome to ORDERE. How can I assist you today? Please share your business name and postcode."

If business just found this message:
Reply: "Thank you. I have found your account — ${session.business?.business_name || "your business"}. How can I help you today?"
Stop there. Wait for their question.

If business already known — answer their question directly. Never ask for business name again.

ANSWERING QUESTIONS:

ACCOUNT DATA (posts, schedule, offers, platforms, marketing activity):
Use the full live data below. Give all the specific numbers and dates available.
Example: "You have 8 published posts and 2 upcoming this month. Your next post goes out Tuesday 25 August at 11:00 promoting 20% off on collection orders."

MARKETING ADVICE (boost marketing, more orders, social media, ads, growth, strategy):
Act as a knowledgeable marketing consultant. Give real specific advice for UK restaurant owners.
Reference ORDERE services naturally: social media posts, Google Business Profile, Facebook and Instagram ads, SMS campaigns, email marketing, branded direct ordering website.

THIRD PARTY PLATFORMS (TripAdvisor, Google Reviews, Yelp, Facebook page, Instagram, any platform outside ORDERE):
Never say you cannot check it. Instead give real consultant advice on why it matters and exactly what they should do.
Example for TripAdvisor: "I cannot check your TripAdvisor listing directly from here, but it is one of the most important review platforms for restaurants in the UK. Customers consistently check TripAdvisor before deciding where to order from. I would recommend claiming your free listing at tripadvisor.co.uk if you have not already done so. Once listed, responding to every review within 24 hours significantly improves your trust score and visibility. Negative reviews handled well actually build more trust than having no negative reviews at all. Would you like tips on how to respond to reviews effectively?"

SUPPORT ISSUES (device, printer, website down, orders missing, payment, billing, technical, login):
Reply: "Understood. I have noted your query regarding [brief issue] for ${session.business?.business_name || "your account"}. I am forwarding this to our Support Team now and they will contact you shortly. For urgent matters please call 03333 444 948. Is there anything else I can help you with?"

WANT TO SPEAK TO TEAM:
Reply: "Of course. You can reach our team directly on 03333 444 948. Is there anything else I can help you with?"

ANY OTHER QUESTION:
Use full intelligence as a marketing and business consultant. Give real value. Never refuse. Never say I cannot help with that.

RULES:
- No emojis ever
- No markdown formatting — plain text only
- Never mention JustEat, Uber Eats, Deliveroo or any competitor
- Never invent account data — only use live data below for specific numbers and dates
- Never ask for business name again once identified
- Always end with: "Is there anything else I can help you with?"
- If customer angry: apologise sincerely, escalate, give 03333 444 948

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
