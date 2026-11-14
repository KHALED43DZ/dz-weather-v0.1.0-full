import {
  VERSION, BUILD_DATE, ANALYSIS_MODELS, TTS_MODELS, VOICES, COST_LABEL, SPEED_LABEL,
} from './config.js';
import { getSettings, saveSettings, getForecastCache } from './storage.js';
import { dayInfo, fmtDur, fmtSize, sleep, ltr } from './util.js';
import * as DB from './db.js';
import { fetchForecast, daySnapshot, summarize } from './weather.js';
import { buildPrompt, parseScript, LENGTHS } from './prompt.js';
import { itemsOf, stageOf, STAGE_TEXT } from './bulletin.js';
import { REGIONS } from './wilayas.js';
import { parseKeys, generateScript, generateSpeech, testKeys, resetKeyState } from './gemini.js';
import { AudioEngine, concatWavs } from './audio.js';
import { Scene } from './mapview.js';
import { Player } from './player.js';
import { ChromaClip, CHROMA_DEFAULTS } from './chroma.js';
import { buildPublishPrompt, parsePublish } from './publish.js';

const $ = (id) => document.getElementById(id);
const S = {
  settings: getSettings(),
  recs: new Map(),
  cur: null,
  busy: false,
  playing: false,
  ctrl: null,
  scene: null,
  audio: new AudioEngine(),
  player: null,
  installEvt: null,
};
window.__dz = S; // للتشخيص فقط

/* ───────── أدوات الواجهة ───────── */
let toastT = 0;
function toast(msg, ms = 2800) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, ms);
}
function setStatus(msg, err = false) {
  const el = $('status');
  el.textContent = msg; el.classList.toggle('err', !!err);
}
function setProgress(f) { $('bar').style.width = Math.round(f * 100) + '%'; }

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

const curRec = () => (S.cur ? S.recs.get(S.cur.iso) : null);
const extOf = (mime) => (/mp4/.test(mime) ? 'mp4' : 'webm');

/* ───────── الصفحة الرئيسية ───────── */
function renderDays() {
  const box = $('days');
  box.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const info = dayInfo(i);
    const rec = S.recs.get(info.iso);
    const { stage, audio, total } = stageOf(rec);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'day s' + stage;
    let st = STAGE_TEXT[stage];
    if (stage === 1 && audio > 0) st = `الصوت ${audio}/${total}`;
    b.innerHTML =
      `<span class="d-dots"><i></i><i></i><i></i></span>` +
      `<span class="d-lab"></span><span class="d-date"></span><span class="d-st"></span>`;
    b.querySelector('.d-lab').textContent = i < 3 ? info.label : info.dow;
    b.querySelector('.d-date').textContent = i < 3 ? info.full : info.short;
    b.querySelector('.d-st').textContent = st;
    b.addEventListener('click', () => openDay(i));
    box.appendChild(b);
  }
  $('todayLine').textContent = dayInfo(0).full;
  const hasKeys = parseKeys(S.settings.analysisKeys).length > 0;
  $('keyBanner').hidden = hasKeys;
}

function renderWx() {
  const c = getForecastCache();
  if (!c) { $('wxInfo').textContent = 'لم تُجلب بعد — تُجلب تلقائياً عند إنشاء أول نشرة'; return; }
  const d = new Date(c.t);
  const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  $('wxInfo').textContent = `Open-Meteo · 58 ولاية · آخر تحديث ${hh}`;
}

async function refreshWx() {
  const btn = $('btnWx');
  btn.disabled = true; $('wxInfo').textContent = 'جاري التحديث…';
  try { await fetchForecast(undefined, { force: true }); toast('تم تحديث بيانات الطقس'); } catch (e) { toast(e.message, 4000); }
  btn.disabled = false; renderWx();
}

/* ───────── صفحة النشرة ───────── */
function setScene() {
  const vertical = S.settings.orientation !== 'horizontal';
  const cv = $('cv');
  const W = vertical ? 720 : 1280, H = vertical ? 1280 : 720;
  if (!S.scene) { S.scene = new Scene(cv); S.player = new Player(S.scene, S.audio); }
  if (S.scene.W !== W) S.scene.setSize(W, H);
}

function openDay(offset) {
  S.cur = dayInfo(offset);
  setScene();
  $('home').hidden = true; $('detail').hidden = false;
  $('dTitle').textContent = S.cur.label === S.cur.dow ? S.cur.dow : S.cur.label;
  $('dSub').textContent = S.cur.full;
  setStatus('جاهز'); setProgress(0);
  refreshDetail();
  buildScriptEditor();
  window.scrollTo(0, 0);
  startIdle();
}

