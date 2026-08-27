const sessions = new Map();
const BASE = "https://scheduler.ordereautomation.xyz/api";

// Bitrix24 - get marketing tasks for a business
async function getBitrixTasks(businessName, monthStart, monthEnd) {
  const WEBHOOK = process.env.BITRIX24_WEBHOOK;
  const GROUP_ID = process.env.BITRIX24_MARKETING_GROUP_ID;
  if (!WEBHOOK || !GROUP_ID) return { ads: [], sms: [], googleAds: [], other: [] };

  try {
    // Use POST method with JSON body - most reliable Bitrix24 format
    const r = await fetch(`${WEBHOOK}tasks.task.list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: { GROUP_ID: parseInt(GROUP_ID) },
        select: ["ID", "TITLE", "STATUS", "CREATED_DATE", "DEADLINE", "DESCRIPTION"],
        order: { CREATED_DATE: "desc" }
      }),
      signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    const allTasks = d.result?.tasks || [];
    
    // Filter by month
    const tasks = allTasks.filter(t => {
      const date = new Date(t.CREATED_DATE);
      return date >= monthStart && date <= monthEnd;
    });

    // Filter tasks that mention this business
    // Remove apostrophes and special chars for flexible matching
    const bizLower = businessName.toLowerCase().replace(/['\-]/g, "").replace(/\s+/g, " ").trim();
    const bizWords = bizLower.split(" ").filter(w => w.length > 2);
    
    const bizTasks = tasks.filter(t => {
      const title = t.TITLE?.toLowerCase().replace(/['\-]/g, "").replace(/\s+/g, " ") || "";
      const desc = t.DESCRIPTION?.toLowerCase().replace(/['\-]/g, "") || "";
      // Match if title contains business name (with or without apostrophe)
      if (title.includes(bizLower)) return true;
      if (desc.includes(bizLower)) return true;
      // Match by word overlap (handles "Kadirs Kitchen" vs "Kadir's Kitchen")
      const matchCount = bizWords.filter(w => title.includes(w)).length;
      return matchCount >= Math.min(2, bizWords.length);
    });

    // Categorise by type
    const ads = [], sms = [], googleAds = [], other = [];
    
    bizTasks.forEach(t => {
      const title = t.TITLE?.toLowerCase() || "";
      const statusMap = { "2": "In Progress", "3": "Completed", "4": "Pending", "5": "Completed", "6": "Deferred" };
      const status = statusMap[t.STATUS] || "Unknown";
      const date = t.CREATED_DATE ? new Date(t.CREATED_DATE).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" }) : "Unknown date";
      const deadline = t.DEADLINE ? new Date(t.DEADLINE).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" }) : null;
      
      const task = { title: t.TITLE, status, date, deadline };

      if (title.includes("social media ads") || title.includes("facebook ads") || title.includes("instagram ads") || title.includes("social media ad")) {
        ads.push(task);
      } else if (title.includes("sms") || title.includes("sms marketing") || title.includes("text marketing")) {
        sms.push(task);
      } else if (title.includes("google ads") || title.includes("google ad") || title.includes("gmb")) {
        googleAds.push(task);
      } else {
        other.push(task);
      }
    });

    return { ads, sms, googleAds, other };
  } catch(e) {
    console.error("Bitrix error:", e.message);
    return { ads: [], sms: [], googleAds: [], other: [] };
  }
}

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
  // Use word boundary matching to avoid "march" matching in "marketing"
  const msgLowerMonth = message.toLowerCase();
  const monthMap = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };
  let targetYear = now.getFullYear();
  let targetMonth = now.getMonth();

  // Check for "last month"
  if (/\blast month\b/.test(msgLowerMonth)) {
    targetMonth = now.getMonth() - 1;
    if (targetMonth < 0) { targetMonth = 11; targetYear--; }
  }
  // Check for specific month name using word boundaries
  else {
    for (const [mName, mNum] of Object.entries(monthMap)) {
      const regex = new RegExp(`\\b${mName}\\b`);
      if (regex.test(msgLowerMonth)) {
        targetMonth = mNum;
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
    // Find ALL businesses that match (not just best one)
    const allMatches = [];
    for (const biz of businesses) {
      const name = biz.business_name.toLowerCase();
      if (msgLower.includes(name)) { 
        allMatches.push({ biz, score: 99 });
      } else {
        const nameWords = name.split(/\s+/).filter(w => w.length > 2);
        const score = nameWords.filter(w => msgLower.split(/\s+/).some(m => m.includes(w) || w.includes(m))).length;
        if (score > 0) allMatches.push({ biz, score });
      }
    }
    
    // Check if customer has multiple businesses in the system
    // (same phone/contact might manage multiple)
    const hasBusinessInMessage = allMatches.length > 0;
    const isAccountQuery = /order|post|update|marketing|schedule|publish|campaign|report|website|ads|sms|email/i.test(message);
    const needsConfirmation = isAccountQuery && !hasBusinessInMessage && session.business;

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
      
      // Add confirmation note if needed
      if (needsConfirmation) {
        dataContext = `USING SESSION BUSINESS: ${name}\nIMPORTANT: Customer did not mention business name in this message. If query is account-specific, confirm you are referring to ${name} before giving data.\n\n`;
      }

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

      // Bitrix24 - get marketing tasks
      const bitrixTasks = await getBitrixTasks(name, monthStart, monthEnd).catch(() => ({ ads: [], sms: [], googleAds: [], other: [] }));

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

      // Add Bitrix24 data
      dataContext += `\nADS CAMPAIGNS THIS MONTH (${bitrixTasks.ads.length}):\n`;
      if (bitrixTasks.ads.length > 0) {
        bitrixTasks.ads.forEach((t,i) => {
          dataContext += `${i+1}. ${t.title}\n`;
          dataContext += `   Status: ${t.status} | Started: ${t.date}${t.deadline ? ' | Deadline: '+t.deadline : ''}\n`;
        });
      } else {
        dataContext += `No ads campaigns this month\n`;
      }

      dataContext += `\nSMS MARKETING THIS MONTH (${bitrixTasks.sms.length}):\n`;
      if (bitrixTasks.sms.length > 0) {
        bitrixTasks.sms.forEach((t,i) => {
          dataContext += `${i+1}. ${t.title}\n`;
          dataContext += `   Status: ${t.status} | Date: ${t.date}\n`;
        });
      } else {
        dataContext += `No SMS campaigns this month\n`;
      }

      dataContext += `\nGOOGLE ADS THIS MONTH (${bitrixTasks.googleAds.length}):\n`;
      if (bitrixTasks.googleAds.length > 0) {
        bitrixTasks.googleAds.forEach((t,i) => {
          dataContext += `${i+1}. ${t.title}\n`;
          dataContext += `   Status: ${t.status} | Date: ${t.date}\n`;
        });
      } else {
        dataContext += `No Google Ads this month\n`;
      }

      if (bitrixTasks.other.length > 0) {
        dataContext += `\nOTHER MARKETING TASKS (${bitrixTasks.other.length}):\n`;
        bitrixTasks.other.forEach((t,i) => {
          dataContext += `${i+1}. ${t.title} — ${t.status}\n`;
        });
      }
    }

    const systemPrompt = `You are the ORDERE AI Assistant — professional WhatsApp assistant for ORDERE, a UK Online Ordering and Marketing Solution for 700+ restaurants. ORDERE has Marketing and Support departments.

TIME: ${now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK (${timeOfDay})
TODAY: ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
CURRENT MONTH: ${monthName}
IDENTIFIED BUSINESS: ${session.business ? session.business.business_name : "Not yet identified"}

TONE: Professional. Direct. Plain text only. No emojis. No asterisks. WhatsApp style.

CONVERSATION RULES — FOLLOW EXACTLY:

RULE 1 — No business identified yet:
Reply: "Good ${timeOfDay}. Welcome to ORDERE. How can I assist you today? Please share your business name and postcode."

RULE 2 — Business name given WITH a query:
Skip greeting. Answer directly with live data.

RULE 3 — Business name given alone:
Reply: "Thank you. I have found your account — ${session.business?.business_name || "your business"}. How can I help you today?"

RULE 4 — Business already known, same business mentioned again:
Answer directly. Never ask for name again.

RULE 5 — Customer asks account-specific question WITHOUT mentioning business name:
NEVER use session business automatically.
ALWAYS ask: "Could you please confirm which business you are referring to and your postcode? This will help me pull the correct information for you."
This is critical — a customer may manage multiple businesses. Never assume which one they mean.

RULE 6 — Out of scope question (football, weather, jokes, general chat):
Answer using full intelligence but keep it brief. Then offer to help with ORDERE queries.

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

Ads Campaigns: [X] this month
[For each: name, status, started date]

SMS Marketing: [X] this month
[For each: name, status, date]

Google Ads: [X] this month
[For each: name, status, date]

Is there anything else I can help you with?"

SUPPORT QUERY: "Thank you for reaching out. I have noted your query regarding [issue] for ${session.business?.business_name || "your account"}. I am forwarding this to our Support Department right away and they will contact you shortly. For urgent matters please call 03333 444 948. Is there anything else I can help you with?"

SPEAK TO TEAM: "Of course. You can reach our team on 03333 444 948. Is there anything else I can help you with?"

GOOGLE REVIEWS QUERY (bad reviews, low rating, negative review, how to get more reviews):
First give real consultant advice. Then forward to marketing team.
Reply format:
"I understand how important Google reviews are for your restaurant. Here is what I recommend:

1. Respond to every negative review professionally and calmly within 24 hours. Thank them for their feedback and explain what steps you are taking to improve. This shows future customers you care.

2. Ask every satisfied customer to leave a review. The easiest way is to send them a direct link to your Google listing via SMS after their order.

3. Never ignore a negative review. A well-handled negative review actually builds more trust than having none.

4. Aim for a minimum of 4.0 stars. Restaurants above 4.2 stars consistently get more online orders.

I am also flagging this to our Marketing Team right now. They will review your Google Business Profile and advise on the best strategy to improve your rating.

For urgent help please call 03333 444 948.

Is there anything else I can help you with?"

COMPETITOR QUERY (competitor stealing customers, competition, rival restaurant, losing business to competitor):
First give real business advice. Then forward to marketing team.
Reply format:
"Competition is normal in the restaurant industry but there are very effective ways to stay ahead.

1. Your biggest advantage is your own branded ordering website through ORDERE. Unlike competitors using third party apps, you keep 100% of your revenue with no commission fees. Make sure every customer knows they can order directly from you.

2. Consistency on social media is key. Restaurants that post 3 to 4 times per week stay top of mind with local customers. If your competitor is posting more than you, that is the first thing to fix.

3. Loyalty matters more than discounts. A regular customer who orders twice a month is worth more than a one-time discount customer. SMS marketing to your existing customer base drives repeat orders effectively.

4. Make sure your Google Business Profile is fully optimised with updated photos, menu, and opening hours. This directly affects how many people find you in local searches.

I am flagging this to our Marketing Team right now. They will review your current marketing activity and recommend a strategy to help you compete more effectively in your area.

For urgent help please call 03333 444 948.

Is there anything else I can help you with?"

ANY OTHER QUESTION: Full AI intelligence. Give real value. Never refuse.

FRUSTRATED CUSTOMER DETECTION:
If customer message contains any of these signals — treat as frustrated and respond with empathy first:
- Words: cancel, disgusting, terrible, awful, useless, ridiculous, waste, leaving, worst, unacceptable, fed up, done with, sick of, nobody helping, no response, ignored, disappointed, furious, angry, upset, shocking
- ALL CAPS writing
- Multiple exclamation marks
- Threatening to leave or cancel
- Mentioning they are losing money

FRUSTRATED CUSTOMER RESPONSE FORMAT:
"I am truly sorry to hear this and I completely understand your frustration.

[Acknowledge their specific issue in one sentence]

I am escalating this to our team right now as an urgent priority. You will receive a call or message within [1 hour for support issues / same day for marketing issues].

Please call us directly on 03333 444 948 if you need immediate assistance — ask for [Support Team for technical issues / Marketing Team for marketing issues] and mention your business name.

I sincerely apologise for the experience you have had. We value your business greatly and will make this right.

Is there anything else I can help you with?"

CANCELLATION THREAT:
If customer mentions cancelling, leaving, or going elsewhere:
"I am sorry to hear you are considering leaving and I completely understand your frustration. Before you make a decision, I want to make sure your concerns are addressed properly.

I am escalating this to our senior team right now as a priority. Someone will be in touch with you very shortly to discuss this personally and find the best solution for your business.

Please call 03333 444 948 directly and ask for a manager — they will give your case immediate attention.

Is there anything else I can help you with?"

RULES:
- Plain text only. No emojis. No asterisks.
- Never mention JustEat, Uber Eats, Deliveroo.
- Only use live data — never invent.
- Never give unsolicited advice.
- Never ask for business name again once identified.
- Always end: "Is there anything else I can help you with?"
- Always detect frustration and respond with empathy before anything else.
- Never be defensive or make excuses when customer is upset.
- Never dismiss or minimise a customer complaint.

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
