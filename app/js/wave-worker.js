// Reads a media file's audio straight from disk in small pieces, so the file's
// size doesn't matter. Containers are parsed here (MP4/MOV/M4A, Matroska/WebM,
// WAV) and compressed audio is decoded with WebCodecs.
//
// It can list a file's audio tracks, build the timeline waveform for one of
// them, and copy that track (without re-encoding) into a small audio-only file
// the page can play, since most browsers can't switch tracks inside a video. It can
// also cut out the audio between two times as 16 kHz mono, for speech to text.
//
// in:  { cmd: 'probe', file }                    -> { type: 'tracks', tracks }
//      { cmd: 'build', file, rate, track, mux }  -> { type: 'peaks', from, data, max } ...
//                                                   { type: 'progress', done: 0..1 } ...
//                                                   { type: 'audio', blob, mime, start } or { type: 'audio', reason } (with mux)
//                                                   { type: 'done' }
//      { cmd: 'clip', file, track, from, to }    -> { type: 'clip', audio } (Float32Array, 16 kHz mono)
//      any can end with { type: 'unsupported' | 'error', message }

const WINDOW = 8 << 20; // bytes read from disk at a time
const MAX_CHANNELS = 8;

class Unsupported extends Error {}
class Enough extends Error {} // a clip has all the audio it needs

self.onmessage = async ({ data: job }) => {
  const clip = job.cmd === 'clip';
  const peaks = clip ? new Clip(job.from, job.to) : new Peaks(job.rate || 200);
  const ticker = job.cmd === 'build' ? setInterval(() => peaks.post(), 250) : 0;
  try {
    const { file } = job;
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const tag = ascii(head, 4, 8);
    let parse;
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) parse = matroska;
    else if (['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot'].includes(tag)) parse = mp4;
    else if (/^(RIFF|RF64)$/.test(ascii(head, 0, 4)) && ascii(head, 8, 12) === 'WAVE') parse = wav;
    else throw new Unsupported('this file type is not streamed');
    let out;
    try { out = await parse(file, peaks, job); } catch (err) { if (!(clip && err instanceof Enough)) throw err; }
    if (clip) { postMessage({ type: 'clip', audio: peaks.out }, [peaks.out.buffer]); return; }
    if (job.cmd === 'probe') { postMessage({ type: 'tracks', tracks: out }); return; }
    peaks.progress = 1;
    peaks.post();
    if (job.mux) postMessage({ type: 'audio', ...(out || { reason: 'nothing to play' }) });
    postMessage({ type: 'done' });
  } catch (err) {
    peaks.post();
    postMessage({ type: err instanceof Unsupported ? 'unsupported' : 'error', message: err.message || String(err) });
  } finally {
    clearInterval(ticker);
  }
};


// ---------------------------------------------------------------- peak accumulation

class Peaks {
  constructor(rate) {
    this.rate = rate;
    this.data = new Float32Array(rate * 600);
    this.lo = Infinity; // range not yet sent to the page
    this.hi = 0;
    this.max = 0;
    this.cursor = null; // end time of the last audio added
    this.shift = 0; // added to every timestamp (see editShift)
    this.progress = 0;
    this.sent = -1;
  }

  // `planes[c][k]` is sample k of channel c, starting at time t (seconds).
  add(t, planes, frames, sampleRate) {
    t += this.shift;
    // Laced frames share one timestamp and decoders may jitter slightly:
    // continue from where the last audio ended unless there is a real gap.
    if (this.cursor !== null && (t < this.cursor || t - this.cursor < 0.25)) t = this.cursor;
    const rate = this.rate;
    for (let j = 0; j < frames;) {
      const bin = Math.floor((t + j / sampleRate) * rate);
      let end = Math.ceil(((bin + 1) / rate - t) * sampleRate);
      if (end <= j) end = j + 1;
      if (end > frames) end = frames;
      let m = 0;
      for (const p of planes) {
        for (let k = j; k < end; k++) {
          const v = p[k];
          if (v > m) m = v;
          else if (-v > m) m = -v;
        }
      }
      this.put(bin, m);
      j = end;
    }
    this.cursor = t + frames / sampleRate;
  }

  put(bin, m) {
    if (bin < 0) return;
    if (bin >= this.data.length) {
      let n = this.data.length;
      while (n <= bin) n *= 2;
      const d = new Float32Array(n);
      d.set(this.data);
      this.data = d;
    }
    if (m > this.data[bin]) this.data[bin] = m;
    if (m > this.max) this.max = m;
    if (bin < this.lo) this.lo = bin;
    if (bin >= this.hi) this.hi = bin + 1;
  }

  post() {
    if (this.hi > this.lo) {
      const data = this.data.slice(this.lo, this.hi);
      postMessage({ type: 'peaks', from: this.lo, data, max: this.max }, [data.buffer]);
      this.lo = Infinity;
      this.hi = 0;
    }
    const p = Math.floor(this.progress * 100);
    if (p !== this.sent) { this.sent = p; postMessage({ type: 'progress', done: p / 100 }); }
  }
}

// ---------------------------------------------------------------- clips

// The audio between two times, mixed to mono at 16 kHz, which is what speech to text
// takes. It stands in for Peaks, so every container and codec works for it too. The
// parsers ask skip() before reading audio, so a clip far into a file reads little else.
const CLIP_RATE = 16000;
class Clip {
  constructor(from, to) {
    this.from = from;
    this.to = to;
    this.out = new Float32Array(Math.max(1, Math.ceil((to - from) * CLIP_RATE)));
    this.cursor = null;
    this.shift = 0;
    this.progress = 0;
  }

  // Whether audio starting at t (before the shift) ends too early to be needed. A second
  // is kept before the clip, so decoders have settled by the time it starts.
  skip(t) { return t + this.shift < this.from - 1; }

  // Stops reading once the audio is past the clip.
  past(t) { if (t + this.shift > this.to + 1) throw new Enough(); }

  add(t, planes, frames, sampleRate) {
    t += this.shift;
    if (this.cursor !== null && (t < this.cursor || t - this.cursor < 0.25)) t = this.cursor; // as in Peaks
    this.cursor = t + frames / sampleRate;
    const n = this.out.length;
    const i0 = Math.max(0, Math.ceil((t - this.from) * CLIP_RATE));
    const i1 = Math.min(n, Math.ceil((this.cursor - this.from) * CLIP_RATE));
    // Each output sample averages the input around it, which keeps out most aliasing.
    const half = Math.max(1, Math.round(sampleRate / CLIP_RATE / 2)), ch = planes.length;
    for (let i = i0; i < i1; i++) {
      const k = Math.round((this.from + i / CLIP_RATE - t) * sampleRate);
      const a = Math.max(0, k - half + 1), b = Math.min(frames, k + half);
      let sum = 0;
      for (const p of planes) for (let j = a; j < b; j++) sum += p[j];
      if (b > a) this.out[i] = sum / ((b - a) * ch);
    }
    if (t > this.to + 0.5) throw new Enough();
  }

