const fetch = require("node-fetch");
const { VOICES, TONES } = require("../voices");

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash"; // gemini-2.5-flash is no longer available to new-user API keys; stuck with

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_ATTEMPTS = 3;

// 503 ("model overloaded") and similar 5xx/429 are transient — retry a
// couple of times before giving up or falling back to OpenAI.
async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = /\b(429|500|502|503|504)\b/.test(err.message);
      console.warn(`[script] ${label} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message.slice(0, 200)}`);
      if (!retryable || attempt >= MAX_ATTEMPTS) break;
      await sleep(3000 * attempt);
    }
  }
  throw lastErr;
}

// Narration length now scales with the source video's duration instead of
// a fixed 150-300 words, so the final merged video (which is trimmed to
// match the narration via -shortest in ffmpegTasks.js) ends up close to
// the original video's length instead of always ~1-2 minutes.
const WORDS_PER_MINUTE = 160; // rough Burmese narration speaking pace
const MIN_TARGET_WORDS = 150;
// Cap narration length even for very long source videos — otherwise a
// 2-hour video would generate a ~24,000-word script, blowing up TTS cost
// and render time. 15 minutes of narration is already a substantial recap.
const MAX_NARRATION_SECONDS = 900; // 15 minutes

function computeTargetWordCount(durationSeconds) {
  const cappedSeconds = Math.min(durationSeconds || 0, MAX_NARRATION_SECONDS);
  const words = Math.round((cappedSeconds / 60) * WORDS_PER_MINUTE);
  return Math.max(words, MIN_TARGET_WORDS);
}

function buildPrompts(transcript, voiceId, toneId, durationSeconds) {
  const voice = VOICES[voiceId] || VOICES.hsayama;
  const toneDesc = TONES[toneId] || TONES.suspense;
  const targetWords = computeTargetWordCount(durationSeconds);
  const rangeLow = Math.round(targetWords * 0.9);
  const rangeHigh = Math.round(targetWords * 1.1);

  const systemPrompt = `You are a recap narration script writer for Coco.EXE Recap Studio.
${voice.styleHint}
The story's overall mood should be ${toneDesc}.
Write the output in Burmese (မြန်မာဘာသာ) only, in a style that reads naturally when read aloud as a voiceover.
Do not include timestamps, scene numbers, or speaker labels — write it as flowing narration paragraphs, like someone telling the story.
Cover the whole story from beginning to end — don't just narrate the opening; include the middle and the ending too.
The script should be roughly ${rangeLow}-${rangeHigh} words long.`;

  const userPrompt = `Here is the transcript from the video's audio (it may be in Burmese, English, Chinese, or another language):

"""
${transcript}
"""

Rewrite this transcript as a recap narration script.`;

  return { systemPrompt, userPrompt };
}

/**
 * Generates the Burmese recap script via Gemini.
 */
async function writeScriptWithGemini(transcript, voiceId, toneId, durationSeconds) {
  const { systemPrompt, userPrompt } = buildPrompts(transcript, voiceId, toneId, durationSeconds);

  return withRetry(async () => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.8 },
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gemini script generation failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    const script = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!script) throw new Error("Gemini script generation returned empty content");
    return script;
  }, "Gemini script");
}

/**
 * Fallback: OpenAI's GPT-4o-mini. Used automatically if Gemini fails and
 * an OPENAI_API_KEY is configured.
 */
async function writeScriptWithOpenAI(transcript, voiceId, toneId, durationSeconds) {
  const { systemPrompt, userPrompt } = buildPrompts(transcript, voiceId, toneId, durationSeconds);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Script generation failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const script = data.choices?.[0]?.message?.content?.trim();
  if (!script) throw new Error("Script generation returned empty content");
  return script;
}

/**
 * Turns a raw video transcript into a Burmese recap narration script,
 * matching the chosen narrator voice and tone. Script length scales with
 * durationSeconds (the source video's length) so the final video — which
 * gets trimmed to the narration's length — ends up close to the original
 * video's duration instead of a fixed short clip. Tries Gemini first (if
 * GEMINI_API_KEY is set); falls back to OpenAI (if OPENAI_API_KEY is set).
 * @param {string} transcript
 * @param {string} voiceId - key from VOICES
 * @param {string} toneId - key from TONES
 * @param {number} durationSeconds - source video duration, for script length scaling
 * @returns {Promise<string>} Burmese narration script
 */
async function writeScript(transcript, voiceId, toneId, durationSeconds) {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (hasGemini) {
    try {
      return await writeScriptWithGemini(transcript, voiceId, toneId, durationSeconds);
    } catch (geminiErr) {
      console.warn(`[script] Gemini failed: ${geminiErr.message}`);
      if (!hasOpenAI) throw geminiErr;
      console.warn("[script] Falling back to OpenAI");
      try {
        return await writeScriptWithOpenAI(transcript, voiceId, toneId, durationSeconds);
      } catch (openaiErr) {
        throw new Error(
          `Both Gemini and OpenAI failed. Gemini: ${geminiErr.message} | OpenAI: ${openaiErr.message}`
        );
      }
    }
  }

  if (hasOpenAI) return writeScriptWithOpenAI(transcript, voiceId, toneId, durationSeconds);

  throw new Error("No GEMINI_API_KEY or OPENAI_API_KEY configured for script generation");
}

module.exports = { writeScript };
