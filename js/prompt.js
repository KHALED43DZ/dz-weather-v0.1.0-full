import { REGIONS, WBYCODE } from './wilayas.js';
import { CAT_AR } from './weather.js';

export const LENGTHS = {
  short: { label: 'قصيرة (حوالي دقيقة)', segments: 4, words: '110 إلى 160' },
  normal: { label: 'عادية (حوالي دقيقتين)', segments: 6, words: '240 إلى 320' },
  full: { label: 'كاملة (3 إلى 4 دقائق)', segments: 10, words: '430 إلى 560' },
};

export function buildPrompt({ summary, length, presenter, bday, tday, recap }) {
  const L = LENGTHS[length] || LENGTHS.normal;
  const system = [
    `أنت «${presenter}»، مذيع نشرة طقس جزائري ظريف وخفيف الدم، تتكلم بالدارجة الجزائرية (مكتوبة بالحروف العربية) كأنك تحكي مع أولاد الحومة، لكن بأدب واحترام.`,
    'قواعد صارمة:',
    '1) استعمل فقط الأرقام والمعطيات الواردة في البيانات. ممنوع اختراع درجات حرارة أو أمطار أو رياح أو مناطق.',
    '2) اكتب كل الأرقام بالحروف كما تُنطق (مثال: «ثمانية وعشرين درجة») لأن النص سيُقرأ بصوت آلي.',
    '3) استعمل الحروف العربية فقط (اكتب ق بدل ڤ)، بلا إيموجي ولا رموز ولا أقواس ولا نجوم ولا كلمات إنجليزية.',
    '4) الطرافة خفيفة وذكية: تشبيهات وأمثال جزائرية بسيطة، بلا سخرية من منطقة أو شخص أو دين، وبلا ألفاظ نابية ولا سياسة.',
    '5) لا تذكر «الشهيلي» إلا إذا كانت الحرارة العظمى 38 فأكثر في ولايات الشمال.',
    '6) جمل قصيرة سهلة النطق، وكل مقطع مستقل يُفهم وحده.',
    '7) أخرج JSON صالحاً فقط، بلا شرح ولا علامات ```.',
    '8) النشرة تُبثّ مساءً. التزم بالتواريخ والأيام المعطاة بالضبط: «اليوم» هو يوم البث، و«الغد» هو يوم التوقعات. ممنوع ذكر أي يوم آخر بالاسم، وممنوع قول «بعد غد».',
    '9) أدرج العبارات المألوفة في نشرات الأحوال الجوية العربية بنكهة الدارجة، مثل: «غداً بحول الله»، «أمطار إن شاء الله»، «تكون السماء غائمة جزئياً»، «ترتفع درجات الحرارة»، «تتراوح الحرارة بين … و…»، «رياح نشطة»، «نوصي بالحذر على الطرقات»، «وفق ما تشير إليه التوقعات». التوقعات احتمال لا يقين، فاقرنها بـ«بحول الله» أو «إن شاء الله».',
    '10) اختم الخاتمة دائماً بعبارة «والله أعلم».',
  ].join('\n');

  const natLine = (n) =>
    `الأسخن ${n.hottest.ar} (${n.hottest.tx}) — الأبرد ليلاً ${n.coldest.ar} (${n.coldest.tn}) — متوسط العظمى ${n.avgTx} والصغرى ${n.avgTn} — ` +
    (n.rainy.length ? 'أمطار في: ' + n.rainy.map((x) => `${x.ar} ${x.pr}`).join('، ') : 'لا أمطار تُذكر') +
    ` — أقوى هبّات ريح ${n.windiest.ar} (${n.windiest.gu})`;
  const n = summary.national;
  const tw = `غداً ${tday.dow}`;
  const lines = [];
  lines.push(`تاريخ البث (هذا المساء): اليوم ${bday.full}.`);
  lines.push(`يوم التوقعات: غداً ${tday.full}. كل المقاطع الإقليمية والخاتمة عن توقعات غداً ${tday.dow} فقط.`);
  lines.push(`لا تذكر من أسماء الأيام إلا «${bday.dow}» (اليوم) و«${tday.dow}» (الغد).`);
  lines.push(`المطلوب: نشرة ${L.label}: مقدمة + ${L.segments} مقاطع إقليمية + خاتمة، مجموع الكلمات ${L.words} كلمة تقريباً.`);
  if (L.segments < 10) {
    lines.push(`اختر ${L.segments} مناطق من القائمة (الأهم: أمطار أو ثلوج أو حرارة قصوى أو برد أو رياح قوية)، وما لم تذكره لخّصه في المقدمة بجملة.`);
  } else {
    lines.push('اذكر المناطق العشر كلها، كل منطقة في مقطع واحد، بالترتيب نفسه.');
  }
  lines.push('');
  lines.push('المعطيات (حرارة مئوية، مطر بالملم، رياح كم/س):');
  if (recap) lines.push(`لمحة عن اليوم ${bday.dow} (للافتتاح فقط): ${natLine(recap.summary.national)}`);
  lines.push(`وطنياً (توقعات ${tw}): ${natLine(n)}`);
  for (const r of Object.values(summary.regions)) {
    if (!r.members.length) continue;
    lines.push(
      `[${r.id}] ${r.ar}: العظمى من ${r.txMin} إلى ${r.txMax}، الصغرى من ${r.tnMin} إلى ${r.tnMax}، السائد: ${CAT_AR[r.dominant]}، ` +
        `أقصى مطر ${r.rainMax}، أقصى رياح ${r.windMax} (هبّات ${r.gustMax})`
    );
    lines.push(
      '   الولايات: ' +
        r.members.map((m) => `${m.c}=${m.ar} (${m.tx}/${m.tn}، ${CAT_AR[m.cat]}${m.pr >= 0.2 ? '، مطر ' + m.pr : ''})`).join(' ؛ ')
    );
  }
  lines.push('');
  lines.push('أرجع JSON بهذا الشكل بالضبط:');
  lines.push('{"headline":"عنوان قصير من ثلاث إلى ست كلمات يظهر على الفيديو","intro":"نص المقدمة",');
  lines.push(' "segments":[{"region":"معرّف المنطقة من القائمة","spotlight":[رموز 2 إلى 4 ولايات من نفس المنطقة تستحق الإبراز],"text":"نص المقطع"}],');
  lines.push(' "outro":"نص الخاتمة"}');
  if (recap) {
    lines.push(`المقدمة: تحية مسائية مرحة باسمك، ثم لمحة قصيرة جداً (جملتان إلى ثلاث) عن أحداث طقس اليوم ${bday.dow} بصيغة الماضي القريب اعتماداً على «لمحة عن اليوم» فقط، ثم جملة ربط ظريفة تنتقل بها إلى توقعات ${tw} («غداً بحول الله…») مع صورة عامة عن الجو في البلاد. لا تخلط أرقام اليوم بأرقام الغد.`);
  } else {
    lines.push(`المقدمة: تحية مسائية مرحة باسمك، ثم صورة عامة عن توقعات ${tw} («غداً بحول الله…»).`);
  }
  lines.push('الخاتمة: وداع ظريف مع نصيحة قصيرة، وتنتهي بعبارة «والله أعلم».');
  return { system, user: lines.join('\n') };
}

