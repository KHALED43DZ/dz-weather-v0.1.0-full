// تحويل MP4 «مجزَّأ» (fragmented) الذي يُنتجه MediaRecorder إلى MP4 عادي دون إعادة ترميز:
// moov كامل في بداية الملف + جداول العينات + مدة صحيحة. هذا ما تتوقعه فيسبوك ويوتيوب وتيك توك.
// وإذا كان الملف عادياً أصلاً يُرجع null.

const be32 = (n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const be16 = (n) => Uint8Array.of((n >>> 8) & 255, n & 255);
const ascii = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

function cat(parts) {
  const arr = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arr.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of arr) { out.set(a, o); o += a.length; }
  return out;
}
const box = (type, ...parts) => { const body = cat(parts); return cat([be32(body.length + 8), ascii(type), body]); };
const full = (type, version, flags, ...parts) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);
const list32 = (arr) => { const o = new Uint8Array(arr.length * 4); const dv = new DataView(o.buffer); arr.forEach((v, i) => dv.setUint32(i * 4, v >>> 0)); return o; };
const MATRIX = cat([be32(0x10000), be32(0), be32(0), be32(0), be32(0x10000), be32(0), be32(0), be32(0), be32(0x40000000)]);

function* iter(dv, start, end) {
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
    let hdr = 8;
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) return;
    yield { type, start: p, hdr, size, end: p + size, body: p + hdr };
    p += size;
  }
}
const child = (dv, b, type) => { for (const c of iter(dv, b.body, b.end)) if (c.type === type) return c; return null; };

function parseMoov(dv, moov) {
  const tracks = new Map();
  const trex = new Map();
  for (const c of iter(dv, moov.body, moov.end)) {
    if (c.type === 'mvex') {
      for (const t of iter(dv, c.body, c.end)) {
        if (t.type !== 'trex') continue;
        trex.set(dv.getUint32(t.body + 4), { dur: dv.getUint32(t.body + 12), size: dv.getUint32(t.body + 16), flags: dv.getUint32(t.body + 20) });
      }
    }
    if (c.type !== 'trak') continue;
    const tkhd = child(dv, c, 'tkhd'), mdia = child(dv, c, 'mdia');
    if (!tkhd || !mdia) continue;
    const v1 = dv.getUint8(tkhd.body) === 1;
    const id = dv.getUint32(tkhd.body + (v1 ? 20 : 12));
    const width = dv.getUint32(tkhd.body + (v1 ? 88 : 76)), height = dv.getUint32(tkhd.body + (v1 ? 92 : 80));
    const mdhd = child(dv, mdia, 'mdhd'), hdlr = child(dv, mdia, 'hdlr'), minf = child(dv, mdia, 'minf');
    const stbl = minf && child(dv, minf, 'stbl');
    const stsd = stbl && child(dv, stbl, 'stsd');
    if (!mdhd || !hdlr || !stsd) continue;
    const m1 = dv.getUint8(mdhd.body) === 1;
    const timescale = dv.getUint32(mdhd.body + (m1 ? 20 : 12));
    const handler = String.fromCharCode(dv.getUint8(hdlr.body + 8), dv.getUint8(hdlr.body + 9), dv.getUint8(hdlr.body + 10), dv.getUint8(hdlr.body + 11));
    tracks.set(id, { id, handler, timescale, width, height, hdlr, stsd, chunks: [], start: null });
  }
  return { tracks, trex };
}