  post() {}
}

// ---------------------------------------------------------------- sample conversion

let bufs = [];
function scratch(channels, frames) {
  for (let c = 0; c < channels; c++) if (!bufs[c] || bufs[c].length < frames) bufs[c] = new Float32Array(frames);
  return bufs.slice(0, channels);
}

const INT = { u8: [Uint8Array, 1 / 128, 128], s16: [Int16Array, 1 / 32768, 0], s32: [Int32Array, 1 / 2147483648, 0], f32: [Float32Array, 1, 0] };

function audioDataPlanes(d) {
  const n = d.numberOfFrames, total = d.numberOfChannels, ch = Math.min(total, MAX_CHANNELS);
  const planes = scratch(ch, n);
  try {
    for (let c = 0; c < ch; c++) d.copyTo(planes[c].subarray(0, n), { planeIndex: c, format: 'f32-planar' });
  } catch {
    // browser can't convert: read the native layout ourselves
    const planar = d.format.endsWith('-planar');
    const [T, scale, off] = INT[d.format.replace('-planar', '')] || [];
    if (!T) throw new Unsupported(`decoded audio format ${d.format}`);
    if (planar) {
      const raw = new T(n);
      for (let c = 0; c < ch; c++) {
        d.copyTo(raw, { planeIndex: c });
        for (let k = 0; k < n; k++) planes[c][k] = (raw[k] - off) * scale;
      }
    } else {
      const raw = new T(n * total);
      d.copyTo(raw, { planeIndex: 0 });
      for (let k = 0; k < n; k++) for (let c = 0; c < ch; c++) planes[c][k] = (raw[k * total + c] - off) * scale;
    }
  }
  return planes;
}

// Interleaved PCM bytes -> float planes.
function pcmPlanes(u8, channels, bits, le, isFloat) {
  const bpf = (channels * bits) / 8, bps = bits / 8;
  const frames = Math.floor(u8.length / bpf);
  const ch = Math.min(channels, MAX_CHANNELS);
  const planes = scratch(ch, frames);
  const dv = new DataView(u8.buffer, u8.byteOffset, frames * bpf);
  for (let c = 0; c < ch; c++) {
    const out = planes[c];
    for (let k = 0, p = c * bps; k < frames; k++, p += bpf) {
      let v;
      if (bits === 16) v = dv.getInt16(p, le) / 32768;
      else if (bits === 24) {
        const a = dv.getUint8(p), b = dv.getUint8(p + 1), d = dv.getUint8(p + 2);
        let x = le ? (d << 16) | (b << 8) | a : (a << 16) | (b << 8) | d;
        if (x & 0x800000) x -= 0x1000000;
        v = x / 8388608;
      } else if (bits === 32) v = isFloat ? dv.getFloat32(p, le) : dv.getInt32(p, le) / 2147483648;
      else if (bits === 64) v = dv.getFloat64(p, le);
      else v = (dv.getUint8(p) - 128) / 128;
      out[k] = v;
    }
  }
  return { planes, frames };
}

function pcmSink(peaks, { rate, channels, bits, le, float }) {
  if (![8, 16, 24, 32, 64].includes(bits) || !channels || !rate) throw new Unsupported('unusual PCM layout');
  return {
    async decode(data, t) {
      const { planes, frames } = pcmPlanes(data, channels, bits, le, float);
      peaks.add(t, planes, frames, rate);
    },
    async finish() {},
  };
}

// ---------------------------------------------------------------- WebCodecs decoding

async function decoderSink(peaks, config) {
  if (typeof AudioDecoder === 'undefined') throw new Unsupported('this browser has no WebCodecs audio decoder');
  const support = await AudioDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
  if (!support.supported) throw new Unsupported(`${config.codec} audio can't be decoded by this browser`);
  let failure = null;
  const dec = new AudioDecoder({
    output: (d) => {
      try { peaks.add(d.timestamp / 1e6, audioDataPlanes(d), d.numberOfFrames, d.sampleRate); }
      catch (err) { failure = err; }
      finally { d.close(); }
    },
    error: (err) => { failure = err; },
  });
  dec.configure(config);
  const hasDequeue = 'ondequeue' in dec;
  return {
    async decode(data, t) {
      if (failure) throw failure;
      while (dec.decodeQueueSize > 48) {
        if (!hasDequeue) { await dec.flush(); break; }
        await Promise.race([
          new Promise((r) => dec.addEventListener('dequeue', r, { once: true })),
          new Promise((r) => setTimeout(r, 500)),
        ]);
        if (failure) throw failure;
      }
      dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(t * 1e6), data }));
    },
    async finish() {
      if (failure) throw failure;
      await dec.flush();
      dec.close();
      if (failure) throw failure;
    },
  };
}

function aacCodec(asc) {
  let aot = asc[0] >> 3;
  if (aot === 31) aot = 32 + (((asc[0] & 7) << 3) | (asc[1] >> 5));
  return `mp4a.40.${aot}`;
}

// ---------------------------------------------------------------- byte helpers

const ascii = (b, a, z) => String.fromCharCode(...b.subarray(a, z));

class Reader {
  constructor(file) { this.file = file; this.base = 0; this.buf = new Uint8Array(0); }
  has(pos, n) { return pos >= this.base && pos + n <= this.base + this.buf.length; }
  // `ahead` reads extra bytes past `n` so the next small reads hit memory
  async load(pos, n, ahead = WINDOW) {
    const end = Math.min(this.file.size, pos + Math.max(n, ahead));
    this.buf = new Uint8Array(await this.file.slice(pos, end).arrayBuffer());
    this.base = pos;
  }
  async view(pos, n, ahead = WINDOW) {
    if (!this.has(pos, n)) await this.load(pos, n, ahead);
    const o = pos - this.base;
    return this.buf.subarray(o, o + n);
  }
}

// ---------------------------------------------------------------- Matroska / WebM

