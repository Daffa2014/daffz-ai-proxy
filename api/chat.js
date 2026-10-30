// DaffzHub AI proxy (Vercel serverless function). The Gemini key lives ONLY in the
// GEMINI_API_KEY environment variable on Vercel, never in this file or in GitHub.
const MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];
const hits = new Map(); // best-effort rate limit per IP (resets when the function restarts)

function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 12; // max 12 requests per minute per IP
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: { message: "POST only" } });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: { message: "Server is not configured" } });

  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (limited(ip)) return res.status(429).json({ error: { message: "Too many requests" } });

  let b = req.body;
  if (typeof b === "string") {
    try { b = JSON.parse(b); } catch (e) { return res.status(400).json({ error: { message: "Bad JSON" } }); }
  }
  if (!b || !Array.isArray(b.contents)) return res.status(400).json({ error: { message: "Missing contents" } });

  // keep only plain text, last 16 messages, limited length
  let total = 0;
  const contents = [];
  for (const m of b.contents.slice(-16)) {
    const role = m && m.role === "model" ? "model" : "user";
    const text = m && m.parts && m.parts[0] && typeof m.parts[0].text === "string" ? m.parts[0].text.slice(0, 2000) : "";
    if (!text) continue;
    total += text.length;
    contents.push({ role, parts: [{ text }] });
  }
  if (!contents.length || total > 8000) return res.status(400).json({ error: { message: "Message too long" } });

  const sys = b.systemInstruction && b.systemInstruction.parts && b.systemInstruction.parts[0] && b.systemInstruction.parts[0].text;
  const model = MODELS.includes(b.model) ? b.model : MODELS[0];
  const body = {
    contents,
    generationConfig: { temperature: 0.8, maxOutputTokens: 1024 },
  };
  if (typeof sys === "string") body.systemInstruction = { parts: [{ text: sys.slice(0, 3000) }] };

  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
      { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) }
    );
    const text = await r.text();
    res.status(r.status).setHeader("Content-Type", "application/json").send(text);
  } catch (e) {
    res.status(502).json({ error: { message: "Upstream error" } });
  }
};
                                                                   
