import { ease } from './mapview.js';
import { itemsOf } from './bulletin.js';
import { sleep } from './util.js';
import { summarize } from './weather.js';

const LEAD = 0.9, GAP = 0.4, TAIL = 1.6, CAM = 1.6, CLIP_PAD = 0.35;

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const list = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
  ];
  return list.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export class Player {
  constructor(scene, audio) {
    this.scene = scene; this.audio = audio;
    this.tl = null; this.running = false; this.raf = 0;
  }

  // clip: ChromaClip اختياري — تبدأ النشرة بعد انتهائه
  async prepare({ rec, dayFull, presenter, clip = null }) {
    await this.audio.init();
    const items = itemsOf(rec.script);
    const clipDur = clip ? clip.duration : 0;
    let t = clip ? clipDur + CLIP_PAD : LEAD;
    const out = [];
    let prevCam = this.scene.camFor('all');
    for (const it of items) {
      const a = rec.audio && rec.audio[it.key];
      if (!a) throw new Error('الصوت ناقص — ولّد الصوت أولاً');
      const buf = await this.audio.decode(a.blob);
      const cam = this.scene.camFor(it.region);
      out.push({ ...it, buf, start: t, dur: buf.duration, end: t + buf.duration, cam, prevCam });
      prevCam = cam;
      t += buf.duration + GAP;
    }
    this.tl = {
      items: out, total: t - GAP + TAIL, dayFull, presenter, clip, clipDur,
      headline: rec.script.headline, snap: rec.snap, summary: summarize(rec.snap),
      full: this.scene.camFor('all'),
    };
    return this.tl;
  }

  state(t, level = 0) {
    const tl = this.tl;
    const intro = !!tl.clip && t < tl.clipDur + CLIP_PAD * 0.5;
    let cur = null;
    if (!intro) for (const it of tl.items) if (t >= it.start - GAP) cur = it;
    let cam = tl.full, item = null, itemT = 0;
    if (cur) {
      const k = ease((t - (cur.start - GAP)) / CAM);
      cam = this.scene.lerpCam(cur.prevCam, cur.cam, k);
      itemT = Math.max(0, t - cur.start + 0.2);
      if (t <= cur.end + 0.05) item = { ...cur, progress: (t - cur.start) / cur.dur };
      else item = { ...cur, progress: 1 };
      if (t > tl.items[tl.items.length - 1].end + 0.2) { // الخاتمة: عودة إلى الخريطة العامة
        const last = tl.items[tl.items.length - 1];
        cam = this.scene.lerpCam(last.cam, tl.full, ease((t - last.end - 0.2) / CAM));
      }
    }
    const speaking = item && t >= item.start && t <= item.end;
    return {
      t, cam, level: speaking ? level : 0, item, itemT, intro,
      region: item ? item.region : 'all', headline: tl.headline, dateFull: tl.dayFull,
      snap: tl.snap, summary: tl.summary, presenter: tl.presenter,
    };
  }

  drawAt(t) { this.scene.draw(this.state(t, 0)); }

  // رسم إطار معيّن مع مقطع البداية (للاختبار والمعاينة الساكنة)
  async drawAtWithClip(t) {
    const tl = this.tl;
    if (tl.clip && t < tl.clipDur) await tl.clip.seek(t);
    this.scene.draw(this.state(t, 0));
    if (tl.clip && t < tl.clipDur) tl.clip.drawTo(this.scene.ctx, this.scene.W, this.scene.H);
  }

  stop() {
    this.running = false;
    this.audio.stopAll();
    cancelAnimationFrame(this.raf);
    if (this.tl && this.tl.clip) this.tl.clip.pause();
  }

  // تشغيل (ومعه تسجيل اختياري). يُرجع {blob,mime,duration} عند التسجيل
  async play({ record = false, onProgress = () => {}, signal } = {}) {
    const tl = this.tl;
    const { audio, scene } = this;
    const clip = tl.clip;
    await audio.init();
    this.running = true;
    let recorder = null, recStarted = false, clipStarted = false;
    const chunks = [];
    let mime = '', stopped = null;
    let wake = null;
    try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch { /* optional */ }
    if (clip) await clip.seek(0);
    if (record) {
      mime = pickMime();
      if (mime === null) throw new Error('متصفحك لا يدعم تسجيل الفيديو (MediaRecorder)');
      const stream = scene.cv.captureStream(30);
      audio.recDest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      recorder = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 128_000,
      });
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      stopped = new Promise((res) => { recorder.onstop = res; });
    }
    const t0 = audio.ctx.currentTime + 0.35;
    for (const it of tl.items) audio.schedule(it.buf, t0 + it.start);

    let aborted = false;
    const onAbort = () => { aborted = true; this.stop(); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    let clipErr = null;
    await new Promise((resolve) => {
      const tick = () => {
        if (!this.running) return resolve();
        const raw = audio.ctx.currentTime - t0;
        const t = Math.max(0, raw);
        if (recorder && !recStarted && raw >= -0.05) { recorder.start(500); recStarted = true; }
        if (clip && !clipStarted && raw >= 0) {
          clipStarted = true;
          clip.play().catch((e) => { clipErr = e; });
        }
        scene.draw(this.state(t, audio.level()));
        if (clip && t < tl.clipDur + 0.05 && clipStarted) clip.drawTo(scene.ctx, scene.W, scene.H);
        onProgress(Math.min(1, t / tl.total), t);
        if (t >= tl.total) { this.running = false; return resolve(); }
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    });
    if (signal) signal.removeEventListener('abort', onAbort);
    if (wake) { try { wake.release(); } catch { /* ignore */ } }
    this.running = false;
    audio.stopAll();
    if (clip) clip.pause();
    this.drawAt(tl.total);
    if (!recorder) return null;
    await sleep(250);
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    if (aborted) throw new DOMException('Aborted', 'AbortError');
    const type = (mime || 'video/webm').split(';')[0];
    const blob = new Blob(chunks, { type });
    if (!blob.size) throw new Error('فشل التسجيل: الملف فارغ');
    return { blob, mime: type, duration: tl.total, size: blob.size, clip: !!clip, clipError: clipErr ? clipErr.message : '' };
  }
}
