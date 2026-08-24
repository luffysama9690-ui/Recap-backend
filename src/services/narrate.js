const fs = require("fs");
const fetch = require("node-fetch");
const { VOICES } = require("../voices");

// OpenAI TTS voices don't take custom names — map each persona to the
// closest-fitting stock voice as a fallback when TTS Pro (Gemini) is
// unavailable (e.g. quota exceeded).
const OPENAI_FALLBACK_VOICE = {
  hsayama: "shimmer", // warm elder
  kolay: "echo", // energetic
  mahmyaing: "nova", // gentle narrator
  bogyi: "onyx", // deep suspense
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls TTS Pro to turn a script into narration audio and saves it to disk.
 * Retries a couple of times first — Render free-tier services can return a
 * transient 502 right after a cold start / redeploy, which isn't a real
 * failure of the TTS call itself.
 * @param {string} script - Burmese narration text
 * @param {string} voiceId - key from VOICES
 * @param {string} outPath - where to write the audio file
 * @returns {Promise<string>} outPath
 */
async function narrateWithTtsPro(script, voiceId, outPath) {
  const voice = VOICES[voiceId] || VOICES.hsayama;
  const MAX_ATTEMPTS = 3;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(process.env.TTS_PRO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: script,
          voice: voice.ttsVoice,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`TTS Pro request failed (${res.status}): ${text.slice(0, 300)}`);
      }

      // TTS Pro returns { audioBase64, mimeType, sampleRate, chunkCount }
      const data = await res.json();
      const base64 = data.audioBase64;
      if (!base64) throw new Error("TTS Pro response missing audioBase64");

      fs.writeFileSync(outPath, Buffer.from(base64, "base64"));
      return outPath;
    } catch (err) {
      lastErr = err;
      console.warn(`[narrate] TTS Pro attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message.slice(0, 200)}`);
      if (attempt < MAX_ATTEMPTS) await sleep(3000 * attempt);
    }
  }
  throw lastErr;
}

/**
 * Fallback narration via OpenAI's TTS API. Used automatically when
 * TTS Pro (Gemini) errors out — e.g. hits a 429 quota error.
 */
async function narrateWithOpenAI(script, voiceId, outPath) {
  const voice = OPENAI_FALLBACK_VOICE[voiceId] || "shimmer";

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: script,
      format: "wav",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI TTS fallback failed (${res.status}): ${text}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
  return outPath;
}

/**
 * Tries TTS Pro first (Myatko's own Gemini-based service); if that fails
 * for any reason, automatically falls back to OpenAI TTS so the pipeline
 * doesn't get blocked by Gemini quota issues.
 */
async function narrateScript(script, voiceId, outPath) {
  try {
    return await narrateWithTtsPro(script, voiceId, outPath);
  } catch (ttsProErr) {
    console.warn(`[narrate] TTS Pro failed, falling back to OpenAI TTS: ${ttsProErr.message}`);
    try {
      return await narrateWithOpenAI(script, voiceId, outPath);
    } catch (openaiErr) {
      throw new Error(
        `Both TTS Pro and OpenAI TTS failed. TTS Pro: ${ttsProErr.message} | OpenAI: ${openaiErr.message}`
      );
    }
  }
}

module.exports = { narrateScript };
