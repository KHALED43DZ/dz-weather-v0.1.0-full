const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// الجزائر على توقيت UTC+1 طوال السنة
export function algiersToday() {
  const d = new Date(Date.now() + 3600e3);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function dayInfo(offset) {
  const d = new Date(algiersToday().getTime() + offset * 86400e3);
  const dow = DAYS[d.getUTCDay()];
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()];
  const label = offset === 0 ? 'اليوم' : offset === 1 ? 'غداً' : offset === 2 ? 'بعد غد' : dow;
  return { offset, iso: d.toISOString().slice(0, 10), dow, day, month, label, short: `${day} ${month}`, full: `${dow} ${day} ${month}` };
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtSize(bytes) {
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

// عزل مقطع لاتيني/رقمي داخل نص عربي لمنع انعكاس ترتيبه
export const ltr = (s) => '\u2066' + s + '\u2069';
