// Keep this in sync with the frontend's VOICES list (src/components/RecapUpload.jsx)
const VOICES = {
  hsayama: {
    name: "ဆရာမကြီး",
    ttsVoice: "Callirrhoe",
    styleHint: "နှေးညောင်း၊ လေးနက်တဲ့ ပုံပြင်ဆရာမတစ်ယောက်လို ပြောပါ",
  },
  kolay: {
    name: "ကိုလေး",
    ttsVoice: "Puck",
    styleHint: "သွက်လက်၊ လူငယ်ဆန်တဲ့ commentary style နဲ့ ပြောပါ",
  },
  mahmyaing: {
    name: "မမြိုင်",
    ttsVoice: "Aoede",
    styleHint: "ညင်သာ၊ ခံစားစေတဲ့ ဇာတ်ကြောင်းပြောသူလို ပြောပါ",
  },
  bogyi: {
    name: "ဘိုကြီး",
    ttsVoice: "Orus",
    styleHint: "နက်ရှိုင်း၊ တင်းမာတဲ့ thriller narrator style နဲ့ ပြောပါ",
  },
};

const TONES = {
  suspense: "တင်းမာဖွယ်ကောင်းတဲ့၊ စိတ်လှုပ်ရှားစေတဲ့",
  comedy: "ရယ်စရာကောင်းတဲ့၊ ပေါ့ပေါ့ပါးပါး",
  emotional: "ခံစားချက်ပြင်းထန်တဲ့၊ နှလုံးသားကို ထိမိတဲ့",
  epic: "ဒရာမာကြီးဆန်တဲ့၊ ကြီးကျယ်တဲ့",
};

module.exports = { VOICES, TONES };
