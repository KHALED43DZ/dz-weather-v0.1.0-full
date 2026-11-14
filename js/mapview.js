// رسم الخريطة المتحركة والمذيع والتعليقات على canvas (يُستعمل للمعاينة وللتسجيل)
import { OUTLINE, NEIGHBORS } from './outline.js';
import { WILAYAS, REGIONS } from './wilayas.js';
import { tempColor, catOf } from './weather.js';

const D2R = Math.PI / 180;
const LON0 = 2.5, LAT0 = 28;
const KX = Math.cos(LAT0 * D2R);
const proj = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0)];
export const FONT = "system-ui, 'Noto Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const ease = (u) => { u = clamp(u, 0, 1); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const fract = (x) => x - Math.floor(x);
const hash = (i, k) => fract(Math.sin(i * 127.1 + k * 311.7) * 43758.5453);

// صناديق المناطق (خط الطول/العرض)
const BOX = {};
for (const id of Object.keys(REGIONS)) {
  const m = WILAYAS.filter((w) => w.r === id);
  BOX[id] = {
    lon0: Math.min(...m.map((w) => w.lon)), lon1: Math.max(...m.map((w) => w.lon)),
    lat0: Math.min(...m.map((w) => w.lat)), lat1: Math.max(...m.map((w) => w.lat)),
  };
}
BOX.all = { lon0: -8.67, lon1: 12.0, lat0: 19.2, lat1: 37.4 };

function rgbOf(str) {
  if (str[0] === '#') return [1, 3, 5].map((i) => parseInt(str.slice(i, i + 2), 16));
  return str.match(/\d+/g).slice(0, 3).map(Number);
}
const rgba = (str, a) => { const [r, g, b] = rgbOf(str); return `rgba(${r},${g},${b},${a})`; };

export function layout(W, H) {
  const u = Math.min(W, H) / 720;
  if (H >= W) {
    return {
      u, vertical: true,
      header: { x: 0, y: 0, w: W, h: 170 * u },
      view: { x: 0, y: 170 * u, w: W, h: H - 170 * u - 400 * u },
      caption: { x: 30 * u, y: H - 330 * u, w: W - 60 * u, h: 290 * u },
      pres: { x: 105 * u, y: H - 352 * u, r: 66 * u },
      font: 33 * u, maxLines: 5,
    };
  }
  return {
    u, vertical: false,
    header: { x: 0, y: 0, w: W, h: 100 * u },
    view: { x: 0, y: 100 * u, w: W - 440 * u, h: H - 100 * u },
    caption: { x: W - 430 * u, y: 385 * u, w: 410 * u, h: H - 405 * u },
    pres: { x: W - 225 * u, y: 245 * u, r: 90 * u },
    font: 27 * u, maxLines: 7,
  };
}

function cloud(ctx, x, y, r, fill, shade) {
  const parts = [[-0.45, 0.1, 0.38], [-0.05, -0.18, 0.5], [0.42, 0.05, 0.4]];
  ctx.save();
  for (const pass of shade ? [1, 0] : [0]) {
    ctx.fillStyle = pass ? shade : fill;
    const dy = pass ? r * 0.07 : 0;
    for (const [px, py, pr] of parts) { ctx.beginPath(); ctx.arc(x + px * r, y + py * r + dy, pr * r, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - 0.55 * r, y + 0.02 * r + dy, 1.5 * r, 0.46 * r, 0.23 * r);
    else ctx.rect(x - 0.55 * r, y + 0.02 * r + dy, 1.5 * r, 0.46 * r);
    ctx.fill();
  }
  ctx.restore();
}

function sunShape(ctx, x, y, r, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 0.4);
  ctx.strokeStyle = '#FFB300'; ctx.lineWidth = r * 0.16; ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.beginPath(); ctx.moveTo(r * 1.25, 0); ctx.lineTo(r * 1.6, 0); ctx.stroke();
  }
  ctx.restore();
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, '#FFE680'); g.addColorStop(1, '#FFB300');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

