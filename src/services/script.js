const fetch = require("node-fetch");
const { VOICES, TONES } = require("../voices");

/**
 * Turns a raw video transcript into a short Burmese recap narration script,
 * matching the chosen narrator voice and tone.
 * @param {string} transcript
 * @param {string} voiceId - key from VOICES
 * @param {string} toneId - key from TONES
 * @returns {Promise<string>} Burmese narration script
 */
async function writeScript(transcript, voiceId, toneId) {
  const voice = VOICES[voiceId] || VOICES.hsayama;
  const toneDesc = TONES[toneId] || TONES.suspense;

  const systemPrompt = `မင်းက Coco.EXE Recap Studio အတွက် ဇာတ်ကြောင်းပြန်ပြောသူ script writer ဖြစ်တယ်။
${voice.styleHint}
ဇာတ်လမ်းအနှစ်သာရက ${toneDesc} ဖြစ်ရမယ်။
Output ကို မြန်မာဘာသာနဲ့ပဲ ရေးပါ၊ voiceover အတွက် ဖတ်ရလွယ်တဲ့ ရေးဟန်ဖြစ်ရမယ်။
Timestamp၊ scene number၊ speaker label များ မထည့်ပါနဲ့ — ဇာတ်ကြောင်းပြောနေသလို စာပိုဒ်များအဖြစ်ပဲ ရေးပါ။
စကားလုံးရေ ၁၅၀-၃၀၀ ဝန်းကျင်လောက် ဖြစ်ရမယ်။`;

  const userPrompt = `အောက်ပါက ဗီဒီယိုအသံထဲက transcript (မြန်မာ ဒါမှမဟုတ် အင်္ဂလိပ်လို ဖြစ်နိုင်သည်):

"""
${transcript}
"""

ဒီ transcript ကို Recap narration script အဖြစ် ပြန်ရေးပေးပါ။`;

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

module.exports = { writeScript };