function closeDay() {
  if (S.busy) { toast('أوقف العملية الجارية أولاً'); return; }
  stopPreview();
  stopIdle();
  S.cur = null;
  $('detail').hidden = true; $('home').hidden = false;
  renderDays();
}

function refreshDetail() {
  if (!S.cur) return;
  const rec = curRec();
  const { stage, audio, total } = stageOf(rec);
  const b = S.busy;
  const set = (id, done, disabled) => { const el = $(id); el.classList.toggle('done', done); el.disabled = disabled; };
  set('stText', stage >= 1, b);
  set('stAudio', stage >= 2, b || stage < 1);
  set('stVideo', stage >= 3, b || stage < 2);
  set('stPub', !!(rec && rec.publish), b || stage < 1);
  $('stAudio').querySelector('span').textContent = stage === 1 && audio > 0 ? `الصوت ${audio}/${total}` : 'الصوت';
  $('stAll').disabled = b;
  $('stAll').textContent = stage === 3 && rec && rec.publish ? '✓ النشرة جاهزة' : '⚡ أنشئ كل شيء';
  $('stCancel').hidden = !b;
  $('btnPlay').disabled = b || S.playing || stage < 2;
  $('btnPlay').hidden = S.playing;
  $('btnStopPlay').hidden = !S.playing;
  $('downloads').hidden = !(rec && rec.script);
  $('dlVideo').disabled = !(rec && rec.video);
  $('dlAudio').disabled = stage < 2;
  if (rec && rec.video) $('dlVideo').textContent = `⬇ الفيديو (${ltr(fmtSize(rec.video.size))})`;
  else $('dlVideo').textContent = '⬇ تنزيل الفيديو';
  $('scriptBox').hidden = !(rec && rec.script);
  renderPublish();
}

/* رسم الحالة الساكنة (قبل التشغيل) */
function drawIdle(t) {
  const info = S.cur, rec = curRec(), sc = S.scene;
  if (!info || !sc) return;
  let snap = rec && rec.snap;
  if (!snap) {
    const c = getForecastCache();
    if (c) {
      const idx = c.data[0].daily.time.indexOf(info.iso);
      if (idx >= 0) snap = daySnapshot(c.data, idx);
    }
  }
  const first = rec && rec.script ? itemsOf(rec.script)[0] : null;
  sc.draw({
    t, cam: sc.camFor('all'), region: 'all', level: 0, itemT: 9,
    item: first ? { ...first, progress: 0.05 } : null,
    captionText: first ? '' : `اضغط «أنشئ كل شيء» لتوليد نشرة ${info.label === info.dow ? info.dow : info.label} (${info.short}).`,
    headline: (rec && rec.script && rec.script.headline) || 'نشرة الطقس في الجزائر',
    dateFull: info.full, snap, summary: snap ? summarize(snap) : null, presenter: S.settings.presenter || 'عمي الطقس',
  });
}

let idleOn = false;
function startIdle() {
  if (idleOn) return;
  idleOn = true;
  const loop = () => {
    if (!idleOn) return;
    if (!S.playing) drawIdle(performance.now() / 1000);
    setTimeout(() => requestAnimationFrame(loop), 70);
  };
  loop();
}
function stopIdle() { idleOn = false; }

/* ───────── محرّر النص ───────── */
function itemLabel(it) {
  if (it.kind === 'intro') return 'المقدمة';
  if (it.kind === 'outro') return 'الخاتمة';
  return REGIONS[it.region] ? REGIONS[it.region].ar : 'مقطع';
}

function buildScriptEditor() {
  const rec = curRec();
  const box = $('scriptList');
  box.innerHTML = '';
  if (!rec || !rec.script) return;
  for (const it of itemsOf(rec.script)) {
    const has = !!(rec.audio && rec.audio[it.key]);
    const div = document.createElement('div');
    div.className = 'seg';
    div.innerHTML = '<div class="seg-h"><span></span><button type="button" class="mini"></button></div><textarea dir="rtl" spellcheck="false"></textarea>';
    div.querySelector('span').textContent = itemLabel(it);
    const btn = div.querySelector('button');
    btn.textContent = has ? '🔊 أعد توليد الصوت' : '🔊 ولّد الصوت';
    btn.classList.toggle('has', has);
    const ta = div.querySelector('textarea');
    ta.value = it.text;
    ta.style.fontFamily = 'inherit'; ta.style.fontSize = '.95rem';
    ta.addEventListener('change', () => onEditText(it.key, ta.value));
    btn.addEventListener('click', () => run(() => regenItem(it.key)));
    box.appendChild(div);
  }
}

