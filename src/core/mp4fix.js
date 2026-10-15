// Repairs the timing of an MP4 written by Safari's MediaRecorder: it stamps the
// first sample with the phone's uptime, so Photos shows a recording as
// hundreds of hours long. The file is fixed in place (same size):
//   * fragmented files: every track's fragment times (tfdt) start from 0
//   * edit lists: an empty lead-in edit gets zero length, a media start
//     beyond the media is reset to 0, the edit covers the media
//   * a single huge sample duration (the jump from uptime) becomes a normal one
//   * movie / track / media durations are recomputed from the samples
// Returns a note of what was changed (empty when nothing was).

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'mvex', 'moof', 'traf', 'dinf']);

function boxes(dv, start, end, out = [], parent = null) {
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
    let hdr = 8;
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    const b = { type, start: p, body: p + hdr, end: p + size, parent, kids: [] };
    out.push(b);
    if (parent) parent.kids.push(b);
    if (CONTAINERS.has(type)) boxes(dv, b.body, b.end, out, b);
    p += size;
  }
  return out;
}

const kid = (b, t) => b && b.kids.find((k) => k.type === t);
const kidsOf = (b, t) => (b ? b.kids.filter((k) => k.type === t) : []);
const get = (dv, p, v1) => (v1 ? Number(dv.getBigUint64(p)) : dv.getUint32(p));
const set = (dv, p, v1, x) => { x = Math.max(0, Math.round(x)); if (v1) dv.setBigUint64(p, BigInt(x)); else dv.setUint32(p, Math.min(x, 0xffffffff)); };

// a typical value of a list of sample durations (to replace an outlier)
function typical(list) {
  const s = list.filter((x) => x > 0).sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
}

