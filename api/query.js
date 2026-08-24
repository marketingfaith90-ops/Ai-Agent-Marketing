import { handleWithLLM } from "../lib/llmAgent.js";
import { handleMessage } from "../lib/aiAgent.js";

const sessions = new Map();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({ 
      status: "ORDERE AI Agent Live", 
      version: "2.0-LLM",
      anthropic_key: process.env.ANTHROPIC_API_KEY ? "SET ✅" : "MISSING ❌",
      schedulepro_key: process.env.SCHEDULEPRO_API_KEY ? "SET ✅" : "MISSING ❌"
    });
  }

  if (req.method !== "POST") return res.status(405).end();

  const { message, sessionId } = req.body || {};
  if (!message) return res.status(400).json({ error: "No message provided" });

  const sid = sessionId || "default";
  if (!sessions.has(sid)) sessions.set(sid, []);
  const history = sessions.get(sid);

  try {
    // Check if Anthropic API key exists
    if (!process.env.ANTHROPIC_API_KEY) {
      // Fallback to rule-based agent
      const reply = await handleMessage(message);
      return res.status(200).json({ reply, sessionId: sid, mode: "fallback" });
    }

    const reply = await handleWithLLM(message, history);

    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: reply });
    if (history.length > 20) history.splice(0, 2);

    return res.status(200).json({ reply, sessionId: sid, mode: "llm" });

  } catch (err) {
    console.error("Query error:", err);
    // Fallback to rule-based on any error
    try {
      const reply = await handleMessage(message);
      return res.status(200).json({ reply, sessionId: sid, mode: "fallback", error: err.message });
    } catch (err2) {
      return res.status(200).json({ 
        reply: "I'm having a technical issue right now. Please try again in a moment. 🙏",
        error: err.message 
      });
    }
  }
}