async function onEditText(key, value) {
  const rec = curRec();
  if (!rec) return;
  const v = value.replace(/\s+/g, ' ').trim();
  if (!v) { toast('النص لا يمكن أن يكون فارغاً'); buildScriptEditor(); return; }
  if (key === 'intro') rec.script.intro = v;
  else if (key === 'outro') rec.script.outro = v;
  else rec.script.segments[+key.slice(1)].text = v;
  if (rec.audio) delete rec.audio[key];
  rec.video = null;
  await DB.putB(rec);
  refreshDetail(); buildScriptEditor();
  toast('حُفظ التعديل — أعد توليد صوت هذه الفقرة');
}

/* ───────── خطوات الإنتاج ───────── */
async function run(fn) {
  if (S.busy) return;
  S.busy = true; S.ctrl = new AbortController();
  refreshDetail();
  try {
    await fn(S.ctrl.signal);
  } catch (e) {
    if (e && e.name === 'AbortError') setStatus('تم الإيقاف');
    else { setStatus('✗ ' + (e && e.message ? e.message : e), true); toast('تعذّرت العملية — راجع الرسالة تحت الخريطة', 4000); }
  } finally {
    S.busy = false; S.ctrl = null;
    refreshDetail(); renderDays(); buildScriptEditor();
  }
}

async function rawFor(info, signal) {
  let raw = await fetchForecast(signal);
  let idx = raw[0].daily.time.indexOf(info.iso);
  if (idx < 0) { raw = await fetchForecast(signal, { force: true }); idx = raw[0].daily.time.indexOf(info.iso); }
  if (idx < 0) throw new Error('هذا اليوم غير متوفر في بيانات الطقس');
  renderWx();
  return { raw, idx };
}

async function stepText(signal) {
  const st = (S.settings = getSettings());
  const keys = parseKeys(st.analysisKeys);
  if (!keys.length) throw new Error('أضف مفتاح Gemini واحداً على الأقل في «مفاتيح تحليل النص» (⚙️ الإعدادات)');
  const info = S.cur;
  const old = curRec();
  if (old && old.script && (Object.keys(old.audio || {}).length || old.video) &&
      !confirm('إعادة كتابة النص ستحذف الصوت والفيديو الحاليين. متابعة؟')) return;
  setProgress(0.05); setStatus('جلب بيانات الطقس الحقيقية…');
  const { raw, idx } = await rawFor(info, signal);
  const snap = daySnapshot(raw, idx);
  const summary = summarize(snap);
  const { system, user } = buildPrompt({ dateFull: info.full, summary, length: st.length, presenter: st.presenter || 'عمي الطقس' });
  const models = [st.customAnalysis.trim() || st.analysisModel, st.analysisFallback];
  let script = null, res = null, lastErr = null;
  for (let attempt = 0; attempt < 2 && !script; attempt++) {
    setProgress(0.2); setStatus(attempt ? 'نعيد المحاولة: كتابة النشرة…' : 'الذكاء الاصطناعي يكتب النشرة بالدارجة…');
    res = await generateScript({ keys, models, system, user, onStatus: (m) => setStatus(m), signal });
    try { script = parseScript(res.text, summary); } catch (e) { lastErr = e; }
  }
  if (!script) throw lastErr;
  const rec = { id: info.iso, script, snap, audio: {}, video: null, meta: { analysisModel: res.model, createdAt: Date.now() } };
  await DB.putB(rec);
  S.recs.set(info.iso, rec);
  setProgress(1); setStatus(`✓ النص جاهز — النموذج ${ltr(res.model)} — المفتاح رقم ${res.keyIndex}`);
  refreshDetail(); buildScriptEditor(); renderDays();
}

async function genAudio(rec, keysToDo, signal) {
  const st = (S.settings = getSettings());
  const keys = parseKeys(st.ttsKeys);
  if (!keys.length) throw new Error('أضف مفتاح Gemini واحداً على الأقل في «مفاتيح توليد الصوت» (⚙️ الإعدادات)');
  const items = itemsOf(rec.script).filter((it) => keysToDo.includes(it.key));
  const models = [st.customTts.trim() || st.ttsModel, st.ttsFallback];
  rec.video = null;
  let n = 0;
  for (const it of items) {
    setProgress(n / items.length);
    setStatus(`توليد الصوت ${n + 1}/${items.length} …`);
    const r = await generateSpeech({
      keys, models, text: it.text, voice: st.voice, style: st.stylePrompt, onStatus: (m) => setStatus(m), signal,
    });
    rec.audio = rec.audio || {};
    rec.audio[it.key] = { blob: r.wav, duration: r.duration, rate: r.rate, model: r.model };
    await DB.putB(rec);
    n++;
    refreshDetail(); renderDays();
    if (n < items.length) await sleep(Math.max(0, +st.ttsDelay || 0) * 1000, signal);
  }
  setProgress(1);
}

