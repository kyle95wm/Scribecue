// Zip files, stored without compression: the narration package, whose WAVs don't shrink.
// The WAVs stay Blobs throughout, read a chunk at a time for their checksums, so a long
// programme's narration never has to fit in memory.

const CHUNK = 1 << 20;
const MAX = 0xffffffff; // no Zip64: each file and the whole zip stay under 4 GB

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

// files: [{ name, blob }]. progress(done, total) is called as the checksums are worked out,
// in bytes. Returns a Blob. Throws if a file or the zip would be over 4 GB.
export async function storeZip(files, { date = new Date(), progress = () => {} } = {}) {
  const enc = new TextEncoder(), { time, date: day } = dos(date);
  const total = files.reduce((n, f) => n + f.blob.size, 0);
  const parts = [], central = [];
  let offset = 0, done = 0;
  for (const f of files) {
    if (f.blob.size > MAX) throw new Error(`${f.name} is over 4 GB, too big for a zip`);
    let crc = 0;
    for (let at = 0; at < f.blob.size; at += CHUNK) {
      crc = crc32(new Uint8Array(await f.blob.slice(at, at + CHUNK).arrayBuffer()), crc);
      done += Math.min(CHUNK, f.blob.size - at);
      progress(done, total);
    }
    const name = enc.encode(f.name), head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); // UTF-8 names
    head.setUint16(10, time, true); head.setUint16(12, day, true); head.setUint32(14, crc, true);
    head.setUint32(18, f.blob.size, true); head.setUint32(22, f.blob.size, true); head.setUint16(26, name.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true);
    dir.setUint16(12, time, true); dir.setUint16(14, day, true); dir.setUint32(16, crc, true);
    dir.setUint32(20, f.blob.size, true); dir.setUint32(24, f.blob.size, true); dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    parts.push(head.buffer, name, f.blob);
    central.push(dir.buffer, name);
    offset += 30 + name.length + f.blob.size;
    if (offset > MAX) throw new Error('the package is over 4 GB, too big for a zip');
  }
  const size = central.reduce((n, p) => n + p.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// The files stored in a zip, as [{ name, blob }], each a slice of the file, so nothing is
// read but the directory. Compressed files are left out. Returns null if it isn't a zip.
export async function readZip(file) {
  const bytes = async (o, n) => new DataView(await file.slice(o, o + n).arrayBuffer());
  try {
    const tail = Math.min(file.size, 22 + 0xffff), from = file.size - tail, t = await bytes(from, tail);
    let e = -1;
    for (let o = tail - 22; o >= 0; o--) if (t.getUint32(o, true) === 0x06054b50) { e = o; break; }
    if (e < 0) return null;
    const count = t.getUint16(e + 10, true), dir = await bytes(t.getUint32(e + 16, true), t.getUint32(e + 12, true));
    const out = [], dec = new TextDecoder();
    for (let o = 0, k = 0; k < count && o + 46 <= dir.byteLength; k++) {
      if (dir.getUint32(o, true) !== 0x02014b50) return null;
      const method = dir.getUint16(o + 10, true), size = dir.getUint32(o + 20, true), n = dir.getUint16(o + 28, true);
      const extra = dir.getUint16(o + 30, true), note = dir.getUint16(o + 32, true), at = dir.getUint32(o + 42, true);
      const name = dec.decode(new Uint8Array(dir.buffer, dir.byteOffset + o + 46, n));
      if (method === 0) {
        const local = await bytes(at, 30), skip = 30 + local.getUint16(26, true) + local.getUint16(28, true);
        out.push({ name, blob: file.slice(at + skip, at + skip + size) });
      }
      o += 46 + n + extra + note;
    }
    return out;
  } catch { return null; }
}
