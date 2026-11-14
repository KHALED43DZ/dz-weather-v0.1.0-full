import { sleep } from './util.js';
import { b64ToBytes, pcmToWav } from './audio.js';

const ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_WAIT = 70000; // أقصى انتظار لمفاتيح في استراحة (ملّي ثانية)

export class GeminiError extends Error {
  constructor(msg, { status = 0, retry = 0, code = '' } = {}) {
    super(msg);
    this.name = 'GeminiError';
    this.status = status; this.retry = retry; this.code = code;
  }
}

export function parseKeys(text) {
  return [...new Set(String(text || '').split(/[\s,;]+/).map((s) => s.trim()).filter((k) => k.length >= 20))];
}
export const maskKey = (k) => k.slice(0, 6) + '…' + k.slice(-4);

// حالة المفاتيح خلال الجلسة
const cool = new Map();   // "key|model" -> وقت انتهاء الاستراحة
const dead = new Set();   // مفاتيح مرفوضة
const cursor = { analysis: 0, tts: 0 };
export function resetKeyState() { cool.clear(); dead.clear(); }

async function post(model, key, body, signal) {
  let res;
  try {
    res = await fetch(`${ROOT}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new GeminiError('تعذّر الاتصال بالشبكة', { status: 0 });
  }
  let data = null;
  try { data = await res.json(); } catch { /* no json */ }
  if (!res.ok) {
    const err = (data && data.error) || {};
    let retry = 0;
    const d = (err.details || []).find((x) => x && x.retryDelay);
    if (d) retry = parseFloat(d.retryDelay) || 0;
    throw new GeminiError(err.message || 'HTTP ' + res.status, { status: res.status, retry, code: err.status || '' });
  }
  return data;
}

function pickKey(kind, keys, model) {
  const n = keys.length;
  let soonest = Infinity, alive = 0;
  for (let i = 0; i < n; i++) {
    const idx = (cursor[kind] + i) % n;
    const k = keys[idx];
    if (dead.has(k)) continue;
    alive++;
    const until = cool.get(k + '|' + model) || 0;
    if (until <= Date.now()) return { key: k, idx };
    soonest = Math.min(soonest, until);
  }
  return { none: true, alive, wait: soonest - Date.now() };
}

// تدوير المفاتيح + نموذج احتياطي
async function rotate({ kind, keys, models, call, onStatus = () => {}, signal }) {
  if (!keys.length) throw new GeminiError('لا توجد مفاتيح — أضفها من الإعدادات', { status: -1 });
  let lastErr = null;
  for (const model of models.filter(Boolean)) {
    let attempts = 0;
    const max = keys.length * 2 + 2;
    while (attempts < max) {
      if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const pick = pickKey(kind, keys, model);
      if (pick.none) {
        if (!pick.alive) throw lastErr || new GeminiError('كل المفاتيح مرفوضة — تحقق منها', { status: 403 });
        if (pick.wait > MAX_WAIT) break; // جرّب النموذج التالي
        onStatus(`كل المفاتيح في استراحة — ننتظر ${Math.ceil(pick.wait / 1000)} ثانية…`);
        await sleep(pick.wait + 300, signal);
        continue;
      }
      attempts++;
      try {
        const out = await call(pick.key, model);
        cursor[kind] = (pick.idx + 1) % keys.length;
        return { ...out, model, keyIndex: pick.idx + 1 };
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        lastErr = e;
        const st = e.status;
        const tag = `المفتاح ${pick.idx + 1} · ${model}`;
        if (st === 429) {
          const ms = Math.max(15, e.retry || 45) * 1000;
          cool.set(pick.key + '|' + model, Date.now() + ms);
          cursor[kind] = (pick.idx + 1) % keys.length;
          onStatus(`${tag}: بلغ حدّ الاستعمال — ننتقل لمفتاح آخر`);
        } else if (st === 403 || (st === 400 && /api key|API_KEY/i.test(e.message || ''))) {
          dead.add(pick.key);
          onStatus(`${tag}: المفتاح مرفوض`);
        } else if (st === 404) {
          onStatus(`${model}: النموذج غير متاح — نجرّب البديل`);
          break;
        } else if (st === 0 || st >= 500) {
          cool.set(pick.key + '|' + model, Date.now() + 4000);
          onStatus(`${tag}: خلل مؤقت — نعيد المحاولة`);
          await sleep(1200, signal);
        } else {
          throw e; // 400 أو غيره: الطلب نفسه مرفوض
        }
      }
    }
  }
  throw lastErr || new GeminiError('فشلت كل المحاولات', { status: 500 });
}

function textOf(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
}

export async function generateScript({ keys, models, system, user, onStatus, signal }) {
  return rotate({
    kind: 'analysis', keys, models, onStatus, signal,
    call: async (key, model) => {
      const data = await post(model, key, {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 1.0, responseMimeType: 'application/json' },
      }, signal);
      const text = textOf(data);
      if (!text) {
        const br = data?.promptFeedback?.blockReason;
        throw new GeminiError(br ? 'رفض النموذج الطلب: ' + br : 'ردّ فارغ من النموذج', { status: br ? 400 : 500 });
      }
      return { text };
    },
  });
}

export async function generateSpeech({ keys, models, text, voice, style, onStatus, signal }) {
  const prompt = style ? `${style}: ${text}` : text;
  return rotate({
    kind: 'tts', keys, models, onStatus, signal,
    call: async (key, model) => {
      const data = await post(model, key, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || 'Puck' } } },
        },
      }, signal);
      const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData && p.inlineData.data);
      if (!part) throw new GeminiError('لم يُرجع النموذج صوتاً', { status: 500 });
      const mime = part.inlineData.mimeType || '';
      const bytes = b64ToBytes(part.inlineData.data);
      if (/wav/i.test(mime)) {
        const dv = new DataView(bytes.buffer);
        const rate = dv.getUint32(24, true) || 24000;
        return { wav: new Blob([bytes], { type: 'audio/wav' }), duration: (bytes.length - 44) / 2 / rate, rate };
      }
      const m = /rate=(\d+)/i.exec(mime);
      const { blob, duration } = pcmToWav(bytes, m ? +m[1] : 24000);
      return { wav: blob, duration, rate: m ? +m[1] : 24000 };
    },
  });
}

// فحص صلاحية المفاتيح عبر قائمة النماذج (لا يستهلك من الحصة)
export async function testKeys(keys, signal) {
  const out = [];
  for (const k of keys) {
    try {
      const res = await fetch(`${ROOT}/models?pageSize=1`, { headers: { 'x-goog-api-key': k }, signal });
      if (res.ok) out.push({ key: maskKey(k), ok: true, msg: 'يعمل' });
      else {
        let m = 'HTTP ' + res.status;
        try { m = (await res.json()).error.message || m; } catch { /* ignore */ }
        out.push({ key: maskKey(k), ok: false, msg: m.slice(0, 90) });
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      out.push({ key: maskKey(k), ok: false, msg: 'تعذّر الاتصال' });
    }
  }
  return out;
}
