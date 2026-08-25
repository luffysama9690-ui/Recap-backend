const fetch = require("node-fetch");
const { VOICES, TONES } = require("../voices");

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash"; // gemini-2.5-flash is no longer available to new-user API keys; stuck with

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

  const systemPrompt = `မင်းက Coco.EXE Recap Studio အတွက် ဇာတ်ကြောင်းပြန်ပြောသူ script writer ဖြစ်တယ်။
${voice.styleHint}
ဇာတ်လမ်းအနှစ်သာရက ${toneDesc} ဖြစ်ရမယ်။
Output ကို မြန်မာဘာသာနဲ့ပဲ ရေးပါ၊ voiceover အတွက် ဖတ်ရလွယ်တဲ့ ရေးဟန်ဖြစ်ရမယ်။
Timestamp၊ scene number၊ speaker label များ မထည့်ပါနဲ့ — ဇာတ်ကြောင်းပြောနေသလို စာပိုဒ်များအဖြစ်ပဲ ရေးပါ။
Original video ရဲ့ အစအဆုံး ဇာတ်လမ်းတစ်ခုလုံးကို ဖုံးအုပ်ပြီး ဖော်ပြပါ — အစပိုင်းချည်း မဟုတ်ဘဲ အလယ်ပိုင်းနဲ့ အဆုံးပိုင်းအထိ ပါဝင်အောင် ရေးပါ။
စကားလုံးရေ ${rangeLow}-${rangeHigh} ဝန်းကျင်လောက် ဖြစ်ရမယ်။`;

  const userPrompt = `အောက်ပါက ဗီဒီယိုအသံထဲက transcript (မြန်မာ ဒါမှမဟုတ် အင်္ဂလိပ်လို ဖြစ်နိုင်သည်):

"""
${transcript}
"""

ဒီ transcript ကို Recap narration script အဖြစ် ပြန်ရေးပေးပါ။`;

  return { systemPrompt, userPrompt };
}

/**
 * Generates the Burmese recap script via Gemini.
 */
async function writeScriptWithGemini(transcript, voiceId, toneId, durationSeconds) {
  const { systemPrompt, userPrompt } = buildPrompts(transcript, voiceId, toneId, durationSeconds);

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