async function stepAudio(signal) {
  const rec = curRec();
  if (!rec || !rec.script) throw new Error('ولّد النص أولاً');
  const todo = itemsOf(rec.script).filter((it) => !(rec.audio && rec.audio[it.key])).map((it) => it.key);
  if (!todo.length) {
    if (!confirm('الصوت مكتمل. هل تريد إعادة توليده كاملاً؟')) return;
    rec.audio = {};
    return genAudio(rec, itemsOf(rec.script).map((it) => it.key), signal).then(() => setStatus('✓ الصوت جاهز'));
  }
  await genAudio(rec, todo, signal);
  setStatus('✓ الصوت جاهز');
}

async function regenItem(key) {
  const rec = curRec();
  if (rec.audio) delete rec.audio[key];
  await genAudio(rec, [key], S.ctrl.signal);
  setStatus('✓ تم توليد صوت الفقرة');
}

async function stepVideo(signal) {
  const rec = curRec();
  const { stage } = stageOf(rec);
  if (stage < 2) throw new Error('ولّد الصوت أولاً');
  if (stage === 3 && !confirm('الفيديو جاهز. هل تريد إعادة تسجيله؟')) return;
  setScene();
  setStatus('تجهيز الصوت والمشهد…'); setProgress(0);
  S.playing = true; refreshDetail();
  let clip = null;
  try {
    clip = await loadClip();
    const tl = await S.player.prepare({ rec, dayFull: S.cur.full, presenter: S.settings.presenter || 'عمي الطقس', clip });
    const out = await S.player.play({
      record: true, signal,
      onProgress: (f, t) => { setProgress(f); setStatus(`⏺ تسجيل الفيديو ${ltr(fmtDur(t) + ' / ' + fmtDur(tl.total))} — أبقِ الشاشة مفتوحة ولا تغادر الصفحة`); },
    });
    rec.video = out;
    await DB.putB(rec);
    setProgress(1);
    if (out.clipError) toast('تعذّر تشغيل مقطع البداية: ' + out.clipError, 5000);
    setStatus(`✓ الفيديو جاهز${out.clip ? ' (مع مقطع البداية)' : ''} — المدة ${ltr(fmtDur(out.duration))} — الحجم ${ltr(fmtSize(out.size))} — الصيغة ${ltr(extOf(out.mime).toUpperCase())}`);
  } finally { S.playing = false; if (clip) clip.dispose(); }
}

async function stepAll(signal) {
  let rec = curRec();
  if (!rec || !rec.script) { await stepText(signal); rec = curRec(); if (!rec || !rec.script) return; }
  const { stage } = stageOf(rec);
  if (stage < 2) await stepAudio(signal);
  if (stageOf(curRec()).stage === 2) await stepVideo(signal);
  rec = curRec();
  if (rec && rec.video && !rec.publish) {
    try { await stepPublish(signal); } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      setStatus('✓ الفيديو جاهز — لكن تعذّر توليد نصوص النشر: ' + e.message + ' (اضغط «٤ النشر» لإعادة المحاولة)', true);
    }
  }
}

/* ───────── مقطع البداية ───────── */
async function loadClip() {
  const st = (S.settings = getSettings());
  if (!st.introEnabled) return null;
  let asset = null;
  try { asset = await DB.getAsset('introClip'); } catch { /* ignore */ }
  if (!asset || !asset.blob) return null;
  try {
    await S.audio.init();
    const clip = new ChromaClip(asset.blob, {
      audioEngine: S.audio,
      params: { sim: +st.chromaSim, smooth: +st.chromaSmooth, despill: +st.chromaDespill },
    });
    await clip.load();
    return clip;
  } catch (e) { toast('تعذّر استعمال مقطع البداية: ' + e.message, 5000); return null; }
}

