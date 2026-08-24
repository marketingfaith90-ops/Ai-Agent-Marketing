import { handleMessage } from "../lib/aiAgent.js";

export default async function handler(req, res) {
  // Allow browser access
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const message = req.method === "POST"
    ? req.body?.message
    : req.query?.message;

  if (!message) {
    return res.status(200).json({
      status: "ORDERE AI Agent is live",
      usage: "POST with { message: 'Yasmin marketing update' } or GET ?message=Yasmin"
    });
  }

  const reply = await handleMessage(message);
  return res.status(200).json({ reply });
}
