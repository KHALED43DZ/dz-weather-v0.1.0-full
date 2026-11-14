import { DEFAULT_STYLE } from './config.js';

const SKEY = 'dzw.settings.v1';
const FKEY = 'dzw.forecast.v1';

export const DEFAULTS = {
  analysisKeys: '',
  ttsKeys: '',
  analysisModel: 'gemini-3.8-flash',
  analysisFallback: 'gemini-3.5-flash-lite',
  ttsModel: 'gemini-3.8-flash-lite-tts',
  ttsFallback: 'gemini-3.1-flash-tts-preview',
  customAnalysis: '',
  customTts: '',
  voice: 'Puck',
  stylePrompt: DEFAULT_STYLE,
  length: 'normal',
  orientation: 'vertical',
  ttsDelay: 2,
  presenter: 'عمي الطقس',
  introEnabled: true,
  chromaSim: 0.18,
  chromaSmooth: 0.12,
  chromaDespill: 0.8,
};

export function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const s = { ...getSettings(), ...patch };
  try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch { /* ignore */ }
  return s;
}

export function getForecastCache() {
  try { return JSON.parse(localStorage.getItem(FKEY) || 'null'); } catch { return null; }
}

export function setForecastCache(data) {
  try { localStorage.setItem(FKEY, JSON.stringify({ t: Date.now(), data })); } catch { /* ignore */ }
}
