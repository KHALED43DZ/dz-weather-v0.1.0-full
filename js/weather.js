import { WILAYAS, REGIONS } from './wilayas.js';
import { getForecastCache, setForecastCache } from './storage.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const DAILY = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
  'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max',
].join(',');
const MAX_AGE = 3 * 3600e3;

// تصنيف رموز WMO
export function catOf(wc) {
  if (wc == null || wc === 0) return 'clear';
  if (wc <= 2) return 'partly';
  if (wc === 3) return 'cloudy';
  if (wc === 45 || wc === 48) return 'fog';
  if (wc >= 95) return 'storm';
  if ((wc >= 71 && wc <= 77) || wc === 85 || wc === 86) return 'snow';
  if ((wc >= 51 && wc <= 67) || (wc >= 80 && wc <= 82)) return 'rain';
  return 'cloudy';
}

export const CAT_AR = {
  clear: 'صافي', partly: 'غيوم متفرقة', cloudy: 'غائم', fog: 'ضباب',
  rain: 'أمطار', snow: 'ثلوج', storm: 'عواصف رعدية',
};

const PRIORITY = ['storm', 'snow', 'rain', 'fog'];

function hex(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
const STOPS = [[-5, '#5B8DEF'], [5, '#3FB6D9'], [15, '#4CC38A'], [22, '#B7D84B'], [28, '#F2C230'], [34, '#F58A2E'], [40, '#E5412D'], [46, '#B3122E']];

export function tempColor(t) {
  if (t <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
      const u = (t - t0) / (t1 - t0);
      const a = hex(c0), b = hex(c1);
      return 'rgb(' + a.map((v, k) => Math.round(v + (b[k] - v) * u)).join(',') + ')';
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export async function fetchForecast(signal, { force = false } = {}) {
  const cached = getForecastCache();
  if (!force && cached && Date.now() - cached.t < MAX_AGE) return cached.data;
  const url = `${API}?latitude=${WILAYAS.map((w) => w.lat).join(',')}&longitude=${WILAYAS.map((w) => w.lon).join(',')}` +
    `&daily=${DAILY}&timezone=Africa%2FAlgiers&forecast_days=8`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error('Open-Meteo HTTP ' + res.status);
    let data = await res.json();
    if (!Array.isArray(data)) data = [data];
    if (data.length !== WILAYAS.length) throw new Error('بيانات الطقس ناقصة');
    setForecastCache(data);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    if (cached) return cached.data; // نستعمل آخر نسخة محفوظة عند انقطاع الشبكة
    throw new Error('تعذّر جلب بيانات الطقس من Open-Meteo — تحقق من الاتصال');
  }
}

const n0 = (v) => (v == null ? 0 : Math.round(v));
const n1 = (v) => (v == null ? 0 : Math.round(v * 10) / 10);

// لقطة يوم واحد لكل الولايات
export function daySnapshot(raw, offset) {
  const w = {};
  WILAYAS.forEach((wl, i) => {
    const d = raw[i].daily;
    w[wl.c] = {
      tx: n0(d.temperature_2m_max[offset]),
      tn: n0(d.temperature_2m_min[offset]),
      wc: d.weather_code[offset] ?? 0,
      pr: n1(d.precipitation_sum[offset]),
      pp: n0(d.precipitation_probability_max[offset]),
      wi: n0(d.wind_speed_10m_max[offset]),
      gu: n0(d.wind_gusts_10m_max[offset]),
    };
  });
  return { date: raw[0].daily.time[offset], w };
}

// ملخص لكل منطقة + ملخص وطني
export function summarize(snap) {
  const regions = {};
  for (const id of Object.keys(REGIONS)) regions[id] = { id, ar: REGIONS[id].ar, members: [] };
  for (const wl of WILAYAS) {
    const d = snap.w[wl.c];
    if (d) regions[wl.r].members.push({ c: wl.c, ar: wl.ar, ...d, cat: catOf(d.wc) });
  }
  const all = [];
  for (const r of Object.values(regions)) {
    const m = r.members;
    if (!m.length) continue;
    r.txMin = Math.min(...m.map((x) => x.tx)); r.txMax = Math.max(...m.map((x) => x.tx));
    r.tnMin = Math.min(...m.map((x) => x.tn)); r.tnMax = Math.max(...m.map((x) => x.tn));
    r.rainMax = Math.max(...m.map((x) => x.pr));
    r.windMax = Math.max(...m.map((x) => x.wi));
    r.gustMax = Math.max(...m.map((x) => x.gu));
    r.hottest = m.reduce((a, b) => (b.tx > a.tx ? b : a));
    r.coldest = m.reduce((a, b) => (b.tn < a.tn ? b : a));
    r.counts = {};
    for (const x of m) r.counts[x.cat] = (r.counts[x.cat] || 0) + 1;
    const need = Math.max(1, Math.ceil(m.length * 0.3));
    r.dominant = PRIORITY.find((k) => (r.counts[k] || 0) >= need);
    if (!r.dominant) {
      r.dominant = ['cloudy', 'partly', 'clear'].reduce((a, b) => ((r.counts[b] || 0) > (r.counts[a] || 0) ? b : a));
    }
    all.push(...m);
  }
  const by = (f) => all.reduce((a, b) => (f(b) > f(a) ? b : a));
  const national = {
    hottest: by((x) => x.tx),
    coldest: by((x) => -x.tn),
    windiest: by((x) => x.gu),
    rainy: all.filter((x) => x.pr >= 1).sort((a, b) => b.pr - a.pr).slice(0, 8),
    avgTx: Math.round(all.reduce((s, x) => s + x.tx, 0) / all.length),
    avgTn: Math.round(all.reduce((s, x) => s + x.tn, 0) / all.length),
  };
  return { regions, national };
}