const MKV = {
  Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Tracks: 0x1654ae6b, TrackEntry: 0xae,
  TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63a2, Audio: 0xe1, SamplingFrequency: 0xb5,
  Channels: 0x9f, BitDepth: 0x6264, ContentEncodings: 0x6d80, Cluster: 0x1f43b675, Timecode: 0xe7,
  SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, Language: 0x22b59c, LanguageBCP47: 0x22b59d, Name: 0x536e,
  FlagDefault: 0x88, FlagVisualImpaired: 0x55ac, CodecDelay: 0x56aa,
};
// Masters we step into; every other element is skipped by its size.
const MKV_ENTER = new Set([MKV.Segment, MKV.Info, MKV.Tracks, MKV.TrackEntry, MKV.Audio, MKV.Cluster, MKV.BlockGroup]);
const MKV_READ = new Set([MKV.TimecodeScale, MKV.TrackNumber, MKV.TrackType, MKV.CodecID, MKV.CodecPrivate,
  MKV.SamplingFrequency, MKV.Channels, MKV.BitDepth, MKV.Timecode, MKV.Language, MKV.LanguageBCP47, MKV.Name,
  MKV.FlagDefault, MKV.FlagVisualImpaired, MKV.CodecDelay]);

function vint(b, o, isSize) {
  const first = b[o];
  if (!first) return null;
  const len = Math.clz32(first) - 23;
  if (isSize === 'id') {
    if (len > 4) return null;
    let v = first;
    for (let i = 1; i < len; i++) v = v * 256 + b[o + i];
    return { value: v, len };
  }
  let v = first & (0xff >> len), allOnes = v === 0xff >> len;
  for (let i = 1; i < len; i++) { v = v * 256 + b[o + i]; allOnes = allOnes && b[o + i] === 0xff; }
  return { value: isSize && allOnes ? -1 : v, len };
}
const uint = (v) => v.reduce((a, x) => a * 256 + x, 0);
const ebmlFloat = (v) => {
  const dv = new DataView(v.buffer, v.byteOffset, v.length);
  return v.length === 4 ? dv.getFloat32(0) : v.length === 8 ? dv.getFloat64(0) : 0;
};

// Split a (Simple)Block into its frames, undoing Xiph / EBML / fixed lacing.
function blockFrames(b) {
  const tn = vint(b, 0, false);
  let o = tn.len;
  const rel = ((b[o] << 8) | b[o + 1]) << 16 >> 16;
  o += 2;
  const lacing = (b[o++] >> 1) & 3;
  if (!lacing) return { track: tn.value, rel, frames: [b.subarray(o)] };
  const n = b[o++] + 1;
  const sizes = [];
  if (lacing === 1) {
    for (let i = 0; i < n - 1; i++) {
      let s = 0, x;
      do { x = b[o++]; s += x; } while (x === 255);
      sizes.push(s);
    }
  } else if (lacing === 3) {
    const f = vint(b, o, false);
    o += f.len;
    sizes.push(f.value);
    for (let i = 0; i < n - 2; i++) {
      const d = vint(b, o, false);
      o += d.len;
      sizes.push(sizes[sizes.length - 1] + d.value - (2 ** (7 * d.len - 1) - 1));
    }
  } else {
    const each = Math.floor((b.length - o) / n);
    for (let i = 0; i < n - 1; i++) sizes.push(each);
  }
  sizes.push(b.length - o - sizes.reduce((a, s) => a + s, 0));
  const frames = [];
  for (const s of sizes) { frames.push(b.subarray(o, o + s)); o += s; }
  return { track: tn.value, rel, frames };
}

function mkvInfo(t) {
  const c = t.codec || '';
  const info = { rate: Math.round(t.rate || 48000), channels: t.channels || 2, kind: 'other', other: c.replace(/^A_/, '') || 'unknown', desc: t.priv || null };
  if (c.startsWith('A_PCM/')) {
    Object.assign(info, { kind: 'pcm', pcm: { bits: t.bits || 16, le: c !== 'A_PCM/INT/BIG', float: c === 'A_PCM/FLOAT/IEEE' } });
  } else if (c.startsWith('A_AAC')) {
    info.kind = 'aac';
    if (!info.desc) {
      // old-style codec IDs carry no config: build a minimal AudioSpecificConfig
      const aot = { MAIN: 1, LC: 2, SSR: 3, LTP: 4 }[c.split('/')[2]] || 2;
      const fi = Math.max(0, AAC_RATES.indexOf(info.rate));
      info.desc = new Uint8Array([(aot << 3) | (fi >> 1), ((fi & 1) << 7) | (info.channels << 3)]);
    }
  } else {
    const kind = { A_OPUS: 'opus', A_VORBIS: 'vorbis', A_FLAC: 'flac', A_AC3: 'ac3', A_EAC3: 'eac3', 'A_MPEG/L3': 'mp3' }[c];
    if (kind) info.kind = kind;
    else if (c.startsWith('A_DTS')) info.other = 'DTS';
    else if (c === 'A_TRUEHD') info.other = 'TrueHD';
  }
  return info;
}

