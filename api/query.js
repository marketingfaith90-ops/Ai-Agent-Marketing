const sessions = new Map();
const SP = "https://scheduler.ordereautomation.xyz/api";

async function getBitrixTasks(bizName, monthStart, monthEnd) {
  const W = process.env.BITRIX24_WEBHOOK;
  const G = process.env.BITRIX24_MARKETING_GROUP_ID;
  if (!W || !G) return { ads:[], sms:[], google:[] };
  try {
    // Bitrix24 REST API - use JSON body with proper field names
    const url = `${W}tasks.task.list.json`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: { GROUP_ID: G }
      }),
      signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    console.log("Bitrix error:", d.error || "none");
    console.log("Bitrix error_description:", d.error_description || "none");
    console.log("Bitrix result type:", Array.isArray(d.result) ? "array" : typeof d.result);
    console.log("Bitrix result raw:", JSON.stringify(d.result).substring(0, 500));
    // result may be an array directly, or {tasks:[...]}, depending on Bitrix24 version
    const all = Array.isArray(d.result) ? d.result : (d.result?.tasks || []);
    console.log("Bitrix total:", all.length);
    console.log("Bitrix raw first item:", JSON.stringify(all[0] || "empty").substring(0, 400));

    // NOTE: tasks.task.list returns lowerCamelCase fields (id, title, status,
    // createdDate, deadline) — NOT the UPPER_CASE fields used by CRM methods.
    const biz = bizName.toLowerCase().replace(/['\-]/g,"");
    const bizWords = biz.split(" ").filter(w => w.length > 2);
    const matched = all.filter(t => {
      const title = (t.title||"").toLowerCase().replace(/['\-]/g,"");
      return bizWords.filter(w => title.includes(w)).length >= Math.min(2, bizWords.length);
    });
    const sm = {"1":"New","2":"In Progress","3":"Completed","4":"Pending","5":"Completed","6":"Deferred"};
    const f = t => ({
      title: t.title,
      status: sm[t.status]||t.status,
      date: t.createdDate?new Date(t.createdDate).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):null,
      deadline: t.deadline?new Date(t.deadline).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):null
    });
    return {
      ads: matched.filter(t=>/social media ads|facebook ads|instagram ads|boost/i.test(t.title||"")).map(f),
      sms: matched.filter(t=>/sms|text marketing/i.test(t.title||"")).map(f),
      google: matched.filter(t=>/google ads|google ad|gmb/i.test(t.title||"")).map(f)
    };
  } catch(e) { 
    console.error("Bitrix error:", e.message);
    return { ads:[], sms:[], google:[], error: e.message }; 
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if (req.method==="OPTIONS") return res.status(200).end();

  const KEY = process.env.SCHEDULEPRO_API_KEY;
  const CLAUDE = process.env.ANTHROPIC_API_KEY;
  const BW = process.env.BITRIX24_WEBHOOK;
  const BG = process.env.BITRIX24_MARKETING_GROUP_ID;

  if (req.method==="GET") {
    return res.status(200).json({
      status:"ORDERE AI Agent Live", version:"26.0",
      anthropic:CLAUDE?"SET":"MISSING", schedulepro:KEY?"SET":"MISSING",
      bitrix_webhook:BW?"SET: "+BW.substring(0,40)+"...":"MISSING",
      bitrix_group:BG||"MISSING"
    });
  }

  if (req.method!=="POST") return res.status(405).end();
  const {message,sessionId}=req.body||{};
  if (!message) return res.status(400).json({error:"No message"});

  const sid=sessionId||"default";
  if (!sessions.has(sid)) sessions.set(sid,{history:[],business:null});
  const session=sessions.get(sid);

  const now=new Date();
  const hour=parseInt(now.toLocaleTimeString("en-GB",{timeZone:"Europe/London",hour:"2-digit"}));
  const timeOfDay=hour<12?"Morning":hour<17?"Afternoon":"Evening";
  const fmt=d=>new Date(d).toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})+" at "+new Date(d).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});

  const msgLower=message.toLowerCase();
  const monthMap={january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11,jan:0,feb:1,apr:3,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  let tYear=now.getFullYear(),tMonth=now.getMonth();
  if (/\blast month\b/.test(msgLower)){tMonth--;if(tMonth<0){tMonth=11;tYear--;}}
  else{for(const[mn,mi]of Object.entries(monthMap)){if(new RegExp(`\\b${mn}\\b`).test(msgLower)){tMonth=mi;if(tMonth>now.getMonth())tYear--;break;}}}
  const monthStart=new Date(tYear,tMonth,1);
  const monthEnd=new Date(tYear,tMonth+1,0,23,59,59);
  const monthName=monthStart.toLocaleDateString("en-GB",{month:"long",year:"numeric"});

  try {
    const bizRes=await fetch(`${SP}/listbusinesses?apiKey=${KEY}`,{signal:AbortSignal.timeout(5000)});
    const businesses=(await bizRes.json()).data||[];
    let matched=null,best=0;
    for(const b of businesses){
      const n=b.business_name.toLowerCase();
      // Exact include match
      if(msgLower.includes(n)){matched=b;best=99;break;}
      // Business name includes message words
      const msgWords=msgLower.split(/\s+/).filter(w=>w.length>1);
      const bizWords=n.split(/\s+/).filter(w=>w.length>1);
      // Score: how many business name words appear in message
      const score=bizWords.filter(w=>msgWords.some(m=>m.includes(w)||w.startsWith(m))).length;
      if(score>best){best=score;matched=b;}
      // Also try: message contains first word of business name
      if(bizWords.length>0&&msgLower.includes(bizWords[0])&&score>0){
        if(score>best){best=score+0.5;matched=b;}
      }
    }
    // Minimum score threshold
    if(best<1)matched=null;
    if(matched&&best>0&&(!session.business||session.business.id!==matched.id)){session.business=matched;session.history=[];}

    let dataContext="Business not yet identified.";

    if(session.business){
      const biz=session.business;
      const name=biz.business_name;

      const [p0,p1,p2,p3,p4,p5,p6,p7,s0,accRes,bitrix]=await Promise.all([
        fetch(`${SP}/listpublishedposts?apiKey=${KEY}&start=0`,{signal:AbortSignal.timeout(6000)}).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${SP}/listpublishedposts?apiKey=${KEY}&start=50`,{signal:AbortSignal.timeout(6000)}).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${SP}/listpublishedposts?apiKey=${KEY}&start=100`,{signal:AbortSignal.timeout(6000)}).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${SP}/listpublishedposts?apiKey=${KEY}&start=150`,{signal:AbortSignal.timeout(6000)}).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${SP}/listpublishedposts?apiKey=${KEY}&start=200`,{signal:AbortSignal.timeout(6000)}).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${SP}/listpublishedposts?apiKey=${KEY}&start=250`,{signal:AbortSignal.timeout(6000)}).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${SP}/listpublishedposts?apiKey=${KEY}&start=300`,{signal:AbortSignal.timeout(6000)}).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${SP}/listpublishedposts?apiKey=${KEY}&start=350`,{signal:AbortSignal.timeout(6000)}).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${SP}/listscheduledposts?apiKey=${KEY}&start=0`,{signal:AbortSignal.timeout(6000)}).then(r=>r.json()).catch(()=>({data:[]})),
        fetch(`${SP}/listaccounts?apiKey=${KEY}&business_id=${biz.id}`,{signal:AbortSignal.timeout(5000)}).then(r=>r.json()).catch(()=>({data:[]})),
        getBitrixTasks(name,monthStart,monthEnd)
      ]);

      const allPub=[...(p0.data||[]),...(p1.data||[]),...(p2.data||[]),...(p3.data||[]),...(p4.data||[]),...(p5.data||[]),...(p6.data||[]),...(p7.data||[])];
      const accounts=accRes.data||[];
      const fbPageId=accounts.find(a=>a.platform==="facebook")?.account_id;

      const published=allPub.filter(p=>{
        const dt=new Date(p.published_at||p.created_at);
        if(dt<monthStart||dt>monthEnd)return false;
        if(p.business_name?.toLowerCase()===name.toLowerCase())return true;
        if(fbPageId){const keys=Object.keys(p.platform_post_ids||{});if(keys.some(k=>k.includes(fbPageId)))return true;}
        return false;
      });

      const upcoming=(s0.data||[]).filter(p=>p.business_name?.toLowerCase()===name.toLowerCase()&&new Date(p.scheduled_date_time)>=now);

      const fbP=[],igP=[],gmbP=[];
      published.forEach(p=>{
        const keys=Object.keys(p.platform_post_ids||{});
        const hasFb=keys.some(k=>k.startsWith("facebook_"));
        const hasIg=keys.some(k=>k.startsWith("instagram_"));
        const hasGmb=keys.some(k=>k.startsWith("gmb_")||k.startsWith("google_"));
        const date=fmt(p.published_at||p.created_at);
        const offer=p.content?.match(/🎉[^\n]*/)?.[0]||null;
        if(hasFb||(!hasFb&&!hasIg&&!hasGmb))fbP.push({date,offer});
        if(hasIg)igP.push({date});
        if(hasGmb)gmbP.push({date});
      });

      dataContext=`LIVE DATA FOR: ${name} — ${monthName}\n\n`;
      dataContext+=`FACEBOOK (${fbP.length}):\n`;
      fbP.length>0?fbP.forEach((p,i)=>{dataContext+=`${i+1}. ${p.date}${p.offer?" — "+p.offer:""}\n`}):(dataContext+="None this month\n");
      dataContext+=`\nINSTAGRAM (${igP.length}):\n`;
      igP.length>0?igP.forEach((p,i)=>{dataContext+=`${i+1}. ${p.date}\n`}):(dataContext+="None this month\n");
      dataContext+=`\nGOOGLE BUSINESS PROFILE (${gmbP.length}):\n`;
      gmbP.length>0?gmbP.forEach((p,i)=>{dataContext+=`${i+1}. ${p.date}\n`}):(dataContext+="None this month\n");
      dataContext+=`\nTOTAL PUBLISHED: ${published.length} posts\n\n`;
      dataContext+=`UPCOMING SCHEDULED (${upcoming.length}):\n`;
      upcoming.length>0?upcoming.forEach((p,i)=>{const o=p.content?.match(/🎉[^\n]*/)?.[0]||"no offer";dataContext+=`${i+1}. ${fmt(p.scheduled_date_time)} — ${o}\n`}):(dataContext+="None\n");
      dataContext+=`\nBITRIX DEBUG: ads=${bitrix.ads.length} sms=${bitrix.sms.length} google=${bitrix.google.length} error=${bitrix.error||"none"}\n`;
      dataContext+=`\nADS CAMPAIGNS (${bitrix.ads.length}):\n`;
      bitrix.ads.length>0?bitrix.ads.forEach((t,i)=>{dataContext+=`${i+1}. ${t.title} — ${t.status}${t.deadline?" | Deadline: "+t.deadline:""}\n`}):(dataContext+="None this month\n");
      dataContext+=`\nSMS MARKETING (${bitrix.sms.length}):\n`;
      bitrix.sms.length>0?bitrix.sms.forEach((t,i)=>{dataContext+=`${i+1}. ${t.title} — ${t.status} | ${t.date}\n`}):(dataContext+="None this month\n");
      dataContext+=`\nGOOGLE ADS (${bitrix.google.length}):\n`;
      bitrix.google.length>0?bitrix.google.forEach((t,i)=>{dataContext+=`${i+1}. ${t.title} — ${t.status}\n`}):(dataContext+="None this month\n");
    }

    const systemPrompt=`You are the ORDERE AI Assistant — professional WhatsApp assistant for ORDERE, a UK Online Ordering and Marketing Solution for 700+ restaurants. ORDERE has Marketing and Support departments.

TIME: ${now.toLocaleTimeString("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit"})} UK (${timeOfDay})
TODAY: ${now.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
CURRENT MONTH: ${monthName}
IDENTIFIED BUSINESS: ${session.business?session.business.business_name:"Not yet identified"}

TONE: Professional. Direct. Plain text only. No emojis. No asterisks. WhatsApp style.

CONVERSATION:
No business yet: "Good ${timeOfDay}. Welcome to ORDERE. How can I assist you today? Please share your business name and postcode."
Business with query: Skip greeting. Answer directly.
Business alone: "Thank you. I have found your account — ${session.business?.business_name||"your business"}. How can I help you today?"
Business already known: Answer directly. Never ask for name again.
No business in message but needs account data: "Could you please confirm which business you are referring to and your postcode?"

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
[list each: name, status, deadline if any]

SMS Marketing: [X] this month
[list each: name, status, date]

Google Ads: [X] this month
[list or say none]

Is there anything else I can help you with?"

SUPPORT QUERY: "Thank you for reaching out. I have noted your query regarding [issue] for ${session.business?.business_name||"your account"}. I am forwarding this to our Support Department right away and they will contact you shortly. For urgent matters please call 03333 444 948. Is there anything else I can help you with?"
GOOGLE REVIEWS: Give consultant advice + flag to marketing team + give 03333 444 948.
COMPETITOR: Give business advice + flag to marketing team + give 03333 444 948.
SPEAK TO TEAM: "Of course. You can reach our team on 03333 444 948. Is there anything else I can help you with?"
ANY OTHER QUESTION: Full AI intelligence. Give real value. Never refuse.
FRUSTRATED CUSTOMER: Detect anger. Respond with empathy, apologise, escalate, give 03333 444 948.
CANCELLATION THREAT: Acknowledge, apologise, escalate to senior team, give 03333 444 948.

RULES:
- Plain text only. No emojis. No asterisks.
- Never mention JustEat, Uber Eats, Deliveroo.
- Only use live data — never invent.
- Never give unsolicited advice.
- Never ask for business name again once confirmed.
- Always end: "Is there anything else I can help you with?"

LIVE DATA:
${dataContext}`;

    const cr=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":CLAUDE,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1024,system:systemPrompt,messages:[...session.history,{role:"user",content:message}]})});
    const cd=await cr.json();
    if(cd.error)throw new Error(cd.error.message);
    const reply=cd.content[0].text;
    session.history.push({role:"user",content:message});
    session.history.push({role:"assistant",content:reply});
    if(session.history.length>20)session.history.splice(0,2);
    return res.status(200).json({reply,sessionId:sid,business:session.business?.business_name});
  } catch(err){
    return res.status(200).json({reply:"I am having a technical issue right now. Please try again or call 03333 444 948.",error:err.message});
  }
}
