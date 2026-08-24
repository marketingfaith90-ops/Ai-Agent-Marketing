import { listBusinesses, listAccounts, getAllPostsForBusiness } from "./schedulepro.js";
import { findBusiness } from "./businessMatcher.js";

function fmt(dateStr) {
  if (!dateStr) return "Unknown date";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" })
    + " at " + d.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });
}

function getOffer(content) {
  const m = content?.match(/🎉[^\n]*/);
  return m ? m[0].trim() : null;
}

function getPlatformLabel(platform) {
  const icons = { facebook: "📘 Facebook", instagram: "📸 Instagram", google: "📍 Google" };
  return icons[platform?.toLowerCase()] || platform;
}

export async function getMarketingUpdate(businessQuery) {
  const businesses = await listBusinesses();
  const biz = findBusiness(businessQuery, businesses);

  if (!biz) {
    return `I couldn't find *"${businessQuery}"* in SchedulePro. Please check the name and try again.`;
  }

  const name = biz.business_name;
  const now  = new Date();
  const month = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const [accounts, posts] = await Promise.all([
    listAccounts(biz.id),
    getAllPostsForBusiness(name)
  ]);

  const { scheduled, published, failed } = posts;
  const upcoming = scheduled.filter(p => new Date(p.scheduled_date_time) >= now);
  const total = published.length + scheduled.length + failed.length;

  let msg = `📊 *${name} — Marketing Update*\n`;
  msg += `📅 ${month}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (accounts.length > 0) {
    msg += `🔗 *Connected Platforms*\n`;
    msg += `  ${accounts.map(a => getPlatformLabel(a.platform)).join(", ")}\n\n`;
  }

  msg += `✅ *Published Posts (${published.length})*\n`;
  if (published.length > 0) {
    published.slice(0, 5).forEach(p => {
      const date = p.published_at || p.created_at;
      msg += `  • ${fmt(date)}\n`;
      const offer = getOffer(p.content);
      if (offer) msg += `    ${offer}\n`;
    });
    if (published.length > 5) msg += `  ...+${published.length - 5} more\n`;
  } else {
    msg += `  None yet this period\n`;
  }
  msg += "\n";

  msg += `📅 *Upcoming Scheduled (${upcoming.length})*\n`;
  if (upcoming.length > 0) {
    upcoming.slice(0, 5).forEach(p => {
      msg += `  • ${fmt(p.scheduled_date_time)}\n`;
      const offer = getOffer(p.content);
      if (offer) msg += `    ${offer}\n`;
    });
    if (upcoming.length > 5) msg += `  ...+${upcoming.length - 5} more\n`;
  } else {
    msg += `  No upcoming posts scheduled\n`;
  }
  msg += "\n";

  if (failed.length > 0) {
    msg += `❌ *Failed Posts (${failed.length})*\n`;
    failed.slice(0, 3).forEach(p => {
      msg += `  • ${fmt(p.created_at)}\n`;
      if (p.fail_reason) msg += `    Reason: ${p.fail_reason}\n`;
    });
    msg += "\n";
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📈 *Summary*\n`;
  msg += `  Total posts : ${total}\n`;
  msg += `  Published   : ${published.length}\n`;
  msg += `  Upcoming    : ${upcoming.length}\n`;
  if (failed.length > 0) msg += `  ❌ Failed  : ${failed.length} — needs attention!\n`;

  if (upcoming.length > 0) {
    msg += `\n✅ Marketing active — next post ${fmt(upcoming[0].scheduled_date_time)}`;
  } else if (published.length > 0) {
    msg += `\n✅ Posts published this period — nothing upcoming yet`;
  } else {
    msg += `\n⚠️ No posts published or scheduled — action needed!`;
  }

  return msg;
}
