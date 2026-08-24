import { getMarketingUpdate } from "./marketingUpdate.js";

function detectIntent(msg) {
  const m = msg.toLowerCase();
  if (m.match(/marketing|post|schedule|publish|content|social|instagram|facebook|google|update/))
    return "marketing_update";
  if (m.match(/\bad\b|ads|campaign|boost|paid/))
    return "ads_check";
  if (m.match(/order|website|online|sales/))
    return "orders_check";
  return "unknown";
}

function extractBusinessName(msg) {
  return msg
    .replace(/marketing update|marketing|update|my|for|can you|check|please|hi|hello|give me|show me|tell me|about|how many|posts|schedule|scheduled|published/gi, "")
    .replace(/[?!]/g, "")
    .trim();
}

export async function handleMessage(incomingMessage) {
  const intent   = detectIntent(incomingMessage);
  const bizQuery = extractBusinessName(incomingMessage);

  if (!bizQuery || bizQuery.length < 2) {
    return `Hi! I can help you with:\n\n📊 *Marketing update* — e.g. "Zafrani marketing update"\n📢 *Ads status* — coming soon\n🛒 *Orders data* — coming soon\n\nJust send me the restaurant name!`;
  }

  switch (intent) {
    case "marketing_update":
      return await getMarketingUpdate(bizQuery);
    case "ads_check":
      return `Checking Facebook Ads for *${bizQuery}*.\n\n📢 Ads integration coming soon — please check Meta Ads Manager directly for now.`;
    case "orders_check":
      return `Checking orders for *${bizQuery}*.\n\n🛒 Orders integration coming soon!`;
    default:
      return await getMarketingUpdate(bizQuery);
  }
}
