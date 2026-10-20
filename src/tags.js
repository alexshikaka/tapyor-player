// Чтение тегов и длительности музыкальных файлов без сторонних библиотек.
// Поддержка: MP3 (ID3v2.2/2.3/2.4 + ID3v1), FLAC, OGG (Vorbis/Opus), M4A/MP4/AAC (iTunes-теги), WAV.
// readTags(path) → { title, artist, album, albumArtist, year, track, seconds, gain, hasCover }
// readCover(path) → { mime, data } | null
const fs = require('fs');

const AUDIO_EXT = ['.mp3', '.m4a', '.m4b', '.mp4', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wav', '.webm', '.weba'];
const MAX_TAG = 24 * 1024 * 1024; // больше не читаем (огромные обложки)

async function readAt(fd, pos, len) {
  const b = Buffer.alloc(Math.max(0, len));
  if (!len) return b;
  const { bytesRead } = await fd.read(b, 0, len, pos);
  return bytesRead < len ? b.subarray(0, bytesRead) : b;
}

// --- Текст: UTF-8, UTF-16, Latin-1 или cp1251 (старые русские mp3) ---
let cp1251 = null;
try { cp1251 = new TextDecoder('windows-1251'); } catch (e) { cp1251 = null; }
function latinOr1251(buf) {
  // В cp1251 русские буквы — байты 0xC0…0xFF (+Ё/ё); в обычном Latin-1 такие байты — редкие é, ü
  let hi = 0, cyr = 0, lat = 0;
  for (const c of buf) {
    if (c >= 0x80) { hi++; if (c >= 0xC0 || c === 0xA8 || c === 0xB8) cyr++; }
    else if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) lat++;
  }
  if (hi && cp1251 && cyr / hi > 0.7 && cyr >= lat) return cp1251.decode(buf);
  return buf.toString('latin1');
}
function utf8OrOld(buf) {
  const s = buf.toString('utf8');
  return s.includes('�') ? latinOr1251(buf) : s;
}
function decodeText(enc, buf) {
  let s;
  if (enc === 1) { // UTF-16 с BOM
    if (buf[0] === 0xFE && buf[1] === 0xFF) s = swap16(buf.subarray(2)).toString('utf16le');
    else if (buf[0] === 0xFF && buf[1] === 0xFE) s = buf.subarray(2).toString('utf16le');
    else s = buf.toString('utf16le');
  } else if (enc === 2) s = swap16(buf).toString('utf16le');
  else if (enc === 3) s = buf.toString('utf8');
  else s = latinOr1251(buf);
  return s.replace(/\u0000+$/g, '').replace(/\u0000/g, ' / ').trim();
}
function swap16(b) { const c = Buffer.from(b.subarray(0, b.length - (b.length % 2))); c.swap16(); return c; }
// конец строки с учётом кодировки (для APIC/TXXX)
function termEnd(buf, pos, enc) {
  if (enc === 1 || enc === 2) { for (let i = pos; i + 1 < buf.length; i += 2) if (buf[i] === 0 && buf[i + 1] === 0) return [i, i + 2]; return [buf.length, buf.length]; }
  const i = buf.indexOf(0, pos); return i < 0 ? [buf.length, buf.length] : [i, i + 1];
}
const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
function unsync(b) { const out = []; for (let i = 0; i < b.length; i++) { out.push(b[i]); if (b[i] === 0xFF && b[i + 1] === 0x00) i++; } return Buffer.from(out); }

function gainOf(s) { const m = /([-+]?\d+(?:[.,]\d+)?)\s*dB/i.exec(String(s || '')); return m ? parseFloat(m[1].replace(',', '.')) : undefined; }
function yearOf(s) { const m = /(\d{4})/.exec(String(s || '')); return m ? +m[1] : 0; }
function trackOf(s) { const n = parseInt(String(s || ''), 10); return n > 0 ? n : 0; }

