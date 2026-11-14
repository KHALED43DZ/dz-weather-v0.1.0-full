export function b64ToBytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// PCM 16-bit أحادي (little-endian) → ملف WAV
export function pcmToWav(pcm, rate = 24000) {
  const n = pcm.length - (pcm.length % 2);
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).set(pcm.subarray(0, n));
  return { blob: new Blob([buf], { type: 'audio/wav' }), duration: n / 2 / rate };
}

// محرّك الصوت: تشغيل مجدول + مستوى الصوت (لتحريك فم المذيع) + مسار للتسجيل
export class AudioEngine {
  constructor() { this.ctx = null; this.sources = []; }

  async init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.buf = new Uint8Array(this.analyser.fftSize);
      this.recDest = this.ctx.createMediaStreamDestination();
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.master.connect(this.recDest);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  async decode(blob) {
    const ab = await blob.arrayBuffer();
    return await new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej));
  }

  schedule(buffer, when) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.master);
    src.start(when);
    this.sources.push(src);
  }

  stopAll() {
    for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } }
    this.sources = [];
  }

  level() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) { const x = (this.buf[i] - 128) / 128; sum += x * x; }
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 3.2);
  }
}

// دمج عدة ملفات WAV (أحادية 16-بت بنفس التردد) في ملف واحد مع فواصل صمت
export async function concatWavs(list, gapSec = 0.4) {
  const rate = list[0].rate || 24000;
  const parts = [];
  for (const it of list) {
    const ab = new Uint8Array(await it.blob.arrayBuffer());
    parts.push(ab.subarray(44));
  }
  const gap = new Uint8Array(Math.round(rate * gapSec) * 2);
  const all = [];
  parts.forEach((p, i) => { all.push(p); if (i < parts.length - 1) all.push(gap); });
  const len = all.reduce((s, p) => s + p.length, 0);
  const pcm = new Uint8Array(len);
  let o = 0;
  for (const p of all) { pcm.set(p, o); o += p.length; }
  return pcmToWav(pcm, rate).blob;
}