export function drawIcon(ctx, cat, x, y, r, t) {
  ctx.save();
  switch (cat) {
    case 'clear': sunShape(ctx, x, y, r * 0.5, t); break;
    case 'partly':
      sunShape(ctx, x - r * 0.28, y - r * 0.22, r * 0.36, t);
      cloud(ctx, x + r * 0.08, y + r * 0.12, r * 0.85, '#FFFFFF', '#C9D8EA'); break;
    case 'cloudy':
      cloud(ctx, x - r * 0.15, y - r * 0.12, r * 0.7, '#AEBBCB', null);
      cloud(ctx, x + r * 0.05, y + r * 0.1, r * 0.85, '#F1F5FA', '#C9D8EA'); break;
    case 'rain': {
      cloud(ctx, x, y - r * 0.2, r * 0.9, '#C5D3E4', '#8FA5BF');
      ctx.strokeStyle = '#2F8CF5'; ctx.lineWidth = r * 0.12; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const k = fract(t * 1.3 + i * 0.33);
        const dx = x + (i - 1) * r * 0.42, dy = y + r * 0.25 + k * r * 0.4;
        ctx.globalAlpha = 1 - k * 0.6;
        ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx - r * 0.1, dy + r * 0.26); ctx.stroke();
      }
      break;
    }
    case 'storm': {
      cloud(ctx, x, y - r * 0.2, r * 0.9, '#6E7D93', '#4A576B');
      ctx.fillStyle = Math.sin(t * 9) > 0.2 ? '#FFE14D' : '#FFB300';
      ctx.beginPath();
      ctx.moveTo(x + r * 0.05, y + r * 0.1); ctx.lineTo(x - r * 0.22, y + r * 0.5); ctx.lineTo(x - r * 0.02, y + r * 0.48);
      ctx.lineTo(x - r * 0.14, y + r * 0.85); ctx.lineTo(x + r * 0.28, y + r * 0.38); ctx.lineTo(x + r * 0.06, y + r * 0.4);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'snow': {
      cloud(ctx, x, y - r * 0.2, r * 0.9, '#E6EEF8', '#B5C6DC');
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#6FA8DC'; ctx.lineWidth = r * 0.03;
      for (let i = 0; i < 3; i++) {
        const k = fract(t * 0.7 + i * 0.33);
        ctx.beginPath(); ctx.arc(x + (i - 1) * r * 0.42 + Math.sin(t * 3 + i) * r * 0.06, y + r * 0.3 + k * r * 0.4, r * 0.09, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      break;
    }
    case 'fog': {
      cloud(ctx, x, y - r * 0.25, r * 0.85, '#DCE3EB', '#B8C3D0');
      ctx.strokeStyle = '#9FB0C3'; ctx.lineWidth = r * 0.1; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const o = Math.sin(t * 1.5 + i) * r * 0.08;
        ctx.beginPath(); ctx.moveTo(x - r * 0.55 + o, y + r * (0.3 + i * 0.22)); ctx.lineTo(x + r * 0.55 + o, y + r * (0.3 + i * 0.22)); ctx.stroke();
      }
      break;
    }
    default: break;
  }
  ctx.restore();
}