function parseFragments(dv, top, tracks, trex) {
  const chunks = [];
  for (const moof of top.filter((b) => b.type === 'moof')) {
    let prevEnd = null;
    for (const traf of iter(dv, moof.body, moof.end)) {
      if (traf.type !== 'traf') continue;
      const tfhd = child(dv, traf, 'tfhd');
      if (!tfhd) continue;
      const tf = dv.getUint32(tfhd.body) & 0xffffff;
      const id = dv.getUint32(tfhd.body + 4);
      const tr = tracks.get(id);
      if (!tr) continue;
      const dflt = trex.get(id) || { dur: 0, size: 0, flags: 0 };
      let p = tfhd.body + 8, base = null;
      if (tf & 1) { base = Number(dv.getBigUint64(p)); p += 8; }
      if (tf & 2) p += 4;
      let dDur = dflt.dur, dSize = dflt.size, dFlags = dflt.flags;
      if (tf & 8) { dDur = dv.getUint32(p); p += 4; }
      if (tf & 0x10) { dSize = dv.getUint32(p); p += 4; }
      if (tf & 0x20) { dFlags = dv.getUint32(p); p += 4; }
      if (base === null) base = (tf & 0x20000) || prevEnd === null ? moof.start : prevEnd;
      const tfdt = child(dv, traf, 'tfdt');
      let tfdtVal = null;
      if (tfdt) tfdtVal = dv.getUint8(tfdt.body) === 1 ? Number(dv.getBigUint64(tfdt.body + 4)) : dv.getUint32(tfdt.body + 4);
      if (tfdtVal !== null && tr.start === null) tr.start = tfdtVal;
      let ptr = base, firstRun = true;
      for (const trun of iter(dv, traf.body, traf.end)) {
        if (trun.type !== 'trun') continue;
        const vf = dv.getUint32(trun.body), version = vf >>> 24, fl = vf & 0xffffff;
        const count = dv.getUint32(trun.body + 4);
        let q = trun.body + 8;
        if (fl & 1) { ptr = base + dv.getInt32(q); q += 4; }
        let first = null;
        if (fl & 4) { first = dv.getUint32(q); q += 4; }
        const samples = [];
        let total = 0;
        for (let i = 0; i < count; i++) {
          let dur = dDur, size = dSize, flags = i === 0 && first !== null ? first : dFlags, cts = 0;
          if (fl & 0x100) { dur = dv.getUint32(q); q += 4; }
          if (fl & 0x200) { size = dv.getUint32(q); q += 4; }
          if (fl & 0x400) { flags = dv.getUint32(q); q += 4; }
          if (fl & 0x800) { cts = version ? dv.getInt32(q) : dv.getUint32(q); q += 4; }
          samples.push({ dur, size, sync: !(flags & 0x10000), cts });
          total += size;
        }
        chunks.push({ id, off: ptr, total, samples, tfdt: firstRun ? tfdtVal : null });
        firstRun = false;
        ptr += total;
      }
      prevEnd = ptr;
    }
  }
  return chunks;
}

// نحافظ على توقيت كل جزء كما سجّله المتصفح (tfdt): الفروق الصغيرة تُمتصّ في مدة آخر عينة من الجزء السابق
function alignDurations(tr) {
  let dt = null, prev = null;
  for (const c of tr.chunks) {
    if (dt === null) dt = c.tfdt === null ? 0 : c.tfdt;
    else if (c.tfdt !== null && c.tfdt !== dt && prev) {
      const nd = Math.max(0, prev.dur + (c.tfdt - dt));
      dt += nd - prev.dur; prev.dur = nd;
    }
    for (const x of c.samples) dt += x.dur;
    prev = c.samples[c.samples.length - 1];
  }
}

function buildTrak(tr, movieDur, leadMs, chunkRel, baseOffset) {
  const all = tr.chunks.flatMap((c) => c.samples);
  const sum = all.reduce((s, x) => s + x.dur, 0);
  const durMs = Math.round((sum / tr.timescale) * 1000);
  const isV = tr.handler === 'vide', isA = tr.handler === 'soun';
  // stts
  const runs = [];
  for (const s of all) { const l = runs[runs.length - 1]; if (l && l[1] === s.dur) l[0]++; else runs.push([1, s.dur]); }
  const stts = full('stts', 0, 0, be32(runs.length), list32(runs.flat()));
  // stss (إطارات مفتاحية) للفيديو فقط
  let stss = new Uint8Array(0);
  if (isV && all.some((s) => !s.sync)) stss = full('stss', 0, 0, be32(all.filter((s) => s.sync).length), list32(all.map((s, i) => (s.sync ? i + 1 : 0)).filter(Boolean)));
  // ctts
  let ctts = new Uint8Array(0);
  if (all.some((s) => s.cts !== 0)) {
    const neg = all.some((s) => s.cts < 0);
    const cr = [];
    for (const s of all) { const l = cr[cr.length - 1]; if (l && l[1] === s.cts) l[0]++; else cr.push([1, s.cts]); }
    ctts = full('ctts', neg ? 1 : 0, 0, be32(cr.length), list32(cr.flat()));
  }
  // stsc / stsz / stco
  const sc = [];
  tr.chunks.forEach((c, i) => { const n = c.samples.length; const l = sc[sc.length - 1]; if (!l || l[1] !== n) sc.push([i + 1, n, 1]); });
  const stsc = full('stsc', 0, 0, be32(sc.length), list32(sc.flat()));
  const stsz = full('stsz', 0, 0, be32(0), be32(all.length), list32(all.map((s) => s.size)));
  const stco = full('stco', 0, 0, be32(tr.chunks.length), list32(tr.chunks.map((c) => baseOffset + chunkRel.get(c))));
  const stbl = box('stbl', tr.stsd, stts, stss, ctts, stsc, stsz, stco);
  const dinf = box('dinf', full('dref', 0, 0, be32(1), full('url ', 0, 1)));
  const minf = box('minf', isV ? full('vmhd', 0, 1, [0, 0, 0, 0, 0, 0, 0, 0]) : full('smhd', 0, 0, [0, 0, 0, 0]), dinf, stbl);
  const mdhd = full('mdhd', 0, 0, be32(0), be32(0), be32(tr.timescale), be32(sum), be16(0x55c4), be16(0));
  const mdia = box('mdia', mdhd, tr.hdlr.raw, minf);
  const trackDur = durMs + leadMs;
  const tkhd = full('tkhd', 0, 7, be32(0), be32(0), be32(tr.id), be32(0), be32(trackDur), new Uint8Array(8), be16(0), be16(0),
    be16(isA ? 0x0100 : 0), be16(0), MATRIX, be32(isV ? tr.width : 0), be32(isV ? tr.height : 0));
  let edts = new Uint8Array(0);
  if (leadMs > 0) {
    edts = box('edts', full('elst', 0, 0, be32(2), be32(leadMs), be32(0xffffffff), be16(1), be16(0), be32(durMs), be32(0), be16(1), be16(0)));
  }
  movieDur.max = Math.max(movieDur.max, trackDur);
  return box('trak', tkhd, edts, mdia);
}

