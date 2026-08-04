const fs = require("fs");
const FormData = require("form-data");
const fetch = require("node-fetch");

/**
 * Sends an audio file to OpenAI's Whisper API and returns the transcript text.
 * @param {string} audioPath - path to a local audio file (mp3/wav/m4a etc.)
 * @returns {Promise<string>} transcript
 */
async function transcribeAudio(audioPath) {
  const form = new FormData();
  form.append("file", fs.createReadStream(audioPath));
  form.append("model", "whisper-1");
  // Leaving language unset lets Whisper auto-detect; most recap source
  // clips will be Burmese or English dub, both work fine auto-detected.

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

module.exports = { transcribeAudio };