function stripFences(t) {
  t = String(t || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}

const clean = (s) => String(s || '').replace(/[*_#`\[\]()]/g, '').replace(/\s+/g, ' ').trim();

// تحويل ردّ Gemini إلى نص نشرة سليم
export function parseScript(raw, summary) {
  let j;
  try { j = JSON.parse(stripFences(raw)); } catch { throw new Error('ردّ النموذج ليس JSON صالحاً — أعد المحاولة'); }
  const segs = [];
  for (const s of Array.isArray(j.segments) ? j.segments : []) {
    if (!s || !REGIONS[s.region] || !clean(s.text)) continue;
    const r = summary.regions[s.region];
    let spot = (Array.isArray(s.spotlight) ? s.spotlight : []).map(Number)
      .filter((c) => WBYCODE[c] && WBYCODE[c].r === s.region);
    spot = [...new Set(spot)].slice(0, 4);
    if (!spot.length && r && r.members.length) {
      spot = [...new Set([r.hottest.c, r.coldest.c, r.members.reduce((a, b) => (b.pr > a.pr ? b : a)).c])].slice(0, 3);
    }
    segs.push({ region: s.region, spotlight: spot, text: clean(s.text) });
  }
  if (!segs.length) throw new Error('لم يُرجع النموذج أي مقطع إقليمي صالح — أعد المحاولة');
  const intro = clean(j.intro), outro = clean(j.outro);
  if (!intro) throw new Error('المقدمة ناقصة في ردّ النموذج — أعد المحاولة');
  let out = outro || 'بالسلامة يا أحبابي، ونلتقو في نشرة أخرى إن شاء الله.';
  if (!/والله أعلم/.test(out)) out = out.replace(/[.!؟،\s]+$/, '') + '، والله أعلم.';
  return { headline: clean(j.headline).slice(0, 60), intro, segments: segs, outro: out };
}