function drawPresenter(ctx, cx, cy, r, level, t, name, u, nameBelow = true) {
  const bob = Math.sin(t * 3) * r * 0.03 - level * r * 0.04;
  cy += bob;
  ctx.save();
  // أشعة
  ctx.translate(cx, cy); ctx.rotate(t * 0.25);
  ctx.fillStyle = '#FFB300';
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath(); ctx.moveTo(r * 1.0, -r * 0.13); ctx.lineTo(r * 1.38 + level * r * 0.12, 0); ctx.lineTo(r * 1.0, r * 0.13); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // الوجه
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#FFEA8A'); g.addColorStop(1, '#FFC21A');
  ctx.fillStyle = g; ctx.strokeStyle = '#E39A00'; ctx.lineWidth = 3 * u;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // الشاشية
  ctx.fillStyle = '#C62828'; ctx.strokeStyle = '#8E1B1B'; ctx.lineWidth = 2 * u;
  ctx.beginPath(); ctx.ellipse(cx, cy - r * 0.86, r * 0.6, r * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#B71C1C';
  ctx.beginPath(); ctx.ellipse(cx, cy - r * 0.96, r * 0.42, r * 0.17, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 3 * u; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx + r * 0.05, cy - r * 1.02); ctx.quadraticCurveTo(cx + r * 0.5, cy - r * 1.05, cx + r * 0.52, cy - r * 0.78); ctx.stroke();
  // العينان
  const blink = fract(t / 3.4) < 0.045 ? 0.15 : 1;
  ctx.fillStyle = '#2b1a0a';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(cx + s * r * 0.33, cy - r * 0.12, r * 0.075, r * 0.115 * blink, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#7a4a10'; ctx.lineWidth = 3.5 * u;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.arc(cx + s * r * 0.33, cy - r * (0.36 + level * 0.06), r * 0.15, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  }
  // الخدّان
  ctx.fillStyle = 'rgba(255,120,100,0.35)';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + s * r * 0.56, cy + r * 0.12, r * 0.13, 0, Math.PI * 2); ctx.fill(); }
  // الفم
  const open = 0.04 + clamp(level, 0, 1) * 0.55;
  ctx.fillStyle = '#7A1F1F';
  ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.42, r * (0.24 + open * 0.08), r * (0.045 + open * 0.2), 0, 0, Math.PI * 2); ctx.fill();
  if (open > 0.2) { ctx.fillStyle = '#E8707A'; ctx.beginPath(); ctx.ellipse(cx, cy + r * (0.42 + open * 0.12), r * 0.12, r * open * 0.08, 0, 0, Math.PI * 2); ctx.fill(); }
  // الشارب
  ctx.fillStyle = '#4A2C14';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(cx + s * r * 0.17, cy + r * 0.24, r * 0.2, r * 0.065, s * 0.35, 0, Math.PI * 2); ctx.fill();
  }
  if (!nameBelow) return;
  // بطاقة الاسم
  ctx.font = `bold ${22 * u}px ${FONT}`;
  ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(name).width + 34 * u;
  const ty = cy + r * 1.22 - bob;
  ctx.fillStyle = '#C62828';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(cx - tw / 2, ty - 18 * u, tw, 36 * u, 18 * u); else ctx.rect(cx - tw / 2, ty - 18 * u, tw, 36 * u);
  ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(name, cx, ty + 1 * u);
}

function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

