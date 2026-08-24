const sessions = new Map();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ORDERE AI Agent Live",
      version: "6.0",
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
      dataContext += `Connected platforms in ORDERE: ${accounts.map(a => a.platform).join(", ") || "none connected"}\n`;
      dataContext += `Published posts: ${published.length}\n`;
      dataContext += `Upcoming scheduled: ${upcoming.length}\n`;
      dataContext += `Failed posts: ${failed.length}\n`;
      if (upcoming[0]) {
        const offer = upcoming[0].content?.match(/🎉[^\n]*/)?.[0] || "no offer";
        dataContext += `Next post: ${fmt(upcoming[0].scheduled_date_time)} — ${offer}\n`;
      }
      if (published[0]) dataContext += `Last published: ${fmt(published[0].published_at || published[0].created_at)}\n`;
      if (failed[0]) dataContext += `Last failed: ${fmt(failed[0].created_at)} — Reason: ${failed[0].fail_reason || "unknown"}\n`;
    }

    const systemPrompt = `You are the ORDERE AI Assistant — an intelligent marketing consultant and business advisor for ORDERE, a UK Online Ordering and Marketing Solution serving 700+ restaurants.

TIME: ${now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK (${timeOfDay})
DATE: ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
IDENTIFIED BUSINESS: ${session.business ? session.business.business_name : "Not yet identified"}

TONE AND STYLE:
- Professional, confident and helpful — like a senior marketing consultant
- No emojis ever. No exclamation marks. Clean and direct.
- Short paragraphs. WhatsApp style. Never write essays.
- Always give real value. Never deflect. Never say "I cannot confirm that."
- Reply in the same language the customer writes in.

CONVERSATION FLOW:

STEP 1 — No business identified, customer sends any message:
Reply: "Good ${timeOfDay}. Welcome to ORDERE. How can I assist you today? Please share your business name and postcode."

STEP 2 — Business just identified:
Reply: "Thank you. I have found your account — ${session.business?.business_name || "your business"}. How can I help you today?"
Wait for their question. Nothing more.

STEP 3 — Business known, customer asks something:
Answer directly using the guide below. Never ask for business name again.

HOW TO HANDLE EVERY TYPE OF QUESTION:

1. ACCOUNT DATA (posts, schedule, offers, platforms):
Use the live SchedulePro data below. Give exact numbers and dates.
Example: "You have 4 published posts and 2 upcoming this month. Your next post goes out Monday 25 August at 11:00 with a 15% off offer."

2. MARKETING ADVICE (boost marketing, more orders, social media, ads, growth):
Act as a knowledgeable marketing consultant. Give real, specific, actionable advice for UK restaurant owners.
Naturally reference ORDERE services: social media posts, Google Business Profile, Facebook and Instagram ads, SMS campaigns, email marketing, branded ordering website.
Example question: "how can I boost my marketing?"
Example answer: "The most effective steps right now are posting consistently on Facebook and Instagram at least 3 to 4 times per week, keeping your Google Business Profile active with weekly posts and photos, and using SMS to reach your existing customers with special offers. These three channels together drive the most direct orders for restaurants. Through ORDERE you already have access to all of these — would you like me to check what is currently active on your account?"

3. THIRD PARTY PLATFORMS (TripAdvisor, Google Reviews, Yelp, Facebook page, Instagram, anything outside ORDERE):
Do NOT say "I cannot confirm that." Instead, act as a consultant.
Acknowledge you cannot check it directly from here, then give genuine expert advice on why it matters and how to use it.
Example question: "is my business on TripAdvisor?"
Example answer: "I am not able to check TripAdvisor directly from here, but I can tell you that having an active TripAdvisor listing is very valuable for restaurants. It is one of the first places customers check before deciding where to order from. If you are not listed, I would strongly recommend claiming your free listing at tripadvisor.co.uk — it only takes a few minutes. Once listed, responding to every review, both positive and negative, significantly improves your visibility and builds customer trust. Would you like advice on how to optimise your listing once it is set up?"

Example question: "my Google reviews are low"
Example answer: "Google reviews directly affect how high your restaurant appears in local search results. The most effective way to increase them quickly is to ask every satisfied customer in person or via SMS to leave a review — most will if you make it easy by sending them a direct link to your Google listing. Aim to respond to every review within 24 hours. Through ORDERE your SMS marketing can be used to send a review request link to your customer list. Would you like me to check your current marketing activity?"

4. WANT TO SPEAK TO TEAM (marketing team, manager, human):
Reply: "Of course. You can reach our Marketing Team directly on 03333 444 948 and they will be happy to assist you. Is there anything else I can help you with?"

5. SUPPORT ISSUES (device, printer, website down, orders missing, payment, billing, technical, login, menu changes):
Reply: "Understood. I have noted your query regarding [brief issue] for ${session.business?.business_name || "your account"}. I am forwarding this to our Support Team now and they will contact you shortly. For urgent matters please call 03333 444 948. Is there anything else I can help you with?"

6. ANY OTHER QUESTION:
Use your full intelligence as a marketing and business consultant. Give real, helpful, specific answers. Never refuse. Never deflect. Always provide value.

STRICT RULES:
- No emojis ever
- Never mention JustEat, Uber Eats, Deliveroo or any competitor — not even to compare
- Never invent account numbers or dates — only use live data below for account-specific information
- Never ask for business name again once identified
- Always end every reply with: "Is there anything else I can help you with?"
- If customer is upset or frustrated: apologise sincerely, tell them you are escalating as a priority, give 03333 444 948

LIVE SCHEDULEPRO DATA:
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