async function matroska(file, peaks, job) {
  const r = new Reader(file), size = file.size;
  const tracks = [];
  const audioTracks = () => tracks.filter((t) => t.type === 2);
  const list = () => audioTracks().map((t) => describe(mkvInfo(t), {
    lang: t.bcp47 || t.lang, name: t.name, default: t.default !== 0, ad: t.vi === 1 || isAD(t.name),
  }));
  let clusterEnd = -1; // where the current cluster ends, if its size is known
  let pos = 0, track = null, scale = 1e6, cluster = 0, chosen = null, sink = null, mux = null, ahead = WINDOW, shift = 0;
  while (pos < size) {
    if (!r.has(pos, 12)) await r.load(pos, 12, ahead);
    const b = r.buf, o = pos - r.base;
    if (b.length - o < 2) break;
    const id = vint(b, o, 'id');
    const sz = id && vint(b, o + id.len, true);
    if (!id || !sz) {
      if (sink) break; // trailing junk after the clusters; keep what we have
      throw new Error('damaged Matroska file');
    }
    const start = pos + id.len + sz.len, len = sz.value;
    if (MKV_ENTER.has(id.value)) {
      if (id.value === MKV.TrackEntry) tracks.push((track = {}));
      if (id.value === MKV.Cluster) clusterEnd = len >= 0 ? start + len : -1;
      if (id.value === MKV.Cluster && !sink) {
        // all track headers come before the first cluster
        if (job.cmd === 'probe') return list();
        chosen = audioTracks()[job.track || 0];
        if (!chosen) throw new Unsupported('no audio track');
        if (chosen.encoded) throw new Unsupported('compressed Matroska audio track');
        const info = mkvInfo(chosen);
        // players drop the codec delay (encoder priming) from the start, like an MP4 edit list
        // (Opus and Vorbis decoders already drop it themselves; an Opus copy keeps it in dOps)
        shift = peaks.shift = info.kind === 'opus' || info.kind === 'vorbis' ? 0 : -(chosen.delay || 0) / 1e9;
        sink = await openSink(info, peaks);
        mux = job.mux ? makeMux(file, info) : null;
      }
      pos = start;
      continue;
    }
    if (len < 0) throw new Error('damaged Matroska file');
    if ((id.value === MKV.SimpleBlock || id.value === MKV.Block) && sink) {
      const head = await r.view(start, Math.min(len, 8));
      const tn = vint(head, 0, false);
      const early = tn && peaks.skip && head.length >= tn.len + 2 && peaks.skip((cluster + (((head[tn.len] << 8) | head[tn.len + 1]) << 16 >> 16)) * scale / 1e9 + 1);
      if (tn?.value === chosen.number && !early) {
        const blk = await r.view(start, len, 0);
        if (blk.length === len) {
          const { rel, frames } = blockFrames(blk);
          const t = ((cluster + rel) * scale) / 1e9;
          for (const f of frames) {
            await sink.decode(f, t);
            mux?.add(f, t + shift, start + (f.byteOffset - blk.byteOffset));
          }
        }
      }
    } else if (MKV_READ.has(id.value) && len < 1 << 20) {
      const v = await r.view(start, len);
      switch (id.value) {
        case MKV.TimecodeScale: scale = uint(v); break;
        case MKV.Timecode:
          cluster = uint(v);
          // A block's time is within 32.8 s of its cluster's (a 16-bit offset, in ms at
          // the usual scale), so a clip can jump over clusters that end before it.
          if (peaks.skip && clusterEnd > start && peaks.skip((cluster * scale) / 1e9 + (32768 * scale) / 1e9 + 1)) {
            pos = clusterEnd;
            continue;
          }
          break;
        case MKV.TrackNumber: if (track) track.number = uint(v); break;
        case MKV.TrackType: if (track) track.type = uint(v); break;
        case MKV.CodecID: if (track) track.codec = ascii(v, 0, v.length).replace(/\0+$/, ''); break;
        case MKV.CodecPrivate: if (track) track.priv = v.slice(); break;
        case MKV.SamplingFrequency: if (track) track.rate = ebmlFloat(v); break;
        case MKV.Channels: if (track) track.channels = uint(v); break;
        case MKV.BitDepth: if (track) track.bits = uint(v); break;
        case MKV.Language: if (track) track.lang = ascii(v, 0, v.length).replace(/\0+$/, ''); break;
        case MKV.LanguageBCP47: if (track) track.bcp47 = ascii(v, 0, v.length).replace(/\0+$/, ''); break;
        case MKV.Name: if (track) track.name = utf8.decode(v).replace(/\0+$/, ''); break;
        case MKV.FlagDefault: if (track) track.default = uint(v); break;
        case MKV.FlagVisualImpaired: if (track) track.vi = uint(v); break;
        case MKV.CodecDelay: if (track) track.delay = uint(v); break;
      }
    } else if (id.value === MKV.ContentEncodings && track) {
      track.encoded = true;
    }
    // After skipping something big (high-bitrate video), read just a little
    // ahead next time so those frames are never loaded from disk.
    ahead = len > 1 << 20 ? 64 << 10 : WINDOW;
    pos = start + len;
    peaks.progress = Math.min(1, pos / size);
  }
  if (job.cmd === 'probe') return list();
  if (!sink) throw new Unsupported('no audio found');
  await sink.finish();
  return mux?.finish();
}

// ---------------------------------------------------------------- MP4 / MOV

const fourcc = (dv, p) => String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));

function* boxes(dv, start, end) {
  for (let p = start; p + 8 <= end;) {
    let size = dv.getUint32(p), hdr = 8;
    const type = fourcc(dv, p + 4);
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; }
    else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) return;
    yield { type, start: p + hdr, end: p + size };
    p += size;
  }
}
const child = (dv, box, type) => box && [...boxes(dv, box.start, box.end)].find((b) => b.type === type);
const path = (dv, box, ...types) => types.reduce((b, t) => child(dv, b, t), box);

function findDeep(dv, start, end, type) {
  for (const b of boxes(dv, start, end)) {
    if (b.type === type) return b;
    if (b.type === 'wave') { const f = findDeep(dv, b.start, b.end, type); if (f) return f; }
  }
  return null;
}

function esds(dv, box) {
  let p = box.start + 4;
  const desc = () => {
    const tag = dv.getUint8(p++);
    let len = 0;
    for (let i = 0; i < 4; i++) { const x = dv.getUint8(p++); len = (len << 7) | (x & 0x7f); if (!(x & 0x80)) break; }
    return { tag, len };
  };
  let d = desc();
  if (d.tag !== 3) return null;
  p += 2;
  const flags = dv.getUint8(p++);
  if (flags & 0x80) p += 2;
  if (flags & 0x40) p += 1 + dv.getUint8(p);
  if (flags & 0x20) p += 2;
  d = desc();
  if (d.tag !== 4) return null;
  const oti = dv.getUint8(p);
  p += 13;
  if (p >= box.end) return { oti, dsi: null };
  d = desc();
  return { oti, dsi: d.tag === 5 ? new Uint8Array(dv.buffer, dv.byteOffset + p, d.len).slice() : null };
}

function sampleEntry(dv, stsd) {
  const e = [...boxes(dv, stsd.start + 8, stsd.end)][0];
  if (!e) return null;
  const s = e.start, version = dv.getUint16(s + 8);
  let channels = dv.getUint16(s + 16), bits = dv.getUint16(s + 18), rate = dv.getUint32(s + 24) >>> 16;
  let kids = s + 28, flags = 0;
  if (version === 1) kids += 16;
  if (version === 2) {
    rate = dv.getFloat64(s + 32);
    channels = dv.getUint32(s + 40);
    bits = dv.getUint32(s + 48);
    flags = dv.getUint32(s + 52);
    kids += 36;
  }
  return { type: e.type, dv, kids, end: e.end, channels, bits, rate: Math.round(rate), flags };
}