export class Scene {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.wrapCache = new Map();
    this.setSize(720, 1280);
  }

  setSize(W, H) {
    this.cv.width = W; this.cv.height = H;
    this.W = W; this.H = H;
    this.L = layout(W, H);
    this.wrapCache.clear();
  }

  camFor(region) {
    const L = this.L, u = L.u;
    const b = BOX[region] || BOX.all;
    const pad = region === 'all' ? 0 : 1.4;
    let [x0, y1] = proj(b.lon0 - pad, b.lat0 - pad);
    let [x1, y0] = proj(b.lon1 + pad, b.lat1 + pad);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const w = Math.max(x1 - x0, region === 'all' ? 0 : 6.5);
    const h = Math.max(y1 - y0, region === 'all' ? 0 : 5.5);
    const s = Math.min((L.view.w * 0.94) / w, (L.view.h * 0.94) / h);
    return { cx, cy, s: Math.min(s, 120 * u) };
  }

  lerpCam(a, b, k) {
    return { cx: a.cx + (b.cx - a.cx) * k, cy: a.cy + (b.cy - a.cy) * k, s: a.s * Math.pow(b.s / a.s, k) };
  }

  toScreen(cam, lon, lat) {
    const v = this.L.view;
    const [px, py] = proj(lon, lat);
    return [v.x + v.w / 2 + (px - cam.cx) * cam.s, v.y + v.h / 2 + (py - cam.cy) * cam.s];
  }

  lines(text, font, maxW) {
    const key = font + '|' + maxW + '|' + text;
    let r = this.wrapCache.get(key);
    if (!r) {
      this.ctx.font = font;
      r = wrap(this.ctx, text, maxW);
      this.wrapCache.set(key, r);
    }
    return r;
  }

  draw(st) {
    const { ctx, W, H, L } = this;
    const u = L.u, t = st.t || 0, cam = st.cam || this.camFor('all');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round';

    // البحر
    const sea = ctx.createLinearGradient(0, 0, 0, H);
    sea.addColorStop(0, '#0B3556'); sea.addColorStop(0.5, '#1B6A97'); sea.addColorStop(1, '#2E8DB5');
    ctx.fillStyle = sea; ctx.fillRect(0, 0, W, H);
    // موجات خفيفة
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 2 * u;
    for (let i = 0; i < 9; i++) {
      const y = ((i * 0.12 + t * 0.012) % 1) * H;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 24 * u) ctx.lineTo(x, y + Math.sin(x / (60 * u) + t + i) * 6 * u);
      ctx.stroke();
    }

    // اليابسة
    const land = new Path2D();
    OUTLINE.forEach(([lo, la], i) => {
      const [x, y] = this.toScreen(cam, lo, la);
      if (i) land.lineTo(x, y); else land.moveTo(x, y);
    });
    land.closePath();
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 18 * u; ctx.shadowOffsetY = 6 * u;
    ctx.fillStyle = '#EADFC0'; ctx.fill(land);
    ctx.restore();

    // خريطة حرارية
    ctx.save();
    ctx.clip(land);
    if (st.snap) {
      const rad = 2.5 * cam.s;
      for (const w of WILAYAS) {
        const d = st.snap.w[w.c];
        if (!d) continue;
        const [x, y] = this.toScreen(cam, w.lon, w.lat);
        if (x < -rad || x > W + rad || y < -rad || y > H + rad) continue;
        const col = tempColor(d.tx);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, rgba(col, 0.85)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3 * u; ctx.stroke(land);

    // أسماء ثابتة
    ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${22 * u}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (const n of NEIGHBORS) { const [x, y] = this.toScreen(cam, n.lon, n.lat); const hw = ctx.measureText(n.ar).width / 2 + 10 * u; ctx.fillText(n.ar, clamp(x, hw, W - hw), y); }
    ctx.font = `italic ${26 * u}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    { const [x, y] = this.toScreen(cam, 3.2, 38.3); const hw = ctx.measureText('البحر الأبيض المتوسط').width / 2 + 10 * u; if (y > L.header.h + 14 * u) ctx.fillText('البحر الأبيض المتوسط', clamp(x, hw, W - hw), y); }

    // جسيمات الطقس
    const region = st.region || 'all';
    const rs = st.summary && st.summary.regions[region];
    this.particles(rs ? rs.dominant : null, t);

    // إطار المنطقة
    if (region !== 'all' && BOX[region]) {
      const b = BOX[region];
      const [x0, y1] = this.toScreen(cam, b.lon0, b.lat0), [x1, y0] = this.toScreen(cam, b.lon1, b.lat1);
      const pad = 1.0 * cam.s;
      ctx.save();
      ctx.setLineDash([16 * u, 11 * u]); ctx.lineDashOffset = -t * 40 * u;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 4 * u;
      ctx.beginPath();
      ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 + pad, (y1 - y0) / 2 + pad, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // علامات الولايات
    if (st.snap) this.markers(cam, st, region, t);

    // الرأس
    this.header(st);
    // المذيع والتعليق
    if (st.intro) return; // أثناء مقطع البداية: الخريطة والعنوان فقط
    this.caption(st, region);
    const pname = st.presenter || 'عمي الطقس';
    drawPresenter(ctx, L.pres.x, L.pres.y, L.pres.r, st.level || 0, t, pname, u, !L.vertical);
    if (L.vertical) {
      ctx.font = `bold ${21 * u}px ${FONT}`; ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const cw = ctx.measureText(pname).width + 30 * u, cx0 = L.pres.x + L.pres.r * 1.5;
      ctx.fillStyle = '#C62828'; rrect(ctx, cx0, L.caption.y - 16 * u, cw, 34 * u, 17 * u); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(pname, cx0 + cw / 2, L.caption.y + 2 * u);
    }
  }

  particles(cat, t) {
    const { ctx, W, L } = this;
    const u = L.u, v = L.view;
    ctx.save();
    ctx.beginPath(); ctx.rect(v.x, v.y, v.w, v.h); ctx.clip();
    if (cat === 'rain' || cat === 'storm') {
      ctx.strokeStyle = cat === 'storm' ? 'rgba(200,215,240,0.6)' : 'rgba(190,220,255,0.55)'; ctx.lineWidth = 2 * u;
      for (let i = 0; i < 70; i++) {
        const x = v.x + hash(i, 1) * v.w;
        const y = v.y + ((hash(i, 2) * v.h + t * 700 * (0.7 + hash(i, 3) * 0.6)) % (v.h + 60 * u)) - 30 * u;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 7 * u, y + 24 * u); ctx.stroke();
      }
      if (cat === 'storm' && fract(t * 0.43) < 0.06) { ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(v.x, v.y, v.w, v.h); }
    } else if (cat === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 60; i++) {
        const x = v.x + hash(i, 4) * v.w + Math.sin(t * 1.2 + i) * 14 * u;
        const y = v.y + ((hash(i, 5) * v.h + t * 90 * (0.6 + hash(i, 6))) % v.h);
        ctx.beginPath(); ctx.arc(x, y, (2 + hash(i, 7) * 3.5) * u, 0, Math.PI * 2); ctx.fill();
      }
    } else if (cat === 'fog') {
      for (let i = 0; i < 6; i++) {
        const x = v.x + ((hash(i, 8) * v.w + t * 18 * (1 + i * 0.2)) % (v.w + 400 * u)) - 200 * u;
        const y = v.y + (0.1 + 0.16 * i) * v.h;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 220 * u);
        g.addColorStop(0, 'rgba(240,245,250,0.5)'); g.addColorStop(1, 'rgba(240,245,250,0)');
        ctx.fillStyle = g; ctx.fillRect(x - 220 * u, y - 220 * u, 440 * u, 440 * u);
      }
    } else if (cat === 'clear') {
      const g = ctx.createRadialGradient(v.x + v.w * 0.15, v.y, 0, v.x + v.w * 0.15, v.y, v.w * 0.8);
      g.addColorStop(0, 'rgba(255,220,100,0.38)'); g.addColorStop(1, 'rgba(255,220,100,0)');
      ctx.fillStyle = g; ctx.fillRect(v.x, v.y, v.w, v.h);
    } else if (cat === 'cloudy' || cat === 'partly') {
      for (let i = 0; i < 4; i++) {
        const x = v.x + ((hash(i, 9) * v.w + t * 22 * (0.6 + hash(i, 10))) % (v.w + 300 * u)) - 150 * u;
        const y = v.y + (0.08 + hash(i, 11) * 0.7) * v.h;
        ctx.globalAlpha = cat === 'cloudy' ? 0.42 : 0.26;
        cloud(ctx, x, y, (70 + hash(i, 12) * 60) * u, '#FFFFFF', null);
      }
    }
    ctx.restore();
  }

  markers(cam, st, region, t) {
    const { ctx, W, H, L } = this;
    const u = L.u;
    const alpha = clamp((st.itemT ?? 9) / 0.7, 0, 1);
    const spot = new Set(st.item ? st.item.spotlight || [] : []);
    const rects = [];
    const hits = (r, me) => rects.some((q) => q.own !== me && r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
    const list = WILAYAS.filter((w) => (region === 'all' ? w.major : w.r === region) || spot.has(w.c));
    ctx.save();
    ctx.globalAlpha = alpha;
    const pins = [];
    for (const w of list) {
      const d = st.snap.w[w.c];
      const [x, y] = this.toScreen(cam, w.lon, w.lat);
      if (x < -30 || x > W + 30 || y < -30 || y > H + 30) continue;
      pins.push({ w, d, x, y, sp: spot.has(w.c) });
    }
    // البقع الصغيرة أولاً ثم المُبرَزة فوقها
    pins.sort((a, b) => a.sp - b.sp);
    for (const p of pins) { const q = ((p.sp ? 21 : 15) + 9) * u; rects.push({ x: p.x - q, y: p.y - q, w: 2 * q, h: 2 * q, own: p }); }
    for (const p of pins) {
      const r = (p.sp ? 21 : 15) * u;
      const col = tempColor(p.d.tx);
      if (p.sp) {
        const k = fract(t * 0.9);
        ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`; ctx.lineWidth = 4 * u;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + k * 30 * u, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.5 * u;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.direction = 'ltr'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `bold ${(p.sp ? 19 : 15) * u}px ${FONT}`;
      ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 3 * u;
      ctx.fillText(String(p.d.tx), p.x, p.y + 1 * u);
      ctx.shadowBlur = 0;
      ctx.direction = 'rtl';
    }
    // بطاقات الولايات المُبرَزة
    for (const p of pins.filter((q) => q.sp || region === 'all')) {
      const name = p.w.ar;
      const small = !p.sp;
      const fs = (small ? 19 : 22) * u;
      ctx.font = `bold ${fs}px ${FONT}`;
      let tw = ctx.measureText(name).width;
      if (!small) { ctx.font = `${19 * u}px ${FONT}`; tw = Math.max(tw, ctx.measureText(`${p.d.tx}° / ${p.d.tn}°`).width); ctx.font = `bold ${fs}px ${FONT}`; }
      const ih = small ? 0 : 56 * u;
      const bw = tw + 26 * u + ih, bh = (small ? 34 : 60) * u;
      const cands = [[0, 1], [0, -1], [1, 0], [-1, 0], [0, 2], [0, -2]];
      let best = null;
      for (const [cx, cy] of cands) {
        const rx = p.x - bw / 2 + cx * (bw / 2 + 24 * u);
        const ry = p.y + (cy > 0 ? 28 * u + (cy - 1) * (bh + 6 * u) : cy < 0 ? -28 * u - bh + (cy + 1) * (bh + 6 * u) : -bh / 2);
        const rr = { x: rx, y: ry, w: bw, h: bh };
        if (rr.x < 6 || rr.x + rr.w > W - 6 || rr.y < L.header.h * 0.6 || rr.y + rr.h > H - 20) continue;
        if (!hits(rr, p)) { best = rr; break; }
        if (!best) best = rr;
      }
      if (!best) continue;
      rects.push(best);
      ctx.fillStyle = small ? 'rgba(10,34,60,0.72)' : 'rgba(10,34,60,0.92)';
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2 * u;
      rrect(ctx, best.x, best.y, best.w, best.h, 14 * u); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tx0 = best.x + best.w / 2 - ih / 2 * -1 * 0; // مركز النص
      if (small) {
        ctx.fillText(name, best.x + best.w / 2, best.y + best.h / 2 + 1 * u);
      } else {
        const textCx = best.x + (best.w - ih) / 2;
        ctx.fillText(name, textCx, best.y + 20 * u);
        ctx.direction = 'ltr';
        ctx.font = `${19 * u}px ${FONT}`;
        ctx.fillStyle = '#FFD166';
        ctx.fillText(`${p.d.tx}° / ${p.d.tn}°`, textCx, best.y + 43 * u);
        ctx.direction = 'rtl';
        drawIcon(ctx, catOf(p.d.wc), best.x + best.w - ih / 2 - 2 * u, best.y + best.h / 2, 22 * u, t);
      }
      void tx0;
    }
    ctx.restore();
  }

  header(st) {
    const { ctx, W, L } = this;
    const u = L.u, h = L.header;
    const g = ctx.createLinearGradient(0, 0, 0, h.h * 1.25);
    g.addColorStop(0, 'rgba(6,24,46,0.96)'); g.addColorStop(0.75, 'rgba(6,24,46,0.8)'); g.addColorStop(1, 'rgba(6,24,46,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, h.h * 1.25);
    ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const mid = L.vertical ? W / 2 : (W - 440 * u) / 2 + 20 * u;
    let fs = (L.vertical ? 48 : 40) * u;
    const title = st.headline || 'نشرة الطقس في الجزائر';
    ctx.font = `bold ${fs}px ${FONT}`;
    const maxW = (L.vertical ? W : W - 460 * u) - 60 * u;
    while (ctx.measureText(title).width > maxW && fs > 22 * u) { fs -= 2 * u; ctx.font = `bold ${fs}px ${FONT}`; }
    ctx.fillStyle = '#fff'; ctx.fillText(title, mid, h.h * (L.vertical ? 0.36 : 0.4));
    ctx.font = `${(L.vertical ? 29 : 25) * u}px ${FONT}`;
    ctx.fillStyle = '#FFD166';
    ctx.fillText(`${st.dateFull || ''}`, mid, h.h * (L.vertical ? 0.72 : 0.78));
  }

  caption(st, region) {
    const { ctx, L } = this;
    const u = L.u, c = L.caption;
    ctx.save();
    ctx.fillStyle = 'rgba(6,24,46,0.9)'; ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2 * u;
    rrect(ctx, c.x, c.y, c.w, c.h, 26 * u); ctx.fill(); ctx.stroke();
    const text = (st.item && st.item.text) || st.captionText || '';
    const font = `${L.font}px ${FONT}`;
    ctx.font = font; ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = this.lines(text, font, c.w - 52 * u);
    const per = L.maxLines;
    const pages = Math.max(1, Math.ceil(lines.length / per));
    const prog = st.item ? clamp(st.item.progress, 0, 0.999) : 0;
    const page = Math.min(pages - 1, Math.floor(prog * pages));
    const shown = lines.slice(page * per, page * per + per);
    const lh = L.font * 1.5;
    const top = c.y + c.h / 2 - (shown.length * lh) / 2 + lh / 2 + 6 * u;
    ctx.fillStyle = '#fff';
    shown.forEach((ln, i) => ctx.fillText(ln, c.x + c.w / 2, top + i * lh));
    // وسم المنطقة
    if (region && region !== 'all' && REGIONS[region]) {
      ctx.font = `bold ${21 * u}px ${FONT}`;
      const lab = REGIONS[region].ar;
      const w = ctx.measureText(lab).width + 30 * u;
      ctx.fillStyle = '#F2B400';
      rrect(ctx, c.x + c.w - w - 18 * u, c.y - 16 * u, w, 34 * u, 17 * u); ctx.fill();
      ctx.fillStyle = '#10243d'; ctx.fillText(lab, c.x + c.w - w / 2 - 18 * u, c.y + 2 * u);
    }
    // شريط التقدم
    if (pages > 1) {
      const bw = (c.w - 80 * u) / pages;
      for (let i = 0; i < pages; i++) {
        ctx.fillStyle = i === page ? '#F2B400' : 'rgba(255,255,255,0.25)';
        rrect(ctx, c.x + 40 * u + i * bw + 3 * u, c.y + c.h - 16 * u, bw - 6 * u, 6 * u, 3 * u); ctx.fill();
      }
    }
    ctx.restore();
  }
}
