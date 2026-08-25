const fs = require("fs");
const fetch = require("node-fetch");

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash"; // gemini-2.5-flash is no longer available to new-user API keys; stuck with

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_ATTEMPTS = 3;

// 503 ("model overloaded") is a transient Google-side capacity issue, not
// a quota/billing problem — retrying a couple of times resolves most of
// these without wasting the download+extract work already done upstream.
async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = /\b(429|500|502|503|504)\b/.test(err.message);
      console.warn(`[transcribe] ${label} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message.slice(0, 200)}`);
      if (!retryable || attempt >= MAX_ATTEMPTS) break;
      await sleep(3000 * attempt);
    }
  }
  throw lastErr;
}

/**
 * Sends an audio file to Gemini and returns a verbatim transcript.
 */
async function transcribeWithGemini(audioPath) {
  const audioBase64 = fs.readFileSync(audioPath).toString("base64");

  return withRetry(async () => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: "audio/mp3", data: audioBase64 } },
                {
                  text:
                    "Transcribe this audio verbatim. Return only the transcript text — no timestamps, no speaker labels, no commentary.",
                },
              ],
            },
          ],
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gemini transcription failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    const transcript = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!transcript) throw new Error("Gemini transcription returned empty content");
    return transcript;
  }, "Gemini transcribe");
}

/**
 * Fallback: OpenAI's Whisper API. Used automatically if Gemini fails and
 * an OPENAI_API_KEY is configured.
 */
async function transcribeWithWhisper(audioPath) {
  const FormData = require("form-data");
  const form = new FormData();
  form.append("file", fs.createReadStream(audioPath));
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Whisper transcription failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.text || "";
}

/**
 * Tries Gemini first (if GEMINI_API_KEY is set); falls back to Whisper
 * (if OPENAI_API_KEY is set) so the pipeline isn't blocked by either
 * provider's quota/billing issues alone.
 * @param {string} audioPath - path to a local audio file (mp3/wav/m4a etc.)
 * @returns {Promise<string>} transcript
 */
async function transcribeAudio(audioPath) {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (hasGemini) {
    try {
      return await transcribeWithGemini(audioPath);
    } catch (geminiErr) {
      console.warn(`[transcribe] Gemini failed: ${geminiErr.message}`);
      if (!hasOpenAI) throw geminiErr;
      console.warn("[transcribe] Falling back to Whisper");
      try {
        return await transcribeWithWhisper(audioPath);
      } catch (whisperErr) {
        throw new Error(
          `Both Gemini and Whisper failed. Gemini: ${geminiErr.message} | Whisper: ${whisperErr.message}`
        );
      }
    }
  }

  if (hasOpenAI) return transcribeWithWhisper(audioPath);

  throw new Error("No GEMINI_API_KEY or OPENAI_API_KEY configured for transcription");
}

module.exports = { transcribeAudio };
