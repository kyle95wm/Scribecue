// Zip files, stored without compression: the narration and session packages, whose WAVs
// don't shrink. The WAVs stay Blobs throughout, read a chunk at a time for their checksums,
// so a long programme's narration never has to fit in memory. Past 4 GB, Zip64.

const CHUNK = 1 << 20;
const MAX = 0xffffffff; // past this, a size or offset needs Zip64

let table = null;
function crcTable() {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

// The CRC-32 of bytes, carrying on from crc.
export function crc32(bytes, crc = 0) {
  const t = crcTable();
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// DOS time and date, as zip headers keep them.
function dos(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

const yieldNow = () => new Promise((ok) => setTimeout(ok));

// The CRC-32 of a Blob, a chunk at a time, letting the page draw between chunks.
export async function blobCrc(blob, progress = () => {}) {
  let crc = 0;
  for (let at = 0; at < blob.size; at += CHUNK) {
    crc = crc32(new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer()), crc);
    progress(Math.min(CHUNK, blob.size - at));
    await yieldNow();
  }
  return crc;
}

const u64 = (view, o, v) => view.setBigUint64(o, BigInt(v), true);

// files: [{ name, blob, crc? }]: crc, when it's known already, saves reading the file for it.
// progress(done, total) is called as the checksums are worked out, in bytes. zip64: always
// write Zip64 records, as past 4 GB (for tests). Returns a Blob.
export async function storeZip(files, { date = new Date(), progress = () => {}, zip64 = false } = {}) {
  const enc = new TextEncoder(), { time, date: day } = dos(date);
  const total = files.reduce((n, f) => n + (f.crc == null ? f.blob.size : 0), 0);
  const parts = [], central = [];
  let offset = 0, done = 0;
  for (const f of files) {
    const size = f.blob.size;
    const crc = f.crc ?? await blobCrc(f.blob, (n) => { done += n; progress(done, total); });
    const name = enc.encode(f.name), big = zip64 || size >= MAX, far = zip64 || offset >= MAX;
    // Local header: with Zip64, both sizes go in its extra field.
    const head = new DataView(new ArrayBuffer(30 + (big ? 20 : 0)));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, big ? 45 : 20, true); head.setUint16(6, 0x0800, true); // UTF-8 names
    head.setUint16(10, time, true); head.setUint16(12, day, true); head.setUint32(14, crc, true);
    head.setUint32(18, big ? MAX : size, true); head.setUint32(22, big ? MAX : size, true); head.setUint16(26, name.length, true);
    head.setUint16(28, big ? 20 : 0, true);
    if (big) { head.setUint16(30, 1, true); head.setUint16(32, 16, true); u64(head, 34, size); u64(head, 42, size); }
    // Central record: with Zip64, only the fields that don't fit go in its extra field.
    const extra = (big ? 16 : 0) + (far ? 8 : 0), dir = new DataView(new ArrayBuffer(46 + (extra ? 4 + extra : 0)));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, extra ? 45 : 20, true); dir.setUint16(6, extra ? 45 : 20, true); dir.setUint16(8, 0x0800, true);
    dir.setUint16(12, time, true); dir.setUint16(14, day, true); dir.setUint32(16, crc, true);
    dir.setUint32(20, big ? MAX : size, true); dir.setUint32(24, big ? MAX : size, true); dir.setUint16(28, name.length, true);
    dir.setUint16(30, extra ? 4 + extra : 0, true);
    dir.setUint32(42, far ? MAX : offset, true);
    if (extra) {
      dir.setUint16(46, 1, true); dir.setUint16(48, extra, true);
      let o = 50;
      if (big) { u64(dir, o, size); u64(dir, o + 8, size); o += 16; }
      if (far) u64(dir, o, offset);
    }
    parts.push(head.buffer, name, f.blob);
    central.push(new Uint8Array(dir.buffer, 0, 46), name, new Uint8Array(dir.buffer, 46));
    offset += head.byteLength + name.length + size;
  }
  const size = central.reduce((n, p) => n + p.byteLength, 0);
  const tail = [];
  if (zip64 || offset >= MAX || size >= MAX || files.length >= 0xffff) {
    const rec = new DataView(new ArrayBuffer(56)), loc = new DataView(new ArrayBuffer(20));
    rec.setUint32(0, 0x06064b50, true); u64(rec, 4, 44); rec.setUint16(12, 45, true); rec.setUint16(14, 45, true);
    u64(rec, 24, files.length); u64(rec, 32, files.length); u64(rec, 40, size); u64(rec, 48, offset);
    loc.setUint32(0, 0x07064b50, true); u64(loc, 8, offset + size); loc.setUint32(16, 1, true);
    tail.push(rec.buffer, loc.buffer);
  }
  const end = new DataView(new ArrayBuffer(22)), many = tail.length;
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, many ? 0xffff : files.length, true); end.setUint16(10, many ? 0xffff : files.length, true);
  end.setUint32(12, many ? MAX : size, true); end.setUint32(16, many ? MAX : offset, true);
  return new Blob([...parts, ...central, ...tail, end.buffer], { type: 'application/zip' });
}

