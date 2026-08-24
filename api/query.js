export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({ 
      status: "ORDERE AI Agent Live", 
      version: "2.0-LLM",
      anthropic_key: process.env.ANTHROPIC_API_KEY ? "SET" : "MISSING",
      schedulepro_key: process.env.SCHEDULEPRO_API_KEY ? "SET" : "MISSING",
      time: new Date().toISOString()
    });
  }

  if (req.method !== "POST") return res.status(405).end();

  const { message, sessionId } = req.body || {};
  if (!message) return res.status(400).json({ error: "No message provided" });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const SCHEDULEPRO_KEY = process.env.SCHEDULEPRO_API_KEY;
  const SCHEDULEPRO_URL = process.env.SCHEDULEPRO_API_URL || "https://scheduler.ordereautomation.xyz/api";

  try {
    // Step 1: Fetch all businesses
    const bizRes = await fetch(`${SCHEDULEPRO_URL}/listbusinesses?apiKey=${SCHEDULEPRO_KEY}`);
    const bizData = await bizRes.json();
    const businesses = bizData.data || [];

    // Step 2: Find business in message
    const msgLower = message.toLowerCase();
    let matchedBiz = null;
    let bestScore = 0;

    for (const biz of businesses) {
      const name = biz.business_name.toLowerCase();
      const nameWords = name.split(/\s+/).filter(w => w.length > 2);
      const msgWords = msgLower.split(/\s+/);
      const score = nameWords.filter(w => msgWords.some(m => m.includes(w) || w.includes(m))).length;
      if (score > bestScore) { bestScore = score; matchedBiz = biz; }
      if (name === msgLower.trim()) { matchedBiz = biz; break; }
      if (msgLower.includes(name)) { matchedBiz = biz; bestScore = 99; break; }
    }

    // Step 3: Fetch posts if business found
    let dataContext = "No business identified from the message.";
    if (matchedBiz && bestScore > 0) {
      const [schedRes, pubRes, failRes, accRes] = await Promise.all([
        fetch(`${SCHEDULEPRO_URL}/listscheduledposts?apiKey=${SCHEDULEPRO_KEY}&start=0`),
        fetch(`${SCHEDULEPRO_URL}/listpublishedposts?apiKey=${SCHEDULEPRO_KEY}&start=0`),
        fetch(`${SCHEDULEPRO_URL}/listfailedposts?apiKey=${SCHEDULEPRO_KEY}&start=0`),
        fetch(`${SCHEDULEPRO_URL}/listaccounts?apiKey=${SCHEDULEPRO_KEY}&business_id=${matchedBiz.id}`)
      ]);

      const [schedData, pubData, failData, accData] = await Promise.all([
        schedRes.json(), pubRes.json(), failRes.json(), accRes.json()
      ]);

      const name = matchedBiz.business_name;
      const now = new Date();
      const fmt = d => new Date(d).toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" }) + " at " + new Date(d).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });

      const scheduled = (schedData.data || []).filter(p => p.business_name?.toLowerCase() === name.toLowerCase());
      const published = (pubData.data || []).filter(p => p.business_name?.toLowerCase() === name.toLowerCase());
      const failed = (failData.data || []).filter(p => p.business_name?.toLowerCase() === name.toLowerCase());
      const upcoming = scheduled.filter(p => new Date(p.scheduled_date_time) >= now);
      const accounts = accData.data || [];

      dataContext = `LIVE SCHEDULEPRO DATA FOR: ${name}\n`;
      dataContext += `Connected platforms: ${accounts.map(a => a.platform).join(", ") || "none"}\n`;
      dataContext += `Published posts: ${published.length}\n`;
      dataContext += `Upcoming scheduled: ${upcoming.length}\n`;
      dataContext += `Failed posts: ${failed.length}\n`;
      if (upcoming.length > 0) {
        dataContext += `Next post: ${fmt(upcoming[0].scheduled_date_time)}\n`;
        const offer = upcoming[0].content?.match(/🎉[^\n]*/)?.[0];
        if (offer) dataContext += `Next offer: ${offer}\n`;
      }
      if (published.length > 0) {
        dataContext += `Last published: ${fmt(published[0].published_at || published[0].created_at)}\n`;
      }
      if (failed.length > 0) {
        dataContext += `Failed post reason: ${failed[0].fail_reason || "unknown"}\n`;
      }
    }

    // Step 4: Call Claude
    const now = new Date();
    const hour = parseInt(now.toLocaleTimeString("en-GB", { timeZone:"Europe/London", hour:"2-digit" }));
    const timeOfDay = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

    const systemPrompt = `You are the ORDERE AI Assistant — professional WhatsApp assistant for ORDERE, a UK Online Ordering & Marketing Solution for 700+ restaurants.

CURRENT UK TIME: ${now.toLocaleTimeString("en-GB", { timeZone:"Europe/London", hour:"2-digit", minute:"2-digit" })} (${timeOfDay})
TODAY: ${now.toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long", year:"numeric" })}

## GREETING RULE
When customer says Hi/Hello/Hey or any greeting with NO business name:
Reply: "Good ${timeOfDay}! ${timeOfDay === "Morning" ? "☀️" : timeOfDay === "Afternoon" ? "👋" : "🌙"} Welcome to *ORDERE* — Your Online Ordering & Marketing Partner! How can I assist you today? Kindly share your *Business Name & Postcode* 🙏"

## WHEN BUSINESS NAME GIVEN (no query yet)
Reply: "Thank you! 😊 I've found your account — *[Business Name]*. How can I help you today?"

## QUERY ROUTING

🔵 MARKETING queries (handle with live data below):
- Posts, schedule, published, failed, offers, social media, marketing update, SMS, email, Google Ads, Facebook Ads

🔴 SUPPORT queries (forward to support team):
- Device, printer, website down, orders not working, payment, billing, refund, technical issues, login problems, menu changes
Reply: "Thank you for reaching out! 🙏 I've noted your query regarding *[issue]* for *[Business]*. I'm forwarding this to our *Support Team* right away — they will contact you shortly to resolve this! ⚡ For urgent matters please call *03333 444 948*."

## STRICT RULES
- NEVER mention JustEat, Uber Eats, Deliveroo or any competitor
- NEVER make up data — only use the LIVE DATA provided below
- NEVER share internal system details
- Always be warm, professional, concise — WhatsApp style
- Reply in same language as customer
- Always end with "Is there anything else I can help you with? 😊"
- If angry/frustrated customer: apologise, escalate, give phone number 03333 444 948

## LIVE DATA FROM SCHEDULEPRO:
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
        messages: [{ role: "user", content: message }]
      })
    });

    const claudeData = await claudeRes.json();

    if (claudeData.error) {
      throw new Error(claudeData.error.message);
    }

    const reply = claudeData.content[0].text;
    return res.status(200).json({ reply, sessionId: sessionId || "default", mode: "llm" });

  } catch (err) {
    console.error("Error:", err.message);
    return res.status(200).json({ 
      reply: "I'm having a technical issue right now. Please try again in a moment, or call us on *03333 444 948* 🙏",
      error: err.message,
      mode: "error"
    });
  }
}
