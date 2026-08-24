import { handleWithLLM } from "../lib/llmAgent.js";

// Store conversation history per session (in memory — resets on redeploy)
const sessions = new Map();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({ status: "ORDERE AI Agent Live", version: "2.0-LLM" });
  }

  if (req.method !== "POST") return res.status(405).end();

  const { message, sessionId } = req.body || {};
  if (!message) return res.status(400).json({ error: "No message provided" });

  // Get or create session history
  const sid = sessionId || "default";
  if (!sessions.has(sid)) sessions.set(sid, []);
  const history = sessions.get(sid);

  try {
    const reply = await handleWithLLM(message, history);

    // Update conversation history (keep last 10 exchanges)
    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: reply });
    if (history.length > 20) history.splice(0, 2);

    return res.status(200).json({ reply, sessionId: sid });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
