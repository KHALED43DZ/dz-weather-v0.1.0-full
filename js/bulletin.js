// أدوات صغيرة للتعامل مع سجلّ النشرة
export function itemsOf(script) {
  if (!script) return [];
  return [
    { key: 'intro', kind: 'intro', region: 'all', spotlight: [], text: script.intro },
    ...script.segments.map((s, i) => ({ key: 's' + i, kind: 'seg', region: s.region, spotlight: s.spotlight || [], text: s.text })),
    { key: 'outro', kind: 'outro', region: 'all', spotlight: [], text: script.outro },
  ];
}

// stage: 0 لا شيء — 1 نص (وربما صوت جزئي) — 2 صوت كامل — 3 فيديو جاهز
export function stageOf(rec) {
  if (!rec || !rec.script) return { stage: 0, audio: 0, total: 0 };
  const items = itemsOf(rec.script);
  const audio = items.filter((it) => rec.audio && rec.audio[it.key]).length;
  let stage = 1;
  if (audio === items.length) stage = 2;
  if (stage === 2 && rec.video) stage = 3;
  return { stage, audio, total: items.length };
}

export const STAGE_TEXT = ['لم تُنشأ بعد', 'النص جاهز', 'الصوت جاهز', 'الفيديو جاهز ✓'];
