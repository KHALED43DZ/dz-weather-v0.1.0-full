// ثوابت التطبيق — غيّر VERSION عند كل تحديث (وانسخه أيضاً إلى sw.js)
export const VERSION = '0.2.1';
export const BUILD_DATE = '2026-11-14';
export const APP_TITLE = 'نشرة الطقس · الجزائر';

export const COST_LABEL = { free: '🟢 مجاني', paid: '🔴 مدفوع' };
export const SPEED_LABEL = { fast: '⚡ سريع', mid: '⏱ متوسط', slow: '🐢 بطيء' };

// الشارات (مجاني/مدفوع) مأخوذة من قائمة النماذج في AI Studio وقت إصدار التطبيق، والسرعة تقديرية.
export const ANALYSIS_MODELS = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', cost: 'free', speed: 'fast', note: 'الأذكى بين نماذج Flash — الاختيار الافتراضي' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', cost: 'free', speed: 'fast', note: 'الأسرع والأرخص — ممتاز كنموذج احتياطي' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', cost: 'free', speed: 'fast', note: 'خفيف وسريع' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', cost: 'free', speed: 'slow', note: 'تفكير أعمق لكنه أبطأ، وحصته المجانية عادة أضيق' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', cost: 'paid', speed: 'fast', note: 'يتطلب حساباً مدفوعاً' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', cost: 'paid', speed: 'fast', note: 'قديم — يتطلب حساباً مدفوعاً' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', cost: 'paid', speed: 'slow', note: 'قوي جداً لكنه مدفوع وبطيء' },
  { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', cost: 'paid', speed: 'slow', note: 'الأحدث والأقوى — مدفوع وبطيء' },
];

export const TTS_MODELS = [
  { id: 'gemini-3.8-flash-lite-tts', name: 'Gemini 3.8 Flash Lite TTS', cost: 'free', speed: 'fast', note: 'الأحدث والأسرع — الافتراضي' },
  { id: 'gemini-3.1-flash-tts-preview', name: 'Gemini 3.1 Flash TTS Preview', cost: 'free', speed: 'mid', note: 'يدعم وسوم التعبير الصوتي — جرّبه للمقارنة' },
];

export const VOICES = [
  { id: 'Puck', ar: 'Puck — مرح ونشيط' },
  { id: 'Fenrir', ar: 'Fenrir — متحمس' },
  { id: 'Charon', ar: 'Charon — رصين ومعلوماتي' },
  { id: 'Orus', ar: 'Orus — حازم' },
  { id: 'Kore', ar: 'Kore — قوي وواضح' },
  { id: 'Zephyr', ar: 'Zephyr — ساطع' },
  { id: 'Aoede', ar: 'Aoede — خفيف' },
  { id: 'Leda', ar: 'Leda — شاب' },
  { id: 'Achird', ar: 'Achird — ودود' },
  { id: 'Sulafat', ar: 'Sulafat — دافئ' },
  { id: 'Algieba', ar: 'Algieba — ناعم' },
  { id: 'Umbriel', ar: 'Umbriel — مسترخٍ' },
];

export const DEFAULT_STYLE =
  'Speak in a warm, cheerful, witty Algerian Arabic (Darija) accent, like a friendly neighborhood TV weather presenter, with natural pacing and clear pronunciation';
