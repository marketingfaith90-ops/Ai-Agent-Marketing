import { handleMessage } from "../lib/aiAgent.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const body = req.body;
    const message = body?.messages?.[0];
    if (!message || message.type !== "text") {
      return res.status(200).json({ ok: true });
    }

    const text   = message.text?.body || message.text || "";
    const chatId = message.chatId || message.from || "";

    if (!text || !chatId) return res.status(200).json({ ok: true });

    const reply = await handleMessage(text);

    await fetch("https://api.wazzup24.com/v3/message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.WAZZUP_API_KEY}`
      },
      body: JSON.stringify({ chatId, text: reply })
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: err.message });
  }
}
