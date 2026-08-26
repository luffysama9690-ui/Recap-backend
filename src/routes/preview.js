const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const express = require("express");

const { narrateScript } = require("../services/narrate");
const { VOICES } = require("../voices");

const router = express.Router();

const PREVIEW_TEXT = "မင်္ဂလာပါ၊ ဒါက ကျွန်တော့်အသံနမူနာ ဖြစ်ပါတယ်။";

// Preview text never changes, so the generated audio for a given voice is
// always identical — cache it in memory instead of calling Gemini TTS live
// on every click. First click per voice per server instance pays the
// generation latency once; every click after that is served instantly.
// Cache clears naturally on redeploy/restart (Render free-tier spin-down
// included), which is fine — it just regenerates once on next use.
const previewCache = new Map(); // voiceId -> { audioBase64, mimeType }

// POST /api/preview-voice  { voice: "hsayama" }
// Returns { audioBase64, mimeType } so the frontend can build a data: URL,
// same shape TTS Pro itself returns. Keeps OpenAI/TTS Pro keys server-side.
router.post("/preview-voice", async (req, res) => {
  const voiceId = req.body.voice;
  if (!voiceId || !VOICES[voiceId]) {
    return res.status(400).json({ error: "invalid voice id" });
  }

  const cached = previewCache.get(voiceId);
  if (cached) return res.json(cached);

  const tmpPath = path.join(os.tmpdir(), `preview-${crypto.randomUUID()}.wav`);
  try {
    await narrateScript(PREVIEW_TEXT, voiceId, tmpPath);
    const buffer = fs.readFileSync(tmpPath);
    const payload = { audioBase64: buffer.toString("base64"), mimeType: "audio/wav" };
    previewCache.set(voiceId, payload);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err.message });
  } finally {
    fs.rm(tmpPath, { force: true }, () => {});
  }
});

module.exports = router;