// The files stored in a zip, as [{ name, blob }], each a slice of the file, so nothing is
// read but the directory. Compressed files are left out. Returns null if it isn't a zip.
export async function readZip(file) {
  const bytes = async (o, n) => new DataView(await file.slice(o, o + n).arrayBuffer());
  const n64 = (v, o) => Number(v.getBigUint64(o, true));
  try {
    const tail = Math.min(file.size, 22 + 0xffff), from = file.size - tail, t = await bytes(from, tail);
    let e = -1;
    for (let o = tail - 22; o >= 0; o--) if (t.getUint32(o, true) === 0x06054b50) { e = o; break; }
    if (e < 0) return null;
    let count = t.getUint16(e + 10, true), dirSize = t.getUint32(e + 12, true), dirAt = t.getUint32(e + 16, true);
    // Zip64: the end record's locator, just before it, says where the real figures are.
    if (e >= 20 && t.getUint32(e - 20, true) === 0x07064b50) {
      const z = await bytes(n64(t, e - 12), 56);
      if (z.getUint32(0, true) !== 0x06064b50) return null;
      count = n64(z, 32); dirSize = n64(z, 40); dirAt = n64(z, 48);
    }
    const dir = await bytes(dirAt, dirSize);
    const out = [], dec = new TextDecoder();
    for (let o = 0, k = 0; k < count && o + 46 <= dir.byteLength; k++) {
      if (dir.getUint32(o, true) !== 0x02014b50) return null;
      const method = dir.getUint16(o + 10, true), n = dir.getUint16(o + 28, true);
      const extra = dir.getUint16(o + 30, true), note = dir.getUint16(o + 32, true);
      let size = dir.getUint32(o + 24, true), at = dir.getUint32(o + 42, true);
      const name = dec.decode(new Uint8Array(dir.buffer, dir.byteOffset + o + 46, n));
      // Zip64 extra field: in order, each figure that was too big for its place.
      for (let x = o + 46 + n; x + 4 <= o + 46 + n + extra;) {
        const id = dir.getUint16(x, true), len = dir.getUint16(x + 2, true);
        if (id === 1) {
          let y = x + 4;
          if (size === MAX) { size = n64(dir, y); y += 8; }
          if (dir.getUint32(o + 20, true) === MAX) y += 8;
          if (at === MAX) at = n64(dir, y);
        }
        x += 4 + len;
      }
      if (method === 0) {
        const local = await bytes(at, 30), skip = 30 + local.getUint16(26, true) + local.getUint16(28, true);
        out.push({ name, blob: file.slice(at + skip, at + skip + size) });
      }
      o += 46 + n + extra + note;
    }
    return out;
  } catch { return null; }
}