function mp4Info(entry) {
  const { type, dv, kids, end, channels, rate, bits } = entry;
  const info = { rate, channels, kind: 'other', other: type.trim(), desc: null };
  const pcm = { sowt: [16, true, false], twos: [16, false, false], in24: [24, false, false], in32: [32, false, false],
    fl32: [32, false, true], fl64: [64, false, true], raw: [8, true, false] }[type.trim()];
  if (pcm || type === 'lpcm') {
    let [b, le, float] = pcm || [bits, !(entry.flags & 2), !!(entry.flags & 1)];
    const enda = findDeep(dv, kids, end, 'enda');
    if (enda) le = dv.getUint16(enda.start) === 1 || dv.getUint8(enda.start) === 1;
    if (type === 'sowt' || type === 'twos') b = bits === 8 ? 8 : 16;
    return Object.assign(info, { kind: 'pcm', pcm: { bits: b, le, float } });
  }
  if (type === 'mp4a') {
    const box = findDeep(dv, kids, end, 'esds');
    const es = box && esds(dv, box);
    if (es && (es.oti === 0x6b || es.oti === 0x69)) info.kind = 'mp3';
    else Object.assign(info, { kind: 'aac', desc: es?.dsi || null });
  } else if (type === '.mp3') info.kind = 'mp3';
  else if (type === 'Opus') {
    info.kind = 'opus';
    const b = findDeep(dv, kids, end, 'dOps');
    if (b) {
      // dOps (big-endian) -> OpusHead (little-endian), which WebCodecs expects
      const p = b.start, family = dv.getUint8(p + 10);
      const head = new Uint8Array(19 + (family ? 2 + dv.getUint8(p + 1) : 0));
      const o = new DataView(head.buffer);
      head.set([79, 112, 117, 115, 72, 101, 97, 100, 1, dv.getUint8(p + 1)]);
      o.setUint16(10, dv.getUint16(p + 2), true);
      o.setUint32(12, dv.getUint32(p + 4), true);
      o.setInt16(16, dv.getInt16(p + 8), true);
      head[18] = family;
      for (let i = 19; i < head.length; i++) head[i] = dv.getUint8(p + 11 + (i - 19));
      info.desc = head;
    }
  } else if (type === 'fLaC') {
    info.kind = 'flac';
    const b = findDeep(dv, kids, end, 'dfLa');
    if (b) {
      const blocks = new Uint8Array(dv.buffer, dv.byteOffset + b.start + 4, b.end - b.start - 4);
      info.desc = new Uint8Array(4 + blocks.length);
      info.desc.set([102, 76, 97, 67]);
      info.desc.set(blocks, 4);
    }
  } else if (type === 'ac-3') info.kind = 'ac3';
  else if (type === 'ec-3') info.kind = 'eac3';
  else if (/^dts/.test(type)) info.other = 'DTS';
  else if (type === 'alac') info.other = 'ALAC';
  return info;
}

// Track name and audio-description hints from an MP4 trak.
function mp4Meta(dv, trak, mdhd) {
  const meta = {};
  const tkhd = child(dv, trak, 'tkhd');
  meta.default = tkhd ? (dv.getUint32(tkhd.start) & 1) === 1 : true;
  const l = dv.getUint16(mdhd.start + (dv.getUint8(mdhd.start) === 1 ? 32 : 20));
  const lang = String.fromCharCode(((l >> 10) & 31) + 0x60, ((l >> 5) & 31) + 0x60, (l & 31) + 0x60);
  meta.lang = l && l !== 0x7fff && /^[a-z]{3}$/.test(lang) && lang !== 'und' ? lang : '';
  const text = (box, skip) => utf8.decode(new Uint8Array(dv.buffer, dv.byteOffset + box.start + skip, box.end - box.start - skip)).replace(/\0+/g, ' ').trim();
  const udtaName = path(dv, trak, 'udta', 'name');
  const hdlr = path(dv, trak, 'mdia', 'hdlr');
  let name = udtaName ? text(udtaName, 0) : '';
  if (!name && hdlr && hdlr.end - hdlr.start > 24) {
    name = text(hdlr, 24).replace(/^[\x00-\x1f]/, '');
    if (/sound ?(media )?handler|core media audio|smash|gpac|mainconcept|^isom?$/i.test(name)) name = '';
  }
  meta.name = name;
  const kind = path(dv, trak, 'udta', 'kind');
  if (kind) {
    const [scheme = '', value = ''] = text(kind, 4).split(' ');
    meta.ad = (/AudioPurposeCS/i.test(scheme) && value === '1') || value === 'description';
  }
  meta.ad = meta.ad || isAD(name);
  return meta;
}

// Seconds to add to a track's decode times so they match playback. The edit list
// skips encoder priming (about 21 ms for AAC, Opus pre-skip) and can delay a track
// with an empty edit; browsers honour both, so the waveform must too.
function editShift(moov, trak, timescale) {
  const elst = path(moov, trak, 'edts', 'elst'), mvhd = child(moov, { start: 0, end: moov.byteLength }, 'mvhd');
  if (!elst || !mvhd) return 0;
  const v1 = moov.getUint8(elst.start) === 1, n = moov.getUint32(elst.start + 4);
  const movieScale = moov.getUint32(mvhd.start + (moov.getUint8(mvhd.start) === 1 ? 20 : 12));
  let empty = 0;
  for (let i = 0, p = elst.start + 8; i < n; i++, p += v1 ? 20 : 12) {
    const dur = v1 ? Number(moov.getBigUint64(p)) : moov.getUint32(p);
    const media = v1 ? Number(moov.getBigInt64(p + 8)) : moov.getInt32(p + 4);
    if (media === -1) { empty += dur; continue; }
    return empty / movieScale - media / timescale;
  }
  return 0;
}