/* ───────── نصوص النشر ───────── */
async function stepPublish(signal) {
  const rec = curRec();
  if (!rec || !rec.script) throw new Error('ولّد النص أولاً');
  const st = (S.settings = getSettings());
  const keys = parseKeys(st.analysisKeys);
  if (!keys.length) throw new Error('أضف مفاتيح التحليل من الإعدادات');
  setProgress(0.3); setStatus('كتابة نصوص النشر (تيك توك ويوتيوب Shorts)…');
  const { system, user } = buildPublishPrompt({
    dateFull: S.cur.full, headline: rec.script.headline, script: rec.script, summary: summarize(rec.snap),
  });
  const models = [st.customAnalysis.trim() || st.analysisModel, st.analysisFallback];
  let pub = null, res = null, lastErr = null;
  for (let attempt = 0; attempt < 2 && !pub; attempt++) {
    res = await generateScript({ keys, models, system, user, onStatus: (m) => setStatus(m), signal });
    try { pub = parsePublish(res.text); } catch (e) { lastErr = e; }
  }
  if (!pub) throw lastErr;
  rec.publish = { ...pub, model: res.model, at: Date.now() };
  await DB.putB(rec);
  setProgress(1); setStatus(`✓ نصوص النشر جاهزة — النموذج ${ltr(res.model)}`);
  refreshDetail();
}

function updatePubCounts() {
  $('cntTk').textContent = `${$('pubTk').value.length} حرف`;
  $('cntTitle').textContent = `${$('pubTitle').value.length}/100`;
  $('cntDesc').textContent = `${$('pubDesc').value.length} حرف`;
}

function renderPublish() {
  const rec = curRec();
  const p = rec && rec.publish;
  $('publishBox').hidden = !p;
  if (!p) return;
  const act = document.activeElement;
  if (act !== $('pubTk')) $('pubTk').value = p.tiktok;
  if (act !== $('pubTitle')) $('pubTitle').value = p.title;
  if (act !== $('pubDesc')) $('pubDesc').value = p.description;
  updatePubCounts();
}

async function onPubEdit() {
  const rec = curRec();
  if (!rec || !rec.publish) return;
  rec.publish.tiktok = $('pubTk').value;
  rec.publish.title = $('pubTitle').value.replace(/\s+/g, ' ').trim();
  rec.publish.description = $('pubDesc').value;
  updatePubCounts();
  try { await DB.putB(rec); } catch { /* ignore */ }
}

async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); toast('✓ تم النسخ'); } catch {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('✓ تم النسخ'); } catch { toast('تعذّر النسخ'); }
    ta.remove();
  }
}

async function previewPlay() {
  const rec = curRec();
  if (!rec || stageOf(rec).stage < 2 || S.playing) return;
  setScene();
  S.playing = true; S.busy = false; refreshDetail();
  let clip = null;
  try {
    clip = await loadClip();
    const tl = await S.player.prepare({ rec, dayFull: S.cur.full, presenter: S.settings.presenter || 'عمي الطقس', clip });
    setStatus('▶ معاينة…');
    await S.player.play({ record: false, onProgress: (f, t) => { setProgress(f); $('status').textContent = `▶ معاينة ${ltr(fmtDur(t) + ' / ' + fmtDur(tl.total))}`; } });
    setStatus('انتهت المعاينة'); setProgress(0);
  } catch (e) { setStatus('✗ ' + e.message, true); } finally { S.playing = false; if (clip) clip.dispose(); refreshDetail(); }
}
function stopPreview() { if (S.playing && S.player) S.player.stop(); }

/* ───────── التنزيلات ───────── */
async function dlVideo() {
  const rec = curRec();
  if (!rec || !rec.video) return;
  download(rec.video.blob, `dz-weather-${S.cur.iso}.${extOf(rec.video.mime)}`);
}
async function dlAudio() {
  const rec = curRec();
  if (!rec || stageOf(rec).stage < 2) return;
  const list = itemsOf(rec.script).map((it) => rec.audio[it.key]);
  try { download(await concatWavs(list), `dz-weather-${S.cur.iso}.wav`); } catch (e) { toast('تعذّر دمج الصوت: ' + e.message); }
}
function dlText() {
  const rec = curRec();
  if (!rec) return;
  const parts = [rec.script.headline, S.cur.full, '', ...itemsOf(rec.script).map((it) => `[${itemLabel(it)}]\n${it.text}`)];
  if (rec.publish) {
    parts.push('────────', '[تيك توك — الوصف]\n' + rec.publish.tiktok, '[يوتيوب Shorts — العنوان]\n' + rec.publish.title, '[يوتيوب Shorts — الوصف]\n' + rec.publish.description);
  }
  const txt = parts.join('\n\n');
  download(new Blob([txt], { type: 'text/plain;charset=utf-8' }), `dz-weather-${S.cur.iso}.txt`);
}

