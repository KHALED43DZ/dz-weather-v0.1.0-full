// مقطع البداية: تشغيل فيديو بخلفية خضراء وإزالة الخلفية (Chroma Key) وعرضه فوق المشهد
const VS = `attribute vec2 p; varying vec2 uv;
void main(){ uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `precision mediump float;
varying vec2 uv; uniform sampler2D tex; uniform vec2 key; uniform float sim; uniform float smoo; uniform float despill;
void main(){
  vec3 c = texture2D(tex, uv).rgb;
  float cb = -0.169 * c.r - 0.331 * c.g + 0.5 * c.b;
  float cr = 0.5 * c.r - 0.419 * c.g - 0.081 * c.b;
  float d = distance(vec2(cb, cr), key);
  float a = smoothstep(sim, sim + smoo, d);
  float spill = max(0.0, c.g - max(c.r, c.b));
  c.g -= spill * despill;
  gl_FragColor = vec4(c * a, a);
}`;

export const CHROMA_DEFAULTS = { sim: 0.18, smooth: 0.12, despill: 0.8 };
const cbcr = ([r, g, b]) => [-0.169 * r - 0.331 * g + 0.5 * b, 0.5 * r - 0.419 * g - 0.081 * b];

export class ChromaClip {
  // opts: { audioEngine?, muted?, params? }
  constructor(blob, opts = {}) {
    this.blob = blob; this.opts = opts;
    this.params = { ...CHROMA_DEFAULTS, ...(opts.params || {}) };
    this.keyRGB = [0, 0.8, 0.25];
    this.url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.muted = !!opts.muted;
    v.src = this.url;
    this.video = v;
    this.duration = 0; this.w = 0; this.h = 0;
    this.gl = null; this.cpu = null;
  }

  async load() {
    const v = this.video;
    await new Promise((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error('تعذّر قراءة مقطع البداية — جرّب ملف MP4 (H.264) أو WebM'));
      v.load();
    });
    // مقاطع MediaRecorder قد تُبلغ عن مدة غير منتهية
    if (!isFinite(v.duration)) {
      await new Promise((res) => { v.ontimeupdate = () => { v.ontimeupdate = null; res(); }; v.currentTime = 1e6; });
    }
    this.duration = v.duration;
    await this.seek(0.05);
    this.w = v.videoWidth; this.h = v.videoHeight;
    if (!this.w || !this.h || !(this.duration > 0.2)) throw new Error('المقطع غير صالح (لا صورة أو مدته قصيرة جداً)');
    if (this.opts.audioEngine && this.opts.audioEngine.ctx) {
      const eng = this.opts.audioEngine;
      this.srcNode = eng.ctx.createMediaElementSource(v);
      this.srcNode.connect(eng.master);
    }
    this.initGL();
    this.detectKey();
    return this;
  }

  seek(t) {
    const v = this.video;
    return new Promise((res) => {
      let done = false;
      const fin = () => { if (!done) { done = true; v.removeEventListener('seeked', fin); res(); } };
      v.addEventListener('seeked', fin);
      setTimeout(fin, 1500);
      v.currentTime = Math.min(t, Math.max(0, this.duration - 0.01));
    });
  }

  // تقدير لون الخلفية من حواف الإطار
  detectKey() {
    const c = document.createElement('canvas'); c.width = 48; c.height = 48;
    const x = c.getContext('2d', { willReadFrequently: true });
    try {
      x.drawImage(this.video, 0, 0, 48, 48);
      const d = x.getImageData(0, 0, 48, 48).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < 48; i++) {
        for (const [px, py] of [[i, 0], [i, 47], [0, i], [47, i], [i, 2], [i, 45], [2, i], [45, i]]) {
          const k = (py * 48 + px) * 4; r += d[k]; g += d[k + 1]; b += d[k + 2]; n++;
        }
      }
      r /= n * 255; g /= n * 255; b /= n * 255;
      if (g > r * 1.15 && g > b * 1.15 && g > 0.25) { this.keyRGB = [r, g, b]; this.autoKey = true; return; }
    } catch { /* tainted/unsupported */ }
    this.autoKey = false;
  }

  setParams(p) { this.params = { ...this.params, ...p }; }

  initGL() {
    const out = document.createElement('canvas');
    const cap = 960;
    const s = Math.min(1, cap / Math.max(this.w, this.h));
    out.width = Math.round(this.w * s); out.height = Math.round(this.h * s);
    this.out = out;
    const gl = out.getContext('webgl', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true });
    if (!gl) { this.cpu = { cv: document.createElement('canvas') }; return; }
    const sh = (type, src) => {
      const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
      return o;
    };
    try {
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(pr); gl.useProgram(pr);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'p');
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      this.gl = gl;
      this.u = {
        key: gl.getUniformLocation(pr, 'key'), sim: gl.getUniformLocation(pr, 'sim'),
        smoo: gl.getUniformLocation(pr, 'smoo'), despill: gl.getUniformLocation(pr, 'despill'),
      };
      gl.viewport(0, 0, out.width, out.height);
    } catch (e) {
      console.warn('WebGL keyer failed, using CPU', e);
      this.gl = null; this.cpu = { cv: document.createElement('canvas') };
    }
  }

  renderKeyed() {
    const v = this.video;
    if (v.readyState < 2) return false;
    const { sim, smooth, despill } = this.params;
    const [kb, kr] = cbcr(this.keyRGB);
    if (this.gl) {
      const gl = this.gl;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
      gl.uniform2f(this.u.key, kb, kr);
      gl.uniform1f(this.u.sim, sim); gl.uniform1f(this.u.smoo, Math.max(0.005, smooth)); gl.uniform1f(this.u.despill, despill);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    }
    // احتياطي على المعالج: دقة مخفضة
    const s = Math.min(1, 480 / Math.max(this.w, this.h));
    const W = Math.round(this.w * s), H = Math.round(this.h * s);
    const c = this.cpu.cv;
    if (c.width !== W) { c.width = W; c.height = H; this.cpu.ctx = c.getContext('2d', { willReadFrequently: true }); }
    const x = this.cpu.ctx;
    x.drawImage(v, 0, 0, W, H);
    const img = x.getImageData(0, 0, W, H), d = img.data;
    const sm = Math.max(0.005, smooth);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const cb = -0.169 * r - 0.331 * g + 0.5 * b, cr = 0.5 * r - 0.419 * g - 0.081 * b;
      const dist = Math.hypot(cb - kb, cr - kr);
      let t = Math.min(1, Math.max(0, (dist - sim) / sm)); t = t * t * (3 - 2 * t);
      const sp = Math.max(0, g - Math.max(r, b));
      d[i + 1] = Math.round((g - sp * despill) * 255);
      d[i + 3] = Math.round(t * 255);
    }
    x.putImageData(img, 0, 0);
    this.cpuOut = c;
    return true;
  }

  // يرسم الإطار الحالي (بعد إزالة الخلفية) على سياق 2D بقص يملأ الشاشة
  drawTo(ctx, W, H) {
    if (!this.renderKeyed()) return;
    const src = this.gl ? this.out : this.cpuOut;
    if (!src) return;
    const k = Math.max(W / this.w, H / this.h);
    const dw = this.w * k, dh = this.h * k;
    ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  async play() { try { await this.video.play(); } catch (e) { throw new Error('تعذّر تشغيل مقطع البداية: ' + e.message); } }
  pause() { try { this.video.pause(); } catch { /* ignore */ } }

  dispose() {
    this.pause();
    try { if (this.srcNode) this.srcNode.disconnect(); } catch { /* ignore */ }
    URL.revokeObjectURL(this.url);
    this.video.removeAttribute('src'); this.video.load();
  }
}
