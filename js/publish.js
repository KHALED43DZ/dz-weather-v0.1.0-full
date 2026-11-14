// نصوص النشر: وصف تيك توك + عنوان ووصف يوتيوب Shorts (بالفصحى المبسطة)
import { CAT_AR } from './weather.js';

const strip = (t) => {
  t = String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
};
const oneLine = (s) => String(s || '').replace(/[*_`#]+(?=\S)/g, (m) => m).replace(/\s+/g, ' ').trim();
const multi = (s) => String(s || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

export function buildPublishPrompt({ dateFull, headline, script, summary }) {
  const system = [
    'أنت محرر محتوى لقناة نشرة طقس جزائرية على تيك توك ويوتيوب Shorts.',
    'اكتب بالعربية الفصحى المبسّطة الواضحة: بلا عامية ولا دارجة، وبأسلوب حيوي وودود.',
    'قواعد صارمة:',
    '1) استعمل فقط الأرقام والمعطيات المذكورة في الرسالة. ممنوع اختراع درجات حرارة أو أمطار أو مدن.',
    '2) لا تعد بشيء مبالغ فيه ولا تستعمل عناوين مضلِّلة.',
    '3) الإيموجي مسموح بقدر قليل (من واحد إلى ثلاثة في الوصف، وواحد على الأكثر في العنوان).',
    '4) أخرج JSON صالحاً فقط بلا شرح ولا علامات ```.',
  ].join('\n');

  const n = summary.national;
  const lines = [];
  lines.push(`التاريخ: ${dateFull}`);
  lines.push(`عنوان الفيديو: ${headline || 'نشرة الطقس'}`);
  lines.push(`وطنياً: الأسخن ${n.hottest.ar} (${n.hottest.tx}°) — الأبرد ليلاً ${n.coldest.ar} (${n.coldest.tn}°) — متوسط العظمى ${n.avgTx}° — ` +
    (n.rainy.length ? 'أمطار في: ' + n.rainy.slice(0, 5).map((x) => x.ar).join('، ') : 'لا أمطار تُذكر'));
  for (const r of Object.values(summary.regions)) {
    if (!r.members.length) continue;
    lines.push(`${r.ar}: من ${r.txMin}° إلى ${r.txMax}°، السائد: ${CAT_AR[r.dominant]}`);
  }
  lines.push('');
  lines.push('نص النشرة المصوَّرة (للاطلاع على النقاط البارزة فقط):');
  lines.push([script.intro, ...script.segments.map((s) => s.text)].join(' '));
  lines.push('');
  lines.push('المطلوب:');
  lines.push('• tiktok.caption: وصف لتيك توك لا يتجاوز 300 حرف بما فيه الوسوم. السطر الأول جملة جاذبة قصيرة (سؤال أو معلومة لافتة من الطقس)، ثم سطران قصيران، ثم دعوة للمتابعة والتعليق، ثم من 4 إلى 5 وسوم تتضمن #طقس_الجزائر.');
  lines.push('• shorts.title: عنوان ليوتيوب Shorts لا يتجاوز 70 حرفاً، يتضمن «طقس الجزائر» واليوم أو التاريخ، ويعكس أبرز ما في النشرة بصدق.');
  lines.push('• shorts.description: وصف من جملتين إلى ثلاث بأهم المعلومات (الأسخن والأبرد ومناطق الأمطار إن وجدت)، ثم دعوة للاشتراك، ثم سطر فارغ، ثم من 3 إلى 5 وسوم يجب أن تتضمن #Shorts و#طقس_الجزائر.');
  lines.push('');
  lines.push('أرجع بهذا الشكل بالضبط:');
  lines.push('{"tiktok":{"caption":"..."},"shorts":{"title":"...","description":"..."}}');
  return { system, user: lines.join('\n') };
}

function trimWords(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const i = cut.lastIndexOf(' ');
  return (i > max * 0.6 ? cut.slice(0, i) : cut).replace(/[،,:؛\-–—\s]+$/, '');
}

export function parsePublish(raw) {
  let j;
  try { j = JSON.parse(strip(raw)); } catch { throw new Error('ردّ النموذج ليس JSON صالحاً — أعد المحاولة'); }
  let caption = multi(j && j.tiktok && j.tiktok.caption);
  let title = oneLine(j && j.shorts && j.shorts.title);
  let desc = multi(j && j.shorts && j.shorts.description);
  if (!caption || !title || !desc) throw new Error('النموذج لم يُرجع كل النصوص المطلوبة — أعد المحاولة');
  title = trimWords(title, 100);
  if (!/#/.test(caption)) caption += '\n#طقس_الجزائر #الجزائر #نشرة_الطقس';
  if (!/#Shorts/i.test(desc)) desc += (/#/.test(desc) ? ' ' : '\n\n') + '#Shorts';
  if (!/#طقس_الجزائر/.test(desc)) desc += ' #طقس_الجزائر';
  return { tiktok: caption, title, description: desc };
}
