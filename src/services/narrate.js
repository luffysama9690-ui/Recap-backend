const fs = require("fs");
const fetch = require("node-fetch");
const { VOICES } = require("../voices");

/**
 * Calls TTS Pro to turn a script into narration audio and saves it to disk.
 * @param {string} script - Burmese narration text
 * @param {string} voiceId - key from VOICES
 * @param {string} outPath - where to write the audio file
 * @returns {Promise<string>} outPath
 */
async function narrateScript(script, voiceId, outPath) {
  const voice = VOICES[voiceId] || VOICES.hsayama;

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
    throw new Error(`TTS Pro request failed (${res.status}): ${text}`);
  }

  // TTS Pro returns { audioBase64, mimeType, sampleRate, chunkCount }
  const data = await res.json();
  const base64 = data.audioBase64;
  if (!base64) throw new Error("TTS Pro response missing audioBase64");

  fs.writeFileSync(outPath, Buffer.from(base64, "base64"));
  return outPath;
}

module.exports = { narrateScript };
