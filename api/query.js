import { handleMessage } from "../lib/aiAgent.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(200).json({ status: "ORDERE AI Agent Live", version: "1.0" });
  }

  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: "No message provided" });

  try {
    const reply = await handleMessage(message);
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
