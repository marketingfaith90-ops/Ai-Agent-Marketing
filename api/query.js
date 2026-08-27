const sessions = new Map();
const BASE = "https://scheduler.ordereautomation.xyz/api";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const KEY = process.env.SCHEDULEPRO_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  if (req.method === "GET") {
    return res.status(200).json({ status: "ORDERE AI Agent Live", version: "25.0" });
  }

  if (req.method !== "POST") return res.status(405).end();

  const { message, sessionId } = req.body || {};
  if (!message) return res.status(400).json({ error: "No message" });

  const sid = sessionId || "default";
  if (!sessions.has(sid)) sessions.set(sid, { history: [], business: null });
  const session = sessions.get(sid);

  const now = new Date();
  const hour = parseInt(now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit" }));
  const timeOfDay = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  const fmt = d => new Date(d).toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" }) + " at " + new Date(d).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });

  // Detect which month the customer is asking about
  const msgLowerMonth = message.toLowerCase();
  const monthMap = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };
  let targetYear = now.getFullYear();
  let targetMonth = now.getMonth();

  // Check for "last month"
  if (msgLowerMonth.includes("last month")) {
    targetMonth = now.getMonth() - 1;
    if (targetMonth < 0) { targetMonth = 11; targetYear--; }
  }
  // Check for specific month name
  else {
    for (const [monthName, monthNum] of Object.entries(monthMap)) {
      if (msgLowerMonth.includes(monthName)) {
        targetMonth = monthNum;
        // If requested month is in future, use last year
        if (targetMonth > now.getMonth()) targetYear--;
        break;
      }
    }
  }

  const monthStart = new Date(targetYear, targetMonth, 1);
  const monthEnd = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);
  const monthName = monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  try {
    // Step 1: Find business
    const bizRes = await fetch(`${BASE}/listbusinesses?apiKey=${KEY}`, { signal: AbortSignal.timeout(5000) });
    const businesses = (await bizRes.json()).data || [];
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

      // Step 2: Get this business's social account IDs
      const accRes = await fetch(`${BASE}/listaccounts?apiKey=${KEY}&business_id=${biz.id}`, { signal: AbortSignal.timeout(5000) });
      const accounts = (await accRes.json()).data || [];
      
      // Extract all platform account IDs for this business
      const fbAccount = accounts.find(a => a.platform === "facebook");
      const igAccount = accounts.find(a => a.platform === "instagram");
      const gmbAccount = accounts.find(a => a.platform === "gmb");
      
      const fbPageId = fbAccount?.account_id;
      const igAccountId = igAccount?.account_id;
      const gmbAccountId = gmbAccount?.account_id;

      // Step 3: Fetch published posts + scheduled in parallel
      // Match by platform_post_ids keys containing the business's page IDs
      const [p0, p1, p2, p3, p4, p5, p6, p7, s0] = await Promise.all([
        fetch(`${BASE}/listpublishedposts?apiKey=${KEY}&start=0`, { signal: AbortSignal.timeout(6000) }).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${BASE}/listpublishedposts?apiKey=${KEY}&start=50`, { signal: AbortSignal.timeout(6000) }).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${BASE}/listpublishedposts?apiKey=${KEY}&start=100`, { signal: AbortSignal.timeout(6000) }).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${BASE}/listpublishedposts?apiKey=${KEY}&start=150`, { signal: AbortSignal.timeout(6000) }).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${BASE}/listpublishedposts?apiKey=${KEY}&start=200`, { signal: AbortSignal.timeout(6000) }).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${BASE}/listpublishedposts?apiKey=${KEY}&start=250`, { signal: AbortSignal.timeout(6000) }).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${BASE}/listpublishedposts?apiKey=${KEY}&start=300`, { signal: AbortSignal.timeout(6000) }).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${BASE}/listpublishedposts?apiKey=${KEY}&start=350`, { signal: AbortSignal.timeout(6000) }).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${BASE}/listscheduledposts?apiKey=${KEY}&start=0`, { signal: AbortSignal.timeout(6000) }).then(r=>r.json()).catch(()=>({data:[]}))
      ]);

      // Combine all published posts
      const allPub = [
        ...(p0.data||[]), ...(p1.data||[]), ...(p2.data||[]), ...(p3.data||[]),
        ...(p4.data||[]), ...(p5.data||[]), ...(p6.data||[]), ...(p7.data||[])
      ];

      // Filter to requested month only
      const thisMonth = allPub.filter(p => {
        const d = new Date(p.published_at || p.created_at);
        return d >= monthStart && d <= monthEnd;
      });

      // Match by business name OR by platform page IDs
      const published = thisMonth.filter(p => {
        // Match by business name (primary)
        if (p.business_name?.toLowerCase() === name.toLowerCase()) return true;
        // Match by Facebook page ID in platform_post_ids keys
        if (fbPageId) {
          const keys = Object.keys(p.platform_post_ids || {});
          if (keys.some(k => k.includes(fbPageId))) return true;
        }
        // Match by Instagram account ID
        if (igAccountId) {
          const keys = Object.keys(p.platform_post_ids || {});
          if (keys.some(k => k.includes(igAccountId))) return true;
        }
        return false;
      });

      // Upcoming scheduled
      const upcoming = (s0.data||[]).filter(p =>
        p.business_name?.toLowerCase() === name.toLowerCase() &&
        new Date(p.scheduled_date_time) >= now
      );

      // Split by platform
      const fbPosts = [], igPosts = [], gmbPosts = [];
      published.forEach(p => {
        const keys = Object.keys(p.platform_post_ids || {});
        const hasFb = keys.some(k => k.startsWith("facebook_"));
        const hasIg = keys.some(k => k.startsWith("instagram_"));
        const hasGmb = keys.some(k => k.startsWith("gmb_") || k.startsWith("google_"));
        const date = fmt(p.published_at || p.created_at);
        const offer = p.content?.match(/🎉[^\n]*/)?.[0] || null;
        if (hasFb || (!hasFb && !hasIg && !hasGmb)) fbPosts.push({ date, offer });
        if (hasIg) igPosts.push({ date });
        if (hasGmb) gmbPosts.push({ date });
      });

      dataContext = `LIVE DATA FOR: ${name} — ${monthName}\n`;
      dataContext += `Connected: ${accounts.map(a=>a.platform).join(", ")||"none"}\n\n`;
      
      dataContext += `FACEBOOK (${fbPosts.length} posts):\n`;
      fbPosts.length > 0 ? fbPosts.forEach((p,i) => { dataContext += `${i+1}. ${p.date}${p.offer?' — '+p.offer:''}\n`; }) : (dataContext += "None this month\n");
      
      dataContext += `\nINSTAGRAM (${igPosts.length} posts):\n`;
      igPosts.length > 0 ? igPosts.forEach((p,i) => { dataContext += `${i+1}. ${p.date}\n`; }) : (dataContext += "None this month\n");
      
      dataContext += `\nGOOGLE BUSINESS PROFILE (${gmbPosts.length} posts):\n`;
      gmbPosts.length > 0 ? gmbPosts.forEach((p,i) => { dataContext += `${i+1}. ${p.date}\n`; }) : (dataContext += "None this month\n");
      
      dataContext += `\nTOTAL PUBLISHED: ${published.length} posts\n\n`;
      
      dataContext += `UPCOMING SCHEDULED (${upcoming.length}):\n`;
      upcoming.length > 0 ? upcoming.forEach((p,i) => {
        const offer = p.content?.match(/🎉[^\n]*/)?.[0] || "no offer";
        dataContext += `${i+1}. ${fmt(p.scheduled_date_time)} — ${offer}\n`;
      }) : (dataContext += "None\n");

      dataContext += `\nNOTE: Fetched pages 0-350 (400 posts). Business matched by name AND Facebook page ID ${fbPageId||"unknown"}.`;
    }

    const systemPrompt = `You are the ORDERE AI Assistant — professional WhatsApp assistant for ORDERE, a UK Online Ordering and Marketing Solution for 700+ restaurants. ORDERE has Marketing and Support departments.

TIME: ${now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK (${timeOfDay})
TODAY: ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
CURRENT MONTH: ${monthName}
IDENTIFIED BUSINESS: ${session.business ? session.business.business_name : "Not yet identified"}

TONE: Professional. Direct. Plain text only. No emojis. No asterisks. WhatsApp style.

CONVERSATION:
No business yet: "Good ${timeOfDay}. Welcome to ORDERE. How can I assist you today? Please share your business name and postcode."
Business with query: Skip greeting. Answer directly.
Business alone: "Thank you. I have found your account — ${session.business?.business_name || "your business"}. How can I help you today?"
Business already known: Answer directly. Never ask for name again.

MARKETING UPDATE FORMAT:
"Here is your marketing update for [Business Name] — [Month].

Facebook: [X] posts published this month
[list with dates and offers]

Instagram: [X] posts published this month
[list or say none]

Google Business Profile: [X] posts published this month
[list or say none]

Upcoming scheduled: [X] posts
[list with dates and offers]

Total published this month: [X] posts

Is there anything else I can help you with?"

SUPPORT QUERY: "Thank you for reaching out. I have noted your query regarding [issue] for ${session.business?.business_name || "your account"}. I am forwarding this to our Support Department right away and they will contact you shortly. For urgent matters please call 03333 444 948. Is there anything else I can help you with?"

SPEAK TO TEAM: "Of course. You can reach our team on 03333 444 948. Is there anything else I can help you with?"

ANY OTHER QUESTION: Full AI intelligence. Give real value. Never refuse.

RULES:
- Plain text only. No emojis. No asterisks.
- Never mention JustEat, Uber Eats, Deliveroo.
- Only use live data — never invent.
- Never give unsolicited advice.
- Never ask for business name again once identified.
- Always end: "Is there anything else I can help you with?"
- If angry: apologise, escalate, give 03333 444 948.

LIVE DATA:
${dataContext}`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
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
