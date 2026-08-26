// Keep this in sync with the frontend's VOICES list (src/components/RecapUpload.jsx)
const VOICES = {
  hsayama: {
    name: "Hsayama",
    ttsVoice: "Callirrhoe",
    styleHint: "Speak like a slow-paced, warm, seasoned storyteller.",
  },
  kolay: {
    name: "Kolay",
    ttsVoice: "Puck",
    styleHint: "Speak in a lively, youthful commentary style.",
  },
  mahmyaing: {
    name: "Mahmyaing",
    ttsVoice: "Aoede",
    styleHint: "Speak like a soft, emotive storyteller.",
  },
  bogyi: {
    name: "Bogyi",
    ttsVoice: "Orus",
    styleHint: "Speak in a deep, intense thriller-narrator style.",
  },
  yamin: {
    name: "Yamin",
    ttsVoice: "Kore",
    styleHint: "Speak in a firm, confident female-narrator style.",
  },
  koaung: {
    name: "Ko Aung",
    ttsVoice: "Fenrir",
    styleHint: "Speak in an exciting, high-energy action-commentary style.",
  },
  koko: {
    name: "Ko Ko",
    ttsVoice: "Charon",
    styleHint: "Speak in a clear, informative news-anchor style.",
  },
  maley: {
    name: "Ma Lay",
    ttsVoice: "Leda",
    styleHint: "Speak in a young, lively female-voice style.",
  },
};

const TONES = {
  suspense: "tense and thrilling",
  comedy: "funny and lighthearted",
  emotional: "intensely emotional, heartfelt",
  epic: "grand and dramatic",
};

module.exports = { VOICES, TONES };