async function mp4(file, peaks, job) {
  let pos = 0, moov = null;
  while (pos + 8 <= file.size) {
    const h = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
    let size = h.getUint32(0), hdr = 8;
    const type = fourcc(h, 4);
    if (size === 1) { size = Number(h.getBigUint64(8)); hdr = 16; }
    else if (size === 0) size = file.size - pos;
    if (size < hdr) throw new Error('damaged MP4 file');
    if (type === 'moov') { moov = new DataView(await file.slice(pos + hdr, pos + size).arrayBuffer()); break; }
    pos += size;
  }
  if (!moov) throw new Unsupported('MP4 has no index (moov box)');
  const all = { start: 0, end: moov.byteLength };
  const sound = [...boxes(moov, 0, moov.byteLength)].filter((b) => b.type === 'trak').flatMap((trak) => {
    const mdia = child(moov, trak, 'mdia');
    const hdlr = child(moov, mdia, 'hdlr'), mdhd = child(moov, mdia, 'mdhd');
    if (!hdlr || !mdhd || fourcc(moov, hdlr.start + 8) !== 'soun') return [];
    const stbl = path(moov, mdia, 'minf', 'stbl');
    const entry = stbl && sampleEntry(moov, child(moov, stbl, 'stsd'));
    if (!entry) return [];
    return [{ trak, mdhd, stbl, info: mp4Info(entry), meta: mp4Meta(moov, trak, mdhd) }];
  });
  if (job.cmd === 'probe') return sound.map((t) => describe(t.info, t.meta));
  const chosen = sound[job.track || 0];
  if (!chosen) throw new Unsupported('no audio track');
  const { trak, mdhd, stbl, info } = chosen;
  const timescale = moov.getUint32(mdhd.start + (moov.getUint8(mdhd.start) === 1 ? 20 : 12));
  // decoders ignore negative input timestamps, so shift the peaks rather than the input
  // (Opus decoders already drop the pre-skip themselves, and the copy keeps it in dOps)
  const shift = (peaks.shift = info.kind === 'opus' ? 0 : editShift(moov, trak, timescale));
  const stsz = child(moov, stbl, 'stsz'), stsc = child(moov, stbl, 'stsc');
  const stts = child(moov, stbl, 'stts'), stco = child(moov, stbl, 'stco') || child(moov, stbl, 'co64');
  if (!stsz || !stco || !stsc || !stts) {
    throw new Unsupported(child(moov, all, 'mvex') ? 'fragmented MP4' : 'MP4 audio without a sample table');
  }
  const sink = await openSink(info, peaks);
  const mux = job.mux ? makeMux(file, info) : null;
  const pcm = info.kind === 'pcm' ? info.pcm : null;

  const constSize = moov.getUint32(stsz.start + 4), count = moov.getUint32(stsz.start + 8);
  const sizeAt = (i) => (constSize ? constSize : moov.getUint32(stsz.start + 12 + i * 4));
  const is64 = stco.type === 'co64', chunks = moov.getUint32(stco.start + 4);
  const chunkAt = (c) => (is64 ? Number(moov.getBigUint64(stco.start + 8 + c * 8)) : moov.getUint32(stco.start + 8 + c * 4));
  const runs = moov.getUint32(stsc.start + 4);
  const bytesPerFrame = pcm ? (info.channels * pcm.bits) / 8 : 0;

  // walk stts alongside the samples for decode timestamps
  let sttsI = 0, sttsLeft = moov.getUint32(stts.start + 8), delta = moov.getUint32(stts.start + 12), dts = 0;
  const sttsN = moov.getUint32(stts.start + 4);
  const advance = (n) => {
    while (n > 0 && sttsI < sttsN) {
      const k = Math.min(n, sttsLeft);
      dts += k * delta; n -= k; sttsLeft -= k;
      if (!sttsLeft && ++sttsI < sttsN) {
        sttsLeft = moov.getUint32(stts.start + 8 + sttsI * 8);
        delta = moov.getUint32(stts.start + 12 + sttsI * 8);
      }
    }
  };

  const r = new Reader(file);
  let sample = 0, run = 0;
  for (let c = 0; c < chunks && sample < count; c++) {
    while (run + 1 < runs && c + 1 >= moov.getUint32(stsc.start + 8 + (run + 1) * 12)) run++;
    const perChunk = moov.getUint32(stsc.start + 12 + run * 12);
    const n = Math.min(perChunk, count - sample);
    const off = chunkAt(c);
    // a clip skips chunks well before it without reading them (chunks are short)
    if (peaks.skip?.(dts / timescale + 2)) { advance(n); sample += n; continue; }
    if (pcm) {
      const data = await r.view(off, n * bytesPerFrame, 0);
      await sink.decode(data, dts / timescale);
      mux?.add(data, dts / timescale + shift, off);
      advance(n);
    } else {
      // audio chunks sit between video chunks: read just this chunk's bytes
      let len = 0;
      for (let k = 0; k < n; k++) len += sizeAt(sample + k);
      const data = await r.view(off, len, 0);
      for (let k = 0, o = 0; k < n; k++) {
        const s = sizeAt(sample + k);
        if (o + s <= data.length) {
          const frame = data.subarray(o, o + s);
          await sink.decode(frame, dts / timescale);
          mux?.add(frame, dts / timescale + shift, off + o);
        }
        o += s;
        advance(1);
      }
    }
    sample += n;
    peaks.progress = sample / count;
  }
  await sink.finish();
  return mux?.finish();
}

// ---------------------------------------------------------------- WAV / RF64

