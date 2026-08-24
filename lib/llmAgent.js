import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { listBusinesses, listAccounts, getAllPostsForBusiness } from "./schedulepro.js";
import { findBusiness } from "./businessMatcher.js";

const CLAUDE_API = "https://api.anthropic.com/v1/messages";

// Extract business names mentioned in the message
function extractPotentialBusinessNames(message) {
  // Remove common words, keep potential business names
  const cleaned = message
    .replace(/marketing update|update|my|for|can you|check|please|hi|hello|give me|show me|tell me|about|how many|posts|schedule|scheduled|published|report|provide|what|when|did|is|are|has|have/gi, " ")
    .replace(/[?!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

// Fetch relevant data for the message
async function fetchContextData(message, businesses) {
  const potentialName = extractPotentialBusinessNames(message);
  const biz = findBusiness(potentialName, businesses);

  if (!biz) return null;

  const [accounts, posts] = await Promise.all([
    listAccounts(biz.id),
    getAllPostsForBusiness(biz.business_name)
  ]);

  const now = new Date();
  const upcoming = posts.scheduled.filter(p => new Date(p.scheduled_date_time) >= now);

  return {
    business: biz,
    accounts,
    published: posts.published,
    scheduled: posts.scheduled,
    upcoming,
    failed: posts.failed
  };
}

// Build context string to inject into Claude
function buildDataContext(data) {
  if (!data) return "No business data found for this query.";

  const { business, accounts, published, upcoming, failed } = data;
  const now = new Date();
  const fmt = (d) => new Date(d).toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });

  let ctx = `LIVE DATA FROM SCHEDULEPRO:\n`;
  ctx += `Business: ${business.business_name} (ID: ${business.id})\n`;
  ctx += `Connected platforms: ${accounts.map(a => a.platform).join(", ") || "none found"}\n\n`;

  ctx += `PUBLISHED POSTS (${published.length} total):\n`;
  published.slice(0, 10).forEach(p => {
    const offer = p.content?.match(/🎉[^\n]*/)?.[0] || "no offer";
    ctx += `- ${fmt(p.published_at || p.created_at)} | ${offer}\n`;
  });

  ctx += `\nUPCOMING SCHEDULED POSTS (${upcoming.length} total):\n`;
  upcoming.slice(0, 10).forEach(p => {
    const offer = p.content?.match(/🎉[^\n]*/)?.[0] || "no offer";
    ctx += `- ${fmt(p.scheduled_date_time)} | ${offer}\n`;
  });

  if (failed.length > 0) {
    ctx += `\nFAILED POSTS (${failed.length} total):\n`;
    failed.forEach(p => {
      ctx += `- ${fmt(p.created_at)} | Reason: ${p.fail_reason || "unknown"}\n`;
    });
  }

  return ctx;
}

// Main LLM handler
export async function handleWithLLM(userMessage, conversationHistory = []) {
  try {
    // 1. Fetch businesses list
    const businesses = await listBusinesses();

    // 2. Try to fetch relevant business data
    const data = await fetchContextData(userMessage, businesses);
    const dataContext = buildDataContext(data);

    // 3. Build messages for Claude
    const messages = [
      ...conversationHistory,
      {
        role: "user",
        content: `${userMessage}\n\n[SYSTEM DATA - Use this to answer:\n${dataContext}]`
      }
    ];

    // 4. Call Claude API
    const response = await fetch(CLAUDE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages
      })
    });

    const result = await response.json();

    if (result.error) {
      console.error("Claude API error:", result.error);
      // Fallback to rule-based if Claude fails
      const { handleMessage } = await import("./aiAgent.js");
      return await handleMessage(userMessage);
    }

    return result.content[0].text;

  } catch (err) {
    console.error("LLM error:", err);
    // Fallback to rule-based agent
    const { handleMessage } = await import("./aiAgent.js");
    return await handleMessage(userMessage);
  }
}