/* ───────── الإعدادات ───────── */
function fillSelect(sel, models, value) {
  sel.innerHTML = '';
  for (const m of models) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = `${m.name} — ${COST_LABEL[m.cost]} · ${SPEED_LABEL[m.speed]}`;
    sel.appendChild(o);
  }
  sel.value = value;
  if (sel.value !== value) sel.selectedIndex = 0;
}

function noteFor(models, id) {
  const m = models.find((x) => x.id === id);
  return m ? `${m.name}: ${m.note}` : '';
}

function updateCounts() {
  $('cntAnalysis').textContent = `${parseKeys($('keysAnalysis').value).length} مفتاح`;
  $('cntTts').textContent = `${parseKeys($('keysTts').value).length} مفتاح`;
}

function updateNotes() {
  $('noteAnalysis').textContent = noteFor(ANALYSIS_MODELS, $('selAnalysis').value);
  $('noteTts').textContent = noteFor(TTS_MODELS, $('selTts').value);
}

function openSettings() {
  const s = (S.settings = getSettings());
  $('keysAnalysis').value = s.analysisKeys;
  $('keysTts').value = s.ttsKeys;
  fillSelect($('selAnalysis'), ANALYSIS_MODELS, s.analysisModel);
  fillSelect($('selAnalysisFb'), ANALYSIS_MODELS, s.analysisFallback);
  fillSelect($('selTts'), TTS_MODELS, s.ttsModel);
  fillSelect($('selTtsFb'), TTS_MODELS, s.ttsFallback);
  $('customAnalysis').value = s.customAnalysis;
  $('customTts').value = s.customTts;
  const sv = $('selVoice');
  sv.innerHTML = VOICES.map((v) => `<option value="${v.id}">${v.ar}</option>`).join('');
  sv.value = s.voice;
  $('stylePrompt').value = s.stylePrompt;
  $('ttsDelay').value = s.ttsDelay;
  $('presenter').value = s.presenter;
  const sl = $('selLength');
  sl.innerHTML = Object.entries(LENGTHS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  sl.value = s.length;
  $('selOrient').value = s.orientation;
  $('introEnabled').checked = !!s.introEnabled;
  $('chromaSim').value = s.chromaSim; $('chromaSmooth').value = s.chromaSmooth; $('chromaDespill').value = s.chromaDespill;
  refreshClipInfo();
  $('appInfo').textContent = `الإصدار ${VERSION} · ${BUILD_DATE}`;
  $('keyTestOut').textContent = ''; $('voiceTestOut').textContent = '';
  updateCounts(); updateNotes();
  $('settings').hidden = false;
  $('settings').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function closeSettings() { stopClipPreview(); $('settings').hidden = true; document.body.style.overflow = ''; }

function saveFromForm() {
  S.settings = saveSettings({
    analysisKeys: $('keysAnalysis').value.trim(),
    ttsKeys: $('keysTts').value.trim(),
    analysisModel: $('selAnalysis').value,
    analysisFallback: $('selAnalysisFb').value,
    ttsModel: $('selTts').value,
    ttsFallback: $('selTtsFb').value,
    customAnalysis: $('customAnalysis').value.trim(),
    customTts: $('customTts').value.trim(),
    voice: $('selVoice').value,
    stylePrompt: $('stylePrompt').value.trim() || getSettings().stylePrompt,
    ttsDelay: Math.max(0, Math.min(60, +$('ttsDelay').value || 0)),
    presenter: $('presenter').value.trim() || 'عمي الطقس',
    length: $('selLength').value,
    orientation: $('selOrient').value,
    introEnabled: $('introEnabled').checked,
    chromaSim: +$('chromaSim').value,
    chromaSmooth: +$('chromaSmooth').value,
    chromaDespill: +$('chromaDespill').value,
  });
  resetKeyState();
  if (S.scene) setScene();
  renderDays();
}

async function onTestKeys() {
  const all = [...new Set([...parseKeys($('keysAnalysis').value), ...parseKeys($('keysTts').value)])];
  const out = $('keyTestOut');
  if (!all.length) { out.textContent = 'لا توجد مفاتيح لفحصها'; return; }
  out.textContent = 'جاري الفحص…';
  try {
    const r = await testKeys(all);
    out.innerHTML = '';
    for (const x of r) {
      const d = document.createElement('div');
      d.className = x.ok ? 'ok-t' : 'bad-t';
      d.textContent = `${x.ok ? '✓' : '✗'} ${x.key} — ${x.msg}`;
      out.appendChild(d);
    }
  } catch (e) { out.textContent = e.message; }
}

async function onVoiceTest() {
  const out = $('voiceTestOut');
  const keys = parseKeys($('keysTts').value);
  if (!keys.length) { out.textContent = 'أضف مفتاح صوت أولاً'; return; }
  out.textContent = 'جاري توليد عيّنة…';
  const btn = $('btnVoiceTest'); btn.disabled = true;
  try {
    const r = await generateSpeech({
      keys,
      models: [$('customTts').value.trim() || $('selTts').value, $('selTtsFb').value],
      text: 'صباح الخير يا جماعة! هذي نشرة الطقس مع عمي الطقس. الجو اليوم حلو، والشمس طالعة، بصح ما تنساوش المضلة يا خاوتي.',
      voice: $('selVoice').value,
      style: $('stylePrompt').value.trim(),
      onStatus: (m) => { out.textContent = m; },
    });
    out.textContent = `✓ النموذج ${ltr(r.model)} — المفتاح رقم ${r.keyIndex} — قيّم اللهجة: هل تبدو جزائرية؟`;
    const a = new Audio(URL.createObjectURL(r.wav));
    a.play().catch(() => { out.textContent += ' (اضغط تشغيل يدوياً)'; });
  } catch (e) { out.textContent = '✗ ' + e.message; }
  btn.disabled = false;
}

/* ───────── إدارة مقطع البداية في الإعدادات ───────── */
let prevClip = null, prevRaf = 0;
const chromaForm = () => ({ sim: +$('chromaSim').value, smooth: +$('chromaSmooth').value, despill: +$('chromaDespill').value });

function stopClipPreview() {
  cancelAnimationFrame(prevRaf);
  if (prevClip) { prevClip.dispose(); prevClip = null; }
  const b = $('btnClipPrev'); if (b) b.textContent = '▶ معاينة';
}

async function refreshClipInfo() {
  stopClipPreview();
  let a = null;
  try { a = await DB.getAsset('introClip'); } catch { /* ignore */ }
  $('clipInfo').textContent = a
    ? `${a.name} — المدة ${ltr(fmtDur(a.duration))} — الحجم ${ltr(fmtSize(a.size))}`
    : 'لا يوجد مقطع. ارفع مقطعاً بخلفية خضراء مصمتة.';
  $('clipTools').hidden = !a;
}

async function onClipFile(file) {
  if (!file) return;
  if (!/^video\//.test(file.type) && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) { toast('اختر ملف فيديو'); return; }
  if (file.size > 60 * 1048576) { toast('الملف كبير — الحد الأقصى 60 ميغابايت'); return; }
  $('clipInfo').textContent = 'جاري الفحص…';
  let clip = null;
  try {
    clip = new ChromaClip(file, { muted: true });
    await clip.load();
    if (clip.duration > 15) throw new Error('المقطع طويل — الحد الأقصى 15 ثانية');
    await DB.putAsset({ id: 'introClip', blob: file, name: file.name, size: file.size, duration: clip.duration, type: file.type, at: Date.now() });
    toast(clip.autoKey ? '✓ حُفظ المقطع (اكتُشف لون الخلفية تلقائياً)' : '✓ حُفظ المقطع (لم يُكتشف أخضر واضح في الحواف — راجع المعاينة)', 4500);
  } catch (e) { toast(e.message, 5000); } finally { if (clip) clip.dispose(); }
  await refreshClipInfo();
}

async function toggleClipPreview() {
  if (prevClip) { stopClipPreview(); return; }
  let a = null;
  try { a = await DB.getAsset('introClip'); } catch { /* ignore */ }
  if (!a) return;
  const clip = new ChromaClip(a.blob, { muted: true, params: chromaForm() });
  try { await clip.load(); } catch (e) { toast(e.message, 5000); clip.dispose(); return; }
  prevClip = clip;
  $('btnClipPrev').textContent = '⏹ إيقاف';
  const cv = $('clipPrev');
  const vertical = $('selOrient').value !== 'horizontal';
  cv.width = vertical ? 360 : 640; cv.height = vertical ? 640 : 360;
  const ctx = cv.getContext('2d');
  await clip.seek(0); clip.play().catch(() => {});
  const loop = () => {
    if (prevClip !== clip) return;
    const g = ctx.createLinearGradient(0, 0, 0, cv.height);
    g.addColorStop(0, '#0B3556'); g.addColorStop(1, '#2E8DB5');
    ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
    clip.setParams(chromaForm());
    clip.drawTo(ctx, cv.width, cv.height);
    if (clip.video.ended) { clip.seek(0).then(() => clip.play().catch(() => {})); }
    prevRaf = requestAnimationFrame(loop);
  };
  loop();
}

async function onClipDel() {
  if (!confirm('حذف مقطع البداية المحفوظ؟')) return;
  try { await DB.delAsset('introClip'); } catch { /* ignore */ }
  await refreshClipInfo(); toast('تم الحذف');
}

function resetChroma() {
  $('chromaSim').value = CHROMA_DEFAULTS.sim; $('chromaSmooth').value = CHROMA_DEFAULTS.smooth; $('chromaDespill').value = CHROMA_DEFAULTS.despill;
}

async function onUpdate() {
  const info = $('appInfo');
  if (!('serviceWorker' in navigator)) { info.textContent = 'المتصفح لا يدعم التحديث التلقائي'; return; }
  info.textContent = 'جاري البحث عن تحديث…';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { info.textContent = `الإصدار ${VERSION} (لم يُسجَّل Service Worker بعد)`; return; }
    await reg.update();
    await sleep(1500);
    if (reg.installing || reg.waiting) { info.textContent = 'وُجد تحديث — سيُعاد تحميل التطبيق…'; await sleep(800); location.reload(); }
    else info.textContent = `✓ أنت على أحدث نسخة (${VERSION})`;
  } catch (e) { info.textContent = 'تعذّر التحقق: ' + e.message; }
}

async function onWipe() {
  if (!confirm('سيتم حذف كل النشرات المحفوظة (النصوص والصوت والفيديو). متابعة؟')) return;
  await DB.wipeAll(); S.recs.clear(); renderDays(); toast('تم الحذف');
}

/* ───────── التشغيل ───────── */
async function loadRecs() {
  try {
    await DB.purgeOld(dayInfo(0).iso);
    for (const r of await DB.allB()) S.recs.set(r.id, r);
  } catch (e) { console.warn('IndexedDB', e); }
}

function bind() {
  $('btnSettings').addEventListener('click', openSettings);
  $('btnCloseSettings').addEventListener('click', closeSettings);
  $('btnSave').addEventListener('click', () => { saveFromForm(); closeSettings(); toast('✓ حُفظت الإعدادات'); });
  $('keysAnalysis').addEventListener('input', updateCounts);
  $('keysTts').addEventListener('input', updateCounts);
  $('selAnalysis').addEventListener('change', updateNotes);
  $('selTts').addEventListener('change', updateNotes);
  $('btnCopyKeys').addEventListener('click', () => { $('keysTts').value = $('keysAnalysis').value; updateCounts(); toast('نُسخت المفاتيح'); });
  $('btnTestKeys').addEventListener('click', onTestKeys);
  $('btnVoiceTest').addEventListener('click', onVoiceTest);
  $('btnUpdate').addEventListener('click', onUpdate);
  $('btnWipe').addEventListener('click', onWipe);
  $('btnWx').addEventListener('click', refreshWx);

  $('clipFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; onClipFile(f); });
  $('btnClipPrev').addEventListener('click', toggleClipPreview);
  $('btnClipDel').addEventListener('click', onClipDel);
  $('btnClipReset').addEventListener('click', resetChroma);
  $('stPub').addEventListener('click', () => run(stepPublish));
  for (const id of ['pubTk', 'pubTitle', 'pubDesc']) {
    $(id).addEventListener('input', updatePubCounts);
    $(id).addEventListener('change', onPubEdit);
  }
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText($(b.dataset.copy).value)));
  $('btnBack').addEventListener('click', closeDay);
  $('stText').addEventListener('click', () => run(stepText));
  $('stAudio').addEventListener('click', () => run(stepAudio));
  $('stVideo').addEventListener('click', () => run(stepVideo));
  $('stAll').addEventListener('click', () => run(stepAll));
  $('stCancel').addEventListener('click', () => { if (S.ctrl) S.ctrl.abort(); if (S.player) S.player.stop(); });
  $('btnPlay').addEventListener('click', previewPlay);
  $('btnStopPlay').addEventListener('click', stopPreview);
  $('dlVideo').addEventListener('click', dlVideo);
  $('dlAudio').addEventListener('click', dlAudio);
  $('dlText').addEventListener('click', dlText);

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; $('installCard').hidden = false; });
  $('btnInstall').addEventListener('click', async () => {
    if (!S.installEvt) return;
    S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; $('installCard').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('installCard').hidden = true; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !S.cur) renderDays(); });
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (had && !S.busy && !S.playing) toast('تم تحديث التطبيق — أعد فتحه لتفعيل النسخة الجديدة', 6000);
  });
}

async function main() {
  $('verBadge').textContent = 'v' + VERSION;
  $('verPill').textContent = 'v' + VERSION;
  bind();
  await loadRecs();
  renderDays(); renderWx();
  registerSW();
}
main();