export function fixMp4Times(buf) {
  const dv = new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  const all = boxes(dv, 0, dv.byteLength);
  const notes = [];
  const moov = all.find((b) => b.type === 'moov' && !b.parent);
  if (!moov) return '';
  const mvhd = kid(moov, 'mvhd');
  const mv1 = dv.getUint8(mvhd.body) === 1;
  const movieScale = dv.getUint32(mvhd.body + (mv1 ? 20 : 12));
  const tracks = new Map();   // track id → { scale, dur (media units), tkhd, mdhd, elst }

  for (const trak of kidsOf(moov, 'trak')) {
    const tkhd = kid(trak, 'tkhd'), mdia = kid(trak, 'mdia'), mdhd = kid(mdia, 'mdhd');
    const tk1 = dv.getUint8(tkhd.body) === 1, md1 = dv.getUint8(mdhd.body) === 1;
    const id = dv.getUint32(tkhd.body + (tk1 ? 20 : 12));
    const scale = dv.getUint32(mdhd.body + (md1 ? 20 : 12));
    const t = { id, scale, dur: 0, tkhd, tk1, mdhd, md1, elst: kid(kid(trak, 'edts'), 'elst') };
    // plain (not fragmented) samples: the time-to-sample table
    const stts = kid(kid(kid(mdia, 'minf'), 'stbl'), 'stts');
    if (stts) {
      const n = dv.getUint32(stts.body + 4), deltas = [];
      for (let k = 0; k < n; k++) deltas.push(dv.getUint32(stts.body + 8 + k * 8 + 4));
      const norm = typical(deltas);
      for (let k = 0; k < n; k++) {
        const p = stts.body + 8 + k * 8, cnt = dv.getUint32(p);
        let d = dv.getUint32(p + 4);
        if (norm && d > norm * 50 && d > scale * 10) { d = norm; dv.setUint32(p + 4, d); notes.push(`stts#${id}`); }
        t.dur += cnt * d;
      }
    }
    tracks.set(id, t);
  }

  // fragments: times from 0, durations from the sample runs
  const trex = new Map();
  for (const tx of kidsOf(kid(moov, 'mvex'), 'trex')) trex.set(dv.getUint32(tx.body + 4), dv.getUint32(tx.body + 12));
  const first = new Map(), fragEnd = new Map();
  for (const traf of all.filter((b) => b.type === 'traf')) {
    const tfhd = kid(traf, 'tfhd'), tfdt = kid(traf, 'tfdt');
    if (!tfhd) continue;
    const flags = dv.getUint32(tfhd.body) & 0xffffff, id = dv.getUint32(tfhd.body + 4);
    let q = tfhd.body + 8;
    if (flags & 0x01) q += 8;
    if (flags & 0x02) q += 4;
    const defDur = flags & 0x08 ? dv.getUint32(q) : trex.get(id) || 0;
    let fdur = 0;
    for (const trun of kidsOf(traf, 'trun')) {
      const tf = dv.getUint32(trun.body) & 0xffffff, n = dv.getUint32(trun.body + 4);
      let r = trun.body + 8;
      if (tf & 0x01) r += 4;
      if (tf & 0x04) r += 4;
      const per = ((tf & 0x100) ? 4 : 0) + ((tf & 0x200) ? 4 : 0) + ((tf & 0x400) ? 4 : 0) + ((tf & 0x800) ? 4 : 0);
      for (let k = 0; k < n; k++) fdur += tf & 0x100 ? dv.getUint32(r + k * per) : defDur;
    }
    if (tfdt) {
      const v1 = dv.getUint8(tfdt.body) === 1, base = get(dv, tfdt.body + 4, v1);
      if (!first.has(id)) first.set(id, base);
      const nb = base - first.get(id);
      if (first.get(id) > 0) set(dv, tfdt.body + 4, v1, nb);
      fragEnd.set(id, Math.max(fragEnd.get(id) || 0, nb + fdur));
    } else fragEnd.set(id, (fragEnd.get(id) || 0) + fdur);
  }
  for (const [id, b] of first) if (b > 0) notes.push(`tfdt#${id}`);
  for (const [id, e] of fragEnd) { const t = tracks.get(id); if (t) t.dur = Math.max(t.dur, e); }

  // durations and edit lists
  let movieDur = 0;
  for (const t of tracks.values()) {
    if (!t.dur) continue;
    const mdDurP = t.mdhd.body + (t.md1 ? 24 : 16);
    if (get(dv, mdDurP, t.md1) !== t.dur) { set(dv, mdDurP, t.md1, t.dur); notes.push(`mdhd#${t.id}`); }
    const inMovie = (t.dur / t.scale) * movieScale;
    if (t.elst) {
      const v1 = dv.getUint8(t.elst.body) === 1, n = dv.getUint32(t.elst.body + 4), es = v1 ? 20 : 12;
      for (let k = 0; k < n; k++) {
        const p = t.elst.body + 8 + k * es;
        const seg = get(dv, p, v1);
        const mt = v1 ? Number(dv.getBigInt64(p + 8)) : dv.getInt32(p + 4);
        if (mt === -1) { if (seg) { set(dv, p, v1, 0); notes.push(`elst-empty#${t.id}`); } continue; }
        if (mt > t.dur) { if (v1) dv.setBigInt64(p + 8, 0n); else dv.setInt32(p + 4, 0); notes.push(`elst-start#${t.id}`); }
        if (Math.abs(seg - inMovie) > movieScale) { set(dv, p, v1, inMovie); notes.push(`elst-len#${t.id}`); }
      }
    }
    const tkDurP = t.tkhd.body + (t.tk1 ? 28 : 20);
    if (Math.abs(get(dv, tkDurP, t.tk1) - inMovie) > movieScale) { set(dv, tkDurP, t.tk1, inMovie); notes.push(`tkhd#${t.id}`); }
    movieDur = Math.max(movieDur, inMovie);
  }
  const mvDurP = mvhd.body + (mv1 ? 24 : 16);
  if (movieDur && Math.abs(get(dv, mvDurP, mv1) - movieDur) > movieScale) { set(dv, mvDurP, mv1, movieDur); notes.push('mvhd'); }
  const mehd = kid(kid(moov, 'mvex'), 'mehd');
  if (mehd && movieDur) {
    const v1 = dv.getUint8(mehd.body) === 1, p = mehd.body + 4;
    if (Math.abs(get(dv, p, v1) - movieDur) > movieScale) { set(dv, p, v1, movieDur); notes.push('mehd'); }
  }
  return [...new Set(notes)].join(' ');
}

// short description of the timing fields (diagnostics)
export function mp4Times(buf) {
  const dv = new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  const all = boxes(dv, 0, dv.byteLength);
  const out = [];
  const mvhd = all.find((b) => b.type === 'mvhd');
  if (mvhd) { const v1 = dv.getUint8(mvhd.body) === 1; out.push(`mvhd ${get(dv, mvhd.body + (v1 ? 24 : 16), v1) / dv.getUint32(mvhd.body + (v1 ? 20 : 12))}s`); }
  for (const b of all.filter((x) => x.type === 'elst')) {
    const v1 = dv.getUint8(b.body) === 1, n = dv.getUint32(b.body + 4), es = v1 ? 20 : 12, e = [];
    for (let k = 0; k < n; k++) { const p = b.body + 8 + k * es; e.push(`${get(dv, p, v1)}/${v1 ? Number(dv.getBigInt64(p + 8)) : dv.getInt32(p + 4)}`); }
    out.push(`elst[${e.join(',')}]`);
  }
  const tf = all.filter((x) => x.type === 'tfdt');
  if (tf.length) out.push(`tfdt0 ${get(dv, tf[0].body + 4, dv.getUint8(tf[0].body) === 1)} ×${tf.length}`);
  return out.join(' ');
}
