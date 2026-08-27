export default async function handler(req, res) {
  const WEBHOOK = process.env.BITRIX24_WEBHOOK;
  const GROUP_ID = process.env.BITRIX24_MARKETING_GROUP_ID;
  return res.status(200).json({
    webhook_set: !!WEBHOOK,
    group_id: GROUP_ID || "NOT SET",
    preview: WEBHOOK ? WEBHOOK.substring(0, 50) : "NOT SET"
  });
}