async function wav(file, peaks, job) {
  const r = new Reader(file);
  let pos = 12, fmt = null, dataSize64 = 0;
  while (pos + 8 <= file.size) {
    const h = await r.view(pos, 8);
    const dv = new DataView(h.buffer, h.byteOffset, 8);
    const id = ascii(h, 0, 4);
    let size = dv.getUint32(4, true);
    if (id === 'ds64') {
      const b = await r.view(pos + 8, 24);
      dataSize64 = Number(new DataView(b.buffer, b.byteOffset, 24).getBigUint64(8, true));
    } else if (id === 'fmt ') {
      const b = await r.view(pos + 8, Math.min(size, 40));
      const f = new DataView(b.buffer, b.byteOffset, b.length);
      let format = f.getUint16(0, true);
      if (format === 0xfffe && b.length >= 26) format = f.getUint16(24, true);
      fmt = { format, channels: f.getUint16(2, true), rate: f.getUint32(4, true), align: f.getUint16(12, true), bits: f.getUint16(14, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('damaged WAV file');
      const info = { kind: fmt.format === 1 || fmt.format === 3 ? 'pcm' : 'other', other: 'compressed WAV', rate: fmt.rate,
        channels: fmt.channels, pcm: { bits: fmt.bits, le: true, float: fmt.format === 3 } };
      if (job.cmd === 'probe') return [describe(info, { default: true })];
      if (info.kind !== 'pcm') throw new Unsupported('compressed WAV');
      if (size === 0xffffffff && dataSize64) size = dataSize64;
      const start = pos + 8, end = Math.min(file.size, start + size);
      const sink = await openSink(info, peaks);
      const mux = job.mux ? makeMux(file, info) : null;
      const step = Math.floor(WINDOW / fmt.align) * fmt.align;
      for (let p = start; p < end; p += step) {
        if (peaks.skip?.((p + step - start) / fmt.align / fmt.rate)) continue;
        const data = await r.view(p, Math.min(step, end - p));
        const t = (p - start) / fmt.align / fmt.rate;
        await sink.decode(data, t);
        mux?.add(data, t, p);
        peaks.progress = (p - start) / (end - start);
      }
      return mux?.finish();
    }
    pos += 8 + size + (size & 1);
  }
  throw new Unsupported('WAV without audio data');
}

// ---------------------------------------------------------------- tracks

// Every container is reduced to this shape:
// { kind: aac|opus|vorbis|flac|mp3|ac3|eac3|pcm|other, other, desc, rate, channels, pcm: { bits, le, float } }
const KIND_LABEL = { aac: 'AAC', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC', mp3: 'MP3', ac3: 'AC-3', eac3: 'E-AC-3', pcm: 'PCM' };
const label = (info) => KIND_LABEL[info.kind] || info.other || 'unknown';
const isAD = (name) => /descri|narrat|visual|\bAD\b/i.test(name || '');
const utf8 = new TextDecoder();
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function describe(info, meta) {
  return {
    codec: label(info), channels: info.channels, rate: info.rate,
    lang: meta.lang || '', name: meta.name || '', default: !!meta.default, ad: !!meta.ad,
  };
}

async function openSink(info, peaks) {
  const sink = await codecSink(info, peaks);
  if (!(peaks instanceof Clip)) return sink;
  return {
    async decode(data, t) { peaks.past(t); if (!peaks.skip(t)) await sink.decode(data, t); },
    finish: () => sink.finish(),
  };
}

async function codecSink(info, peaks) {
  if (info.kind === 'pcm') return pcmSink(peaks, { rate: info.rate, channels: info.channels, ...info.pcm });
  const codec = { aac: info.desc && aacCodec(info.desc), opus: 'opus', vorbis: 'vorbis', flac: 'flac', mp3: 'mp3', ac3: 'ac-3', eac3: 'ec-3' }[info.kind];
  if (!codec) throw new Unsupported(`${label(info)} audio`);
  const config = { codec, sampleRate: info.rate, numberOfChannels: info.channels };
  if (info.desc) config.description = info.desc;
  return decoderSink(peaks, config);
}

// ---------------------------------------------------------------- copying a track out

// Compressed frames are copied into an M4A (AAC, Opus, FLAC) or a raw MP3
// stream; PCM becomes a WAV whose data is mostly slices of the original file,
// so even a long uncompressed track costs almost no memory.
function makeMux(file, info) {
  if (info.kind === 'aac' && info.desc) {
    const rate = ascRate(info.desc) || info.rate;
    return new Mp4Mux(audioEntry('mp4a', info.channels, rate, esdsBox(info.desc)), rate, () => 1024, aacCodec(info.desc));
  }
  if (info.kind === 'opus') return new Mp4Mux(audioEntry('Opus', info.channels, 48000, dOpsBox(info)), 48000, opusDuration, 'opus');
  if (info.kind === 'flac' && info.desc) {
    const si = info.desc.subarray(8); // STREAMINFO, after "fLaC" and its block header
    const rate = (si[10] << 12) | (si[11] << 4) | (si[12] >> 4);
    const minBlock = (si[0] << 8) | si[1], maxBlock = (si[2] << 8) | si[3];
    const dur = minBlock === maxBlock ? () => minBlock : (f) => flacBlockSize(f) || maxBlock;
    return new Mp4Mux(audioEntry('fLaC', info.channels, rate, fullBox('dfLa', 0, 0, info.desc.subarray(4))), rate, dur, 'flac');
  }
  if (info.kind === 'mp3') return new RawMux('audio/mpeg');
  if (info.kind === 'pcm') return new WavMux(file, info);
  return { add() {}, finish: () => ({ reason: `${label(info)} audio can't be played as a separate track` }) };
}

const enc = new TextEncoder();
function cat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function be(n, bytes) {
  const out = new Uint8Array(bytes);
  for (let i = bytes - 1; i >= 0; i--) { out[i] = n % 256; n = Math.floor(n / 256); }
  return out;
}
const zeros = (n) => new Uint8Array(n);
const box = (type, ...parts) => { const body = cat(...parts); return cat(be(body.length + 8, 4), enc.encode(type), body); };
const fullBox = (type, version, flags, ...parts) => box(type, be(version, 1), be(flags, 3), ...parts);
const MATRIX = cat(be(0x10000, 4), zeros(12), be(0x10000, 4), zeros(12), be(0x40000000, 4));

function audioEntry(type, channels, rate, ...kids) {
  return box(type, zeros(6), be(1, 2), zeros(8), be(channels, 2), be(16, 2), zeros(4), be(rate < 65536 ? rate * 65536 : 0, 4), ...kids);
}
function esdsBox(asc) {
  const descr = (tag, ...parts) => {
    const body = cat(...parts), n = body.length;
    return cat(new Uint8Array([tag, 0x80 | ((n >> 21) & 0x7f), 0x80 | ((n >> 14) & 0x7f), 0x80 | ((n >> 7) & 0x7f), n & 0x7f]), body);
  };
  return fullBox('esds', 0, 0, descr(3, be(1, 2), be(0, 1),
    descr(4, be(0x40, 1), be(0x15, 1), zeros(3), zeros(4), zeros(4), descr(5, asc)), descr(6, be(2, 1))));
}
function dOpsBox(info) {
  // OpusHead (little-endian) -> dOps (big-endian)
  const h = info.desc;
  if (!h || h.length < 19) return box('dOps', be(0, 1), be(info.channels, 1), be(312, 2), be(48000, 4), zeros(2), be(0, 1));
  const dv = new DataView(h.buffer, h.byteOffset, h.length);
  return box('dOps', be(0, 1), be(h[9], 1), be(dv.getUint16(10, true), 2), be(dv.getUint32(12, true), 4),
    be(dv.getUint16(16, true), 2), be(h[18], 1), h.subarray(19));
}
function ascRate(asc) {
  const i = ((asc[0] & 7) << 1) | (asc[1] >> 7);
  if (i === 15) return ((asc[1] & 0x7f) << 17) | (asc[2] << 9) | (asc[3] << 1) | (asc[4] >> 7);
  return AAC_RATES[i];
}
// samples per Opus packet at 48 kHz, from its TOC byte
function opusDuration(p) {
  const cfg = p[0] >> 3, c = p[0] & 3;
  const ms = cfg < 12 ? [10, 20, 40, 60][cfg & 3] : cfg < 16 ? [10, 20][cfg & 1] : [2.5, 5, 10, 20][cfg & 3];
  return Math.round(ms * 48 * (c === 0 ? 1 : c === 3 ? p[1] & 0x3f : 2));
}
function flacBlockSize(f) {
  const code = f[2] >> 4;
  if (code === 1) return 192;
  if (code >= 2 && code <= 5) return 576 << (code - 2);
  if (code >= 8) return 256 << (code - 8);
  if (code === 6 || code === 7) {
    const x = f[4];
    const n = x < 0x80 ? 1 : x < 0xe0 ? 2 : x < 0xf0 ? 3 : x < 0xf8 ? 4 : x < 0xfc ? 5 : x < 0xfe ? 6 : 7;
    return code === 6 ? f[4 + n] + 1 : ((f[4 + n] << 8) | f[5 + n]) + 1;
  }
  return 0;
}

class Grow {
  constructor() { this.a = new Uint32Array(1 << 16); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const b = new Uint32Array(this.n * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
}

// Copies bytes into 4 MB Blobs as they arrive, so the worker never holds much.
class Chunks {
  constructor() { this.blobs = []; this.cur = new Uint8Array(4 << 20); this.used = 0; this.total = 0; }
  push(d) {
    if (this.used + d.length > this.cur.length) this.flush();
    if (d.length > this.cur.length) this.blobs.push(new Blob([d]));
    else { this.cur.set(d, this.used); this.used += d.length; }
    this.total += d.length;
  }
  flush() {
    if (!this.used) return;
    this.blobs.push(new Blob([this.cur.subarray(0, this.used)]));
    this.cur = new Uint8Array(4 << 20);
    this.used = 0;
  }
  parts() { this.flush(); return this.blobs; }
}

class RawMux {
  constructor(mime) { this.mime = mime; this.data = new Chunks(); this.start = null; }
  add(d, t) { if (this.start === null) this.start = t; this.data.push(d); }
  finish() {
    if (!this.data.total) return { reason: 'the track is empty' };
    return { blob: new Blob(this.data.parts(), { type: this.mime }), mime: this.mime, start: this.start };
  }
}

// A plain (non-fragmented) M4A: one sample per chunk keeps the tables simple.
class Mp4Mux {
  constructor(entry, timescale, frameDuration, codec) {
    Object.assign(this, { entry, timescale, frameDuration, codec });
    this.sizes = new Grow();
    this.durs = new Grow();
    this.data = new Chunks();
    this.start = null;
  }
  add(d, t) {
    if (this.start === null) this.start = t;
    this.sizes.push(d.length);
    this.durs.push(this.frameDuration(d));
    this.data.push(d);
  }
  finish() {
    const n = this.sizes.n, sizes = this.sizes.a, durs = this.durs.a;
    if (!n) return { reason: 'the track is empty' };
    const big = this.data.total > 0xfff00000;
    let dur = 0;
    const runs = [];
    for (let i = 0; i < n; i++) {
      dur += durs[i];
      if (runs.length && runs[runs.length - 1][1] === durs[i]) runs[runs.length - 1][0]++;
      else runs.push([1, durs[i]]);
    }
    const table = (count, width, fill) => {
      const b = new Uint8Array(8 + count * width), dv = new DataView(b.buffer);
      dv.setUint32(4, count);
      fill(dv);
      return b;
    };
    const stts = table(runs.length, 8, (dv) => runs.forEach(([c, d], i) => { dv.setUint32(8 + i * 8, c); dv.setUint32(12 + i * 8, d); }));
    const sizeTable = new Uint8Array(12 + n * 4);
    { const dv = new DataView(sizeTable.buffer); dv.setUint32(8, n); for (let i = 0; i < n; i++) dv.setUint32(12 + i * 4, sizes[i]); }
    const offsets = new Uint8Array(8 + n * (big ? 8 : 4));
    new DataView(offsets.buffer).setUint32(4, n);
    const ms = Math.round((dur / this.timescale) * 1000);
    const build = () => box('moov',
      fullBox('mvhd', 0, 0, zeros(8), be(1000, 4), be(ms, 4), be(0x10000, 4), be(0x100, 2), zeros(10), MATRIX, zeros(24), be(2, 4)),
      box('trak',
        fullBox('tkhd', 0, 3, zeros(8), be(1, 4), zeros(4), be(ms, 4), zeros(8), zeros(4), be(0x100, 2), zeros(2), MATRIX, zeros(8)),
        box('mdia',
          fullBox('mdhd', 0, 0, zeros(8), be(this.timescale, 4), be(Math.min(dur, 0xffffffff), 4), be(0x55c4, 2), zeros(2)),
          fullBox('hdlr', 0, 0, zeros(4), enc.encode('soun'), zeros(12), enc.encode('SoundHandler'), zeros(1)),
          box('minf',
            fullBox('smhd', 0, 0, zeros(4)),
            box('dinf', fullBox('dref', 0, 0, be(1, 4), fullBox('url ', 0, 1))),
            box('stbl',
              fullBox('stsd', 0, 0, be(1, 4), this.entry),
              box('stts', stts),
              box('stsc', table(1, 12, (dv) => { dv.setUint32(8, 1); dv.setUint32(12, 1); dv.setUint32(16, 1); })),
              box('stsz', sizeTable),
              box(big ? 'co64' : 'stco', offsets))))));
    const ftyp = box('ftyp', enc.encode('M4A '), zeros(4), enc.encode('M4A isommp42'));
    const mdatHead = big ? cat(be(1, 4), enc.encode('mdat'), be(this.data.total + 16, 8)) : cat(be(this.data.total + 8, 4), enc.encode('mdat'));
    // offsets depend on the moov's size, which doesn't depend on their values
    let at = ftyp.length + build().length + mdatHead.length;
    const odv = new DataView(offsets.buffer);
    for (let i = 0; i < n; i++) {
      if (big) odv.setBigUint64(8 + i * 8, BigInt(at)); else odv.setUint32(8 + i * 4, at);
      at += sizes[i];
    }
    const mime = `audio/mp4; codecs="${this.codec}"`;
    return { blob: new Blob([ftyp, build(), mdatHead, ...this.data.parts()], { type: 'audio/mp4' }), mime, start: this.start };
  }
}

class WavMux {
  constructor(file, info) {
    this.file = file;
    this.info = info;
    this.parts = [];
    this.range = null;
    this.total = 0;
    this.start = null;
  }
  add(d, t, offset) {
    if (this.start === null) this.start = t;
    const { bits, le } = this.info.pcm;
    if (le || bits === 8) {
      // reference the original file instead of copying
      if (this.range && this.range[1] === offset) this.range[1] += d.length;
      else { this.flushRange(); this.range = [offset, offset + d.length]; }
    } else {
      this.flushRange();
      const w = bits / 8, out = new Uint8Array(d.length - (d.length % w));
      for (let i = 0; i < out.length; i += w) for (let k = 0; k < w; k++) out[i + k] = d[i + w - 1 - k];
      this.parts.push(new Blob([out]));
    }
    this.total += d.length;
  }
  flushRange() {
    if (this.range) this.parts.push(this.file.slice(this.range[0], this.range[1]));
    this.range = null;
  }
  finish() {
    this.flushRange();
    if (!this.total) return { reason: 'the track is empty' };
    const { rate, channels, pcm } = this.info, align = (channels * pcm.bits) / 8;
    const h = new DataView(new ArrayBuffer(44));
    const str = (o, s) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); h.setUint32(4, Math.min(this.total + 36, 0xffffffff), true); str(8, 'WAVE');
    str(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, pcm.float ? 3 : 1, true); h.setUint16(22, channels, true);
    h.setUint32(24, rate, true); h.setUint32(28, rate * align, true); h.setUint16(32, align, true); h.setUint16(34, pcm.bits, true);
    str(36, 'data'); h.setUint32(40, Math.min(this.total, 0xffffffff), true);
    return { blob: new Blob([h.buffer, ...this.parts], { type: 'audio/wav' }), mime: 'audio/wav', start: this.start };
  }
}