// --- ID3v2 ---
function parseId3(buf, wantCover) {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return null;
  const ver = buf[3], flags = buf[5], size = syncsafe(buf, 6);
  let body = buf.subarray(10, 10 + size);
  if ((flags & 0x80) && ver < 4) body = unsync(body);
  let pos = 0;
  if (flags & 0x40) { pos = ver === 3 ? body.readUInt32BE(0) + 4 : syncsafe(body, 0); } // расширенный заголовок
  const out = { tagSize: 10 + size + ((flags & 0x10) ? 10 : 0) }, txt = {};
  const idLen = ver === 2 ? 3 : 4, hLen = ver === 2 ? 6 : 10;
  while (pos + hLen <= body.length) {
    const id = body.toString('latin1', pos, pos + idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let fsz = ver === 2 ? (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5] : (ver === 4 ? syncsafe(body, pos + 4) : body.readUInt32BE(pos + 4));
    const fflags = ver === 2 ? 0 : body.readUInt16BE(pos + 8);
    pos += hLen;
    if (fsz <= 0 || pos + fsz > body.length) break;
    let fr = body.subarray(pos, pos + fsz);
    pos += fsz;
    if (ver === 4 && (fflags & 0x0002)) fr = unsync(fr);
    if (ver === 4 && (fflags & 0x0001)) fr = fr.subarray(4); // длина данных
    if (ver >= 3 && (fflags & (ver === 4 ? 0x000C : 0x00C0))) continue; // сжатие/шифрование — пропускаем
    if (id[0] === 'T' && id !== 'TXXX' && id !== 'TXX') { txt[id] = decodeText(fr[0], fr.subarray(1)); continue; }
    if (id === 'TXXX' || id === 'TXX') {
      const enc = fr[0], [de, vs] = termEnd(fr, 1, enc);
      const d = decodeText(enc, fr.subarray(1, de)).toUpperCase(), v = decodeText(enc, fr.subarray(vs));
      if (d === 'REPLAYGAIN_TRACK_GAIN') out.gain = gainOf(v);
      continue;
    }
    if ((id === 'APIC' || id === 'PIC') && !out.cover) {
      const enc = fr[0];
      let p = 1, mime = 'image/jpeg';
      if (id === 'PIC') { const f = fr.toString('latin1', 1, 4).toLowerCase(); mime = f === 'png' ? 'image/png' : 'image/jpeg'; p = 4; }
      else { const e = fr.indexOf(0, 1); mime = fr.toString('latin1', 1, e < 0 ? 1 : e) || 'image/jpeg'; p = e + 1; }
      p += 1; // тип картинки
      const [, ds] = termEnd(fr, p, enc);
      out.hasCover = true;
      if (wantCover) out.cover = { mime: /png/i.test(mime) ? 'image/png' : 'image/jpeg', data: Buffer.from(fr.subarray(ds)) };
    }
  }
  out.title = txt.TIT2 || txt.TT2 || '';
  out.artist = txt.TPE1 || txt.TP1 || '';
  out.albumArtist = txt.TPE2 || txt.TP2 || '';
  out.album = txt.TALB || txt.TAL || '';
  out.year = yearOf(txt.TDRC || txt.TYER || txt.TYE || txt.TDOR || '');
  out.track = trackOf(txt.TRCK || txt.TRK || '');
  const tlen = parseInt(txt.TLEN || txt.TLE || '', 10);
  if (tlen > 1000) out.tlen = tlen / 1000;
  return out;
}
function parseId3v1(b) {
  if (b.length < 128 || b.toString('latin1', 0, 3) !== 'TAG') return null;
  const f = (o, l) => { let x = b.subarray(o, o + l); const z = x.indexOf(0); if (z >= 0) x = x.subarray(0, z); return latinOr1251(x).trim(); };
  return { title: f(3, 30), artist: f(33, 30), album: f(63, 30), year: yearOf(f(93, 4)), track: b[125] === 0 && b[126] ? b[126] : 0 };
}

// --- MP3: длительность по первому кадру (Xing/VBRI или постоянный битрейт) ---
const BR = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mp3Duration(buf, start, fileSize) {
  for (let i = start; i + 4 < buf.length && i < start + 65536; i++) {
    if (buf[i] !== 0xFF || (buf[i + 1] & 0xE0) !== 0xE0) continue;
    const verBits = (buf[i + 1] >> 3) & 3, layer = (buf[i + 1] >> 1) & 3;
    const bri = buf[i + 2] >> 4, sri = (buf[i + 2] >> 2) & 3, ch = buf[i + 3] >> 6;
    if (verBits === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) continue; // только Layer III
    const kbps = BR[verBits === 3 ? 1 : 2][bri], sr = SR[verBits][sri];
    const spf = verBits === 3 ? 1152 : 576;
    const side = verBits === 3 ? (ch === 3 ? 17 : 32) : (ch === 3 ? 9 : 17);
    const x = i + 4 + side, tag = buf.toString('latin1', x, x + 4);
    if ((tag === 'Xing' || tag === 'Info') && x + 12 <= buf.length) {
      const fl = buf.readUInt32BE(x + 4);
      if (fl & 1) { const frames = buf.readUInt32BE(x + 8); if (frames) return frames * spf / sr; }
    }
    const v = i + 36;
    if (buf.toString('latin1', v, v + 4) === 'VBRI' && v + 18 <= buf.length) { const frames = buf.readUInt32BE(v + 14); if (frames) return frames * spf / sr; }
    return (fileSize - i) * 8 / (kbps * 1000);
  }
  return 0;
}

// --- Vorbis comment (FLAC, OGG) ---
function parseVorbis(b, o, out, wantCover) {
  try {
    const vl = b.readUInt32LE(o); o += 4 + vl;
    const n = b.readUInt32LE(o); o += 4;
    for (let k = 0; k < n && o + 4 <= b.length; k++) {
      const l = b.readUInt32LE(o); o += 4;
      if (o + l > b.length) break;
      const s = b.toString('utf8', o, o + l); o += l;
      const e = s.indexOf('='); if (e < 0) continue;
      const key = s.slice(0, e).toUpperCase(), val = s.slice(e + 1);
      if (key === 'TITLE' && !out.title) out.title = val;
      else if (key === 'ARTIST') out.artist = out.artist ? out.artist + ', ' + val : val;
      else if (key === 'ALBUMARTIST' || key === 'ALBUM ARTIST') out.albumArtist = val;
      else if (key === 'ALBUM') out.album = val;
      else if (key === 'DATE' || key === 'YEAR') out.year = out.year || yearOf(val);
      else if (key === 'TRACKNUMBER') out.track = trackOf(val);
      else if (key === 'REPLAYGAIN_TRACK_GAIN') out.gain = gainOf(val);
      else if (key === 'R128_TRACK_GAIN') { const q = parseInt(val, 10); if (!isNaN(q)) out.gain = q / 256 + 5; } // Opus: от −23 LUFS → к −18
      else if (key === 'METADATA_BLOCK_PICTURE') { out.hasCover = true; if (wantCover && !out.cover) out.cover = flacPicture(Buffer.from(val, 'base64'), 0); }
    }
  } catch (e) { /* испорченный тег — берём, что успели */ }
  return out;
}
function flacPicture(b, o) {
  try {
    o += 4; const ml = b.readUInt32BE(o); o += 4; const mime = b.toString('latin1', o, o + ml); o += ml;
    const dl = b.readUInt32BE(o); o += 4 + dl + 16; const len = b.readUInt32BE(o); o += 4;
    return { mime: /png/i.test(mime) ? 'image/png' : 'image/jpeg', data: Buffer.from(b.subarray(o, o + len)) };
  } catch (e) { return null; }
}
async function parseFlac(fd, size, wantCover) {
  const out = {};
  let pos = 4;
  for (let k = 0; k < 64; k++) {
    const h = await readAt(fd, pos, 4); if (h.length < 4) break;
    const last = h[0] & 0x80, type = h[0] & 0x7f, len = (h[1] << 16) | (h[2] << 8) | h[3];
    pos += 4;
    if (type === 0) {
      const b = await readAt(fd, pos, len);
      const sr = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
      const total = (b[13] & 0x0f) * 2 ** 32 + b.readUInt32BE(14);
      if (sr) out.seconds = total / sr;
    } else if (type === 4 && len < MAX_TAG) parseVorbis(await readAt(fd, pos, len), 0, out, wantCover);
    else if (type === 6) { out.hasCover = true; if (wantCover && !out.cover && len < MAX_TAG) out.cover = flacPicture(await readAt(fd, pos, len), 0); }
    pos += len;
    if (last || pos >= size) break;
  }
  return out;
}

// --- OGG: собираем пакеты первых страниц (тег может занимать несколько страниц) ---
async function parseOgg(fd, size, wantCover) {
  const head = await readAt(fd, 0, Math.min(size, MAX_TAG));
  const packets = []; let cur = []; let o = 0;
  while (o + 27 <= head.length && packets.length < 3 && head.toString('latin1', o, o + 4) === 'OggS') {
    const nseg = head[o + 26], segs = head.subarray(o + 27, o + 27 + nseg);
    let p = o + 27 + nseg;
    for (const s of segs) { cur.push(head.subarray(p, p + s)); p += s; if (s < 255) { packets.push(Buffer.concat(cur)); cur = []; if (packets.length >= 3) break; } }
    o = p;
  }
  const out = {};
  const idp = packets[0] || Buffer.alloc(0), cm = packets[1] || Buffer.alloc(0);
  let rate = 0, preskip = 0;
  if (idp.toString('latin1', 1, 7) === 'vorbis') rate = idp.readUInt32LE(12);
  else if (idp.toString('latin1', 0, 8) === 'OpusHead') { rate = 48000; preskip = idp.readUInt16LE(10); }
  if (cm.toString('latin1', 1, 7) === 'vorbis') parseVorbis(cm, 7, out, wantCover);
  else if (cm.toString('latin1', 0, 8) === 'OpusTags') parseVorbis(cm, 8, out, wantCover);
  if (rate) {
    const tail = await readAt(fd, Math.max(0, size - 65536), Math.min(size, 65536));
    const i = tail.lastIndexOf('OggS');
    if (i >= 0 && i + 14 <= tail.length) { const g = Number(tail.readBigUInt64LE(i + 6)); if (g > 0) out.seconds = (g - preskip) / rate; }
  }
  return out;
}

// --- MP4/M4A: moov → mvhd (длительность), udta/meta/ilst (теги) ---
async function parseMp4(fd, size, wantCover) {
  let pos = 0, moov = null;
  for (let k = 0; k < 200 && pos + 8 <= size; k++) {
    const h = await readAt(fd, pos, 16); if (h.length < 8) break;
    let len = h.readUInt32BE(0); const type = h.toString('latin1', 4, 8); let hl = 8;
    if (len === 1) { len = Number(h.readBigUInt64BE(8)); hl = 16; } else if (len === 0) len = size - pos;
    if (len < hl) break;
    if (type === 'moov') { if (len > 64 * 1024 * 1024) break; moov = await readAt(fd, pos + hl, len - hl); break; }
    pos += len;
  }
  const out = {};
  if (!moov) return out;
  const boxes = (b, s, e) => { const r = []; let o = s; while (o + 8 <= e) { let l = b.readUInt32BE(o); const t = b.toString('latin1', o + 4, o + 8); if (l === 0) l = e - o; if (l < 8 || o + l > e) break; r.push({ t, s: o + 8, e: o + l }); o += l; } return r; };
  const top = boxes(moov, 0, moov.length);
  const mvhd = top.find((x) => x.t === 'mvhd');
  if (mvhd) {
    const v = moov[mvhd.s];
    const ts = v === 1 ? moov.readUInt32BE(mvhd.s + 20) : moov.readUInt32BE(mvhd.s + 12);
    const du = v === 1 ? Number(moov.readBigUInt64BE(mvhd.s + 24)) : moov.readUInt32BE(mvhd.s + 16);
    if (ts) out.seconds = du / ts;
  }
  const udta = top.find((x) => x.t === 'udta');
  const meta = udta && boxes(moov, udta.s, udta.e).find((x) => x.t === 'meta');
  const ilst = meta && boxes(moov, meta.s + 4, meta.e).find((x) => x.t === 'ilst');
  if (!ilst) return out;
  for (const it of boxes(moov, ilst.s, ilst.e)) {
    const sub = boxes(moov, it.s, it.e), data = sub.find((x) => x.t === 'data');
    if (!data) continue;
    const kind = moov.readUInt32BE(data.s) & 0xffffff, val = moov.subarray(data.s + 8, data.e);
    const str = () => val.toString('utf8').trim();
    switch (it.t) {
      case '©nam': out.title = str(); break;
      case '©ART': out.artist = str(); break;
      case 'aART': out.albumArtist = str(); break;
      case '©alb': out.album = str(); break;
      case '©day': out.year = yearOf(str()); break;
      case 'trkn': if (val.length >= 4) out.track = val.readUInt16BE(2); break;
      case 'covr': out.hasCover = true; if (wantCover && !out.cover) out.cover = { mime: kind === 14 ? 'image/png' : 'image/jpeg', data: Buffer.from(val) }; break;
      case '----': {
        const nm = sub.find((x) => x.t === 'name');
        if (nm && /replaygain_track_gain/i.test(moov.toString('latin1', nm.s + 4, nm.e))) out.gain = gainOf(str());
        break;
      }
    }
  }
  return out;
}

// --- WAV ---
async function parseWav(fd, size) {
  const b = await readAt(fd, 0, Math.min(size, 1024 * 1024));
  const out = {}; let o = 12, byteRate = 0;
  while (o + 8 <= b.length) {
    const id = b.toString('latin1', o, o + 4), len = b.readUInt32LE(o + 4);
    if (id === 'fmt ') byteRate = b.readUInt32LE(o + 16);
    else if (id === 'data') { if (byteRate) out.seconds = Math.min(len, size - o - 8) / byteRate; break; }
    else if (id === 'LIST' && b.toString('latin1', o + 8, o + 12) === 'INFO') {
      let p = o + 12;
      while (p + 8 <= o + 8 + len && p + 8 <= b.length) {
        const k = b.toString('latin1', p, p + 4), l = b.readUInt32LE(p + 4);
        let v = b.subarray(p + 8, p + 8 + l); const z = v.indexOf(0); if (z >= 0) v = v.subarray(0, z);
        const s = utf8OrOld(v).trim();
        if (k === 'INAM') out.title = s; else if (k === 'IART') out.artist = s; else if (k === 'IPRD') out.album = s; else if (k === 'ICRD') out.year = yearOf(s);
        p += 8 + l + (l & 1);
      }
    }
    o += 8 + len + (len & 1);
  }
  return out;
}

async function parse(file, wantCover) {
  const fd = await fs.promises.open(file, 'r');
  try {
    const size = (await fd.stat()).size;
    const head = await readAt(fd, 0, Math.min(size, 16));
    const sig = head.toString('latin1', 0, 4);
    if (sig === 'fLaC') return await parseFlac(fd, size, wantCover);
    if (sig === 'OggS') return await parseOgg(fd, size, wantCover);
    if (sig === 'RIFF' && head.toString('latin1', 8, 12) === 'WAVE') return await parseWav(fd, size);
    if (head.toString('latin1', 4, 8) === 'ftyp') return await parseMp4(fd, size, wantCover);
    let out = {}, start = 0;
    if (head.toString('latin1', 0, 3) === 'ID3') {
      const h10 = await readAt(fd, 0, 10);
      const tsz = 10 + syncsafe(h10, 6);
      const id3 = parseId3(await readAt(fd, 0, Math.min(tsz, MAX_TAG)), wantCover) || {};
      out = id3; start = id3.tagSize || tsz;
      if (sig.slice(0, 3) === 'ID3') {
        const after = await readAt(fd, start, 16);
        if (after.toString('latin1', 0, 4) === 'fLaC') { const f = await parseFlac(fd, size, wantCover); return Object.assign(f, pick(out)); }
      }
    }
    if (!out.title || !out.artist) {
      const v1 = parseId3v1(await readAt(fd, Math.max(0, size - 128), 128));
      if (v1) for (const k of ['title', 'artist', 'album', 'year', 'track']) if (!out[k] && v1[k]) out[k] = v1[k];
    }
    if (out.tlen) out.seconds = out.tlen;
    else { const fr = await readAt(fd, start, 65536 + 512); out.seconds = mp3Duration(fr, 0, size - start); }
    return out;
  } finally { await fd.close(); }
}
function pick(o) { const r = {}; for (const k of ['title', 'artist', 'album', 'albumArtist', 'year', 'track', 'gain', 'hasCover', 'cover']) if (o[k]) r[k] = o[k]; return r; }

async function readTags(file) {
  const t = await parse(file, false);
  return { title: t.title || '', artist: t.artist || t.albumArtist || '', album: t.album || '', albumArtist: t.albumArtist || '', year: t.year || 0, track: t.track || 0, seconds: Math.round(t.seconds || 0), gain: typeof t.gain === 'number' && isFinite(t.gain) ? t.gain : undefined, hasCover: !!t.hasCover };
}
async function readCover(file) { const t = await parse(file, true); return t.cover && t.cover.data && t.cover.data.length ? t.cover : null; }

module.exports = { readTags, readCover, AUDIO_EXT, _test: { parseId3, mp3Duration, latinOr1251 } };