// blob: MP4 مجزَّأ. الناتج: {blob, duration, samples} أو null إن لم يكن مجزَّأ.
export async function defragmentMp4(blob) {
  const ab = await blob.arrayBuffer();
  const dv = new DataView(ab);
  const top = [...iter(dv, 0, ab.byteLength)];
  if (!top.some((b) => b.type === 'moof')) return null;
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) throw new Error('الملف لا يحتوي moov');
  const { tracks, trex } = parseMoov(dv, moov);
  if (!tracks.size) throw new Error('لا توجد مسارات في الملف');
  for (const t of tracks.values()) t.hdlr.raw = new Uint8Array(ab, t.hdlr.start, t.hdlr.size);
  for (const t of tracks.values()) t.stsd = new Uint8Array(ab, t.stsd.start, t.stsd.size);
  const chunks = parseFragments(dv, top, tracks, trex);
  if (!chunks.length) throw new Error('لا توجد عينات في الملف');
  for (const c of chunks) tracks.get(c.id).chunks.push(c);
  const used = [...tracks.values()].filter((t) => t.chunks.length);
  used.forEach(alignDurations);

  // موضع كل chunk داخل mdat الجديد (بنفس ترتيب الملف الأصلي للحفاظ على التداخل)
  const chunkRel = new Map();
  let rel = 0;
  for (const c of chunks) { chunkRel.set(c, rel); rel += c.total; }
  if (rel + 16 > 0xffffffff) throw new Error('الملف أكبر من 4 غيغابايت');

  // فرق بدايات المسارات (لحفظ تزامن الصوت والصورة)
  const startSec = (t) => ((t.start || 0) / t.timescale);
  const minStart = Math.min(...used.map(startSec));
  const hasAvc = used.some((t) => t.handler === 'vide' && String.fromCharCode(...t.stsd.subarray(16, 20)) === 'avc1');
  const ftyp = box('ftyp', ascii('isom'), be32(512), ascii('isom'), ascii('iso2'), ...(hasAvc ? [ascii('avc1')] : []), ascii('mp41'));

  const build = (baseOffset) => {
    const movieDur = { max: 0 };
    const traks = used.map((t) => buildTrak(t, movieDur, Math.round((startSec(t) - minStart) * 1000), chunkRel, baseOffset));
    const mvhd = full('mvhd', 0, 0, be32(0), be32(0), be32(1000), be32(movieDur.max), be32(0x10000), be16(0x0100), be16(0),
      new Uint8Array(8), MATRIX, new Uint8Array(24), be32(Math.max(...used.map((t) => t.id)) + 1));
    return { moov: box('moov', mvhd, ...traks), dur: movieDur.max };
  };
  const pass1 = build(0);
  const mdatStart = ftyp.length + pass1.moov.length + 8;
  const { moov: moovBytes, dur } = build(mdatStart);

  const parts = [ftyp, moovBytes, be32(rel + 8), ascii('mdat')];
  let i = 0;
  while (i < chunks.length) { // دمج المقاطع المتجاورة في قطعة واحدة
    let j = i, a = chunks[i].off, b = a + chunks[i].total;
    while (j + 1 < chunks.length && chunks[j + 1].off === b) { j++; b += chunks[j].total; }
    parts.push(blob.slice(a, b));
    i = j + 1;
  }
  const out = new Blob(parts, { type: 'video/mp4' });
  if (out.size !== ftyp.length + moovBytes.length + 8 + rel) throw new Error('حجم الملف الناتج غير متوقع');
  return { blob: out, duration: dur / 1000, samples: chunks.reduce((s, c) => s + c.samples.length, 0) };
}
