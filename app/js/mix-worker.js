// Makes the full mix: the programme's sound with the readings, the programme lowered
// under each one as it is during playback, as one stereo WAV or MP3, and the two parts
// of it as stems if asked. The programme is streamed from disk by wave-worker.js's
// parsers and mixed as it's decoded, so a long film never has to fit in memory at once.
// To meet a loudness target, the mix is made twice: once to measure it, and again at
// the level that meets the target.
//
// in:  { cmd: 'mix', file, track, ...mix }        the programme, from the file
//      { cmd: 'mixPlanes', planes, rate, ...mix }  the programme, decoded by the page
//      mix: { readings, fade, video, reading, kbps, wavMix, target, ceiling, stems }
//        readings: [{ start, samples, rate, dip }], each reading as mono 16-bit samples,
//        when it starts (seconds) and how far the programme goes down under it (dB),
//        sorted by start; fade: seconds to go down that far, or back up; video, reading: levels from the
//        mix slider; kbps: MP3s at this bitrate, or 0 for WAVs; wavMix: the mix as a WAV
//        whatever kbps is, for ffmpeg to make into something else; target: the loudness to
//        meet in LUFS, or null to leave it; ceiling: the highest peak, in dBFS; stems:
//        also the lowered programme and the readings, each on its own.
// out: { type: 'progress', done: 0..1 } ... then
//      { type: 'mix', files: [{ part: 'mix' | 'programme' | 'readings', blob }], loudness, was }
//      (loudness: the mix's, in LUFS; was: before meeting the target)
//      or { type: 'unsupported' | 'error', message }

importScripts('wave-worker.js', '../vendor/lame.min.js');

// The limiter keeps peaks at the ceiling, looking LOOKAHEAD seconds ahead so it turns
// down smoothly before a peak rather than at it, then lets go over RELEASE.
const LOOKAHEAD = 0.005, RELEASE = 0.1;
// MP3 encoders add this many samples before the audio (see mp3.js).
const MP3_DELAY = 1105;

class Limiter {
  constructor(rate, ceiling, out) {
    this.ceiling = ceiling;
    this.look = Math.max(1, Math.round(rate * LOOKAHEAD));
    const size = this.look + 1;
    this.size = size;
    this.l = new Float32Array(size);
    this.r = new Float32Array(size);
    this.need = new Float32Array(size); // the gain each frame needs to stay under the ceiling
    this.q = new Float64Array(size + 1); // frames in the window whose need is lowest so far
    this.qh = 0;
    this.qn = 0;
    this.n = 0;
    this.g = 1;
    this.rel = 1 - Math.exp(-1 / (RELEASE * rate));
    this.out = out;
  }

  push(l, r) {
    const i = this.n++, k = i % this.size, peak = Math.max(Math.abs(l), Math.abs(r));
    const need = peak > this.ceiling ? this.ceiling / peak : 1;
    this.l[k] = l; this.r[k] = r; this.need[k] = need;
    const cap = this.q.length;
    while (this.qn && this.need[this.q[(this.qh + this.qn - 1) % cap] % this.size] > need) this.qn--;
    this.q[(this.qh + this.qn++) % cap] = i;
    if (i >= this.look) this.emit(i - this.look);
  }

  emit(j) {
    const cap = this.q.length;
    while (this.q[this.qh] < j) { this.qh = (this.qh + 1) % cap; this.qn--; }
    const at = this.q[this.qh], m = this.need[at % this.size];
    // Down in a straight line, reaching the gain a peak needs just as it arrives.
    if (m < this.g) this.g -= (this.g - m) / (at - j + 1);
    else this.g = Math.min(m, this.g + (1 - this.g) * this.rel);
    const k = j % this.size;
    // A smaller peak just before a bigger one can need more than the line gives it.
    this.g = Math.min(this.g, this.need[k]);
    this.out(this.l[k] * this.g, this.r[k] * this.g);
  }

  flush() { for (let j = Math.max(0, this.n - this.look); j < this.n; j++) this.emit(j); }
}

// Loudness as ITU-R BS.1770 measures it, in LUFS: each channel through the K-weighting
// filters (a high shelf, then a high-pass), the power over 400 ms blocks overlapping by
// 75%, and the blocks averaged, leaving out silence (below −70 LUFS) and then anything
// 10 LU quieter than the rest.
class Meter {
  constructor(rate) {
    let K = Math.tan(Math.PI * 1681.974450955533 / rate);
    const Q1 = 0.7071752369554196, Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416;
    let a0 = 1 + K / Q1 + K * K;
    this.s = [(Vh + Vb * K / Q1 + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q1 + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q1 + K * K) / a0];
    K = Math.tan(Math.PI * 38.13547087602444 / rate);
    const Q2 = 0.5003270373238773;
    a0 = 1 + K / Q2 + K * K;
    this.h = [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q2 + K * K) / a0];
    this.z = [new Float64Array(4), new Float64Array(4)]; // each channel's filter state
    this.sub = Math.round(rate * 0.1);
    this.acc = 0;
    this.count = 0;
    this.subs = []; // power of each 100 ms
  }

  weigh(x, z) {
    const s = this.s, h = this.h;
    const y = s[0] * x + z[0];
    z[0] = s[1] * x - s[3] * y + z[1];
    z[1] = s[2] * x - s[4] * y;
    const w = y + z[2];
    z[2] = -2 * y - h[3] * w + z[3];
    z[3] = y - h[4] * w;
    return w;
  }

  push(l, r) {
    const a = this.weigh(l, this.z[0]), b = this.weigh(r, this.z[1]);
    this.acc += a * a + b * b;
    if (++this.count === this.sub) { this.subs.push(this.acc / this.sub); this.acc = 0; this.count = 0; }
  }

  integrated() {
    const blocks = [];
    for (let i = 3; i < this.subs.length; i++) blocks.push((this.subs[i - 3] + this.subs[i - 2] + this.subs[i - 1] + this.subs[i]) / 4);
    const lufs = (p) => -0.691 + 10 * Math.log10(p);
    const mean = (bs) => bs.reduce((a, b) => a + b, 0) / bs.length;
    const loud = blocks.filter((p) => lufs(p) > -70);
    if (!loud.length) return -Infinity;
    const gate = lufs(mean(loud)) - 10;
    const kept = loud.filter((p) => lufs(p) > gate);
    return lufs(mean(kept));
  }
}

const toInt16 = (v) => (v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767));

// 16-bit WAV, stereo or mono. Pieces are gathered into a Blob as they fill, which the
// browser can keep on disk.
class WavOut {
  constructor(rate, channels) {
    this.rate = rate;
    this.channels = channels;
    this.buf = new Int16Array(1 << 17);
    this.at = 0;
    this.parts = [];
    this.blob = new Blob([]);
    this.bytes = 0;
  }
  push(l, r) {
    this.buf[this.at++] = toInt16(l);
    if (this.channels === 2) this.buf[this.at++] = toInt16(r);
    if (this.at === this.buf.length) this.spill();
  }
  spill() {
    if (this.at) { this.parts.push(this.buf.slice(0, this.at)); this.bytes += this.at * 2; this.at = 0; }
    if (this.parts.length >= 64) { this.blob = new Blob([this.blob, ...this.parts]); this.parts = []; }
  }
  finish() {
    this.spill();
    const h = new DataView(new ArrayBuffer(44)), n = this.bytes, rate = this.rate, ch = this.channels;
    const str = (o, t) => [...t].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); h.setUint32(4, 36 + n, true); str(8, 'WAVE');
    str(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, ch, true);
    h.setUint32(24, rate, true); h.setUint32(28, rate * 2 * ch, true); h.setUint16(32, 2 * ch, true); h.setUint16(34, 16, true);
    str(36, 'data'); h.setUint32(40, n, true);
    return new Blob([h.buffer, this.blob, ...this.parts], { type: 'audio/wav' });
  }
}

class Mp3Out {
  constructor(rate, channels, kbps) {
    if (![32000, 44100, 48000].includes(rate)) throw new Unsupported(`an MP3 can't be made at ${rate / 1000} kHz; choose WAV`);
    this.channels = channels;
    this.enc = new lamejs.Mp3Encoder(channels, rate, kbps);
    this.l = new Int16Array(1152 * 32);
    this.r = new Int16Array(1152 * 32);
    this.at = 0;
    this.skip = MP3_DELAY;
    this.parts = [];
  }
  push(l, r) {
    if (this.skip) { this.skip--; return; }
    this.l[this.at] = toInt16(l);
    this.r[this.at++] = toInt16(r);
    if (this.at === this.l.length) this.spill();
  }
  spill() {
    const out = this.channels === 2
      ? this.enc.encodeBuffer(this.l.subarray(0, this.at), this.r.subarray(0, this.at))
      : this.enc.encodeBuffer(this.l.subarray(0, this.at));
    if (out.length) this.parts.push(out);
    this.at = 0;
  }
  finish() {
    this.spill();
    const end = this.enc.flush();
    if (end.length) this.parts.push(end);
    return new Blob(this.parts, { type: 'audio/mpeg' });
  }
}

// One file the mix makes: the mix itself, or a stem. Each has its own limiter, so none
// goes over the ceiling.
class Part {
  constructor(part, rate, channels, job) {
    this.part = part;
    const kbps = part === 'mix' && job.wavMix ? 0 : job.kbps;
    this.out = kbps ? new Mp3Out(rate, channels, kbps) : new WavOut(rate, channels);
    this.meter = part === 'mix' ? new Meter(rate) : null;
    this.limiter = new Limiter(rate, 10 ** (job.ceiling / 20), (l, r) => { this.meter?.push(l, r); this.out.push(l, r); });
  }
  push(l, r) { this.limiter.push(l, r); }
  finish() { this.limiter.flush(); return this.out.finish(); }
}

// Takes the programme as the parsers hand it over, as Peaks does, and writes the mix.
// With measure, it only measures the mix's loudness, before any gain or limiting.
class Mixer {
  constructor(job, { gain = 1, measure = false } = {}) {
    this.job = job;
    this.gainAll = gain;
    this.measure = measure;
    this.reading = job.reading * gain;
    this.rate = 0;
    this.n = 0; // frames written
    this.cursor = null;
    this.shift = 0;
    this.progress = 0;
    this.db = 0; // how far down the programme is now, in dB
    this.lastDb = 0;
    this.to = 0; // where it's going, and where it was when that changed
    this.from = 0;
    this.gain = job.video * gain;
    this.span = 0;
  }

  start(rate) {
    this.rate = rate;
    const job = this.job;
    if (this.measure) this.meter = new Meter(rate);
    else {
      this.parts = [new Part('mix', rate, 2, job)];
      if (job.stems) this.parts.push(new Part('programme', rate, 2, job), new Part('readings', rate, 1, job));
    }
    this.speed = job.fade > 0 ? 1 / (job.fade * rate) : Infinity;
    // Each reading's first and last frame here, and its samples per frame.
    this.said = job.readings.map((r) => {
      const at = Math.round(r.start * rate);
      return { at, end: at + Math.ceil((r.samples.length * rate) / r.rate), s: r.samples, ratio: r.rate / rate, dip: r.dip };
    });
    this.edges = this.said.map((r) => [r.at, r.end, r.dip]);
    this.first = 0; // the first reading that hasn't ended
  }

  add(t, planes, frames, rate) {
    t += this.shift;
    if (this.cursor !== null && (t < this.cursor || t - this.cursor < 0.25)) t = this.cursor; // as in Peaks
    this.cursor = t + frames / rate;
    if (!this.rate) this.start(rate);
    const at = Math.round(t * this.rate);
    if (at > this.n) this.frames(null, 0, at - this.n); // a gap in the programme: silence
    const from = this.n ? 0 : Math.max(0, -at); // before the start, after an edit list's shift
    this.frames(planes, from, frames);
  }

  // Writes frames from..to of planes (or silence) mixed with the readings.
  frames(planes, from, to) {
    const ch = planes?.length || 0, c = Math.SQRT1_2;
    const [p0, p1, p2] = planes || [];
    const [mix, prog, said] = this.parts || [];
    for (let k = from; k < to; k++) {
      let l = 0, r = 0;
      if (ch === 1) l = r = p0[k];
      else if (ch) {
        l = p0[k]; r = p1[k];
        // More than stereo, in WAV order (L R C LFE and surrounds): centre to both
        // sides, surrounds to their side, and no LFE.
        if (ch > 2) { l += c * p2[k]; r += c * p2[k]; }
        for (let j = 4; j < ch; j++) { if (j % 2) r += c * planes[j][k]; else l += c * planes[j][k]; }
      }
      const i = this.n++;
      // Down while a reading plays and back up after, at the same pace as playback
      // (stepDip in tts.js): going all the way down, or back up, takes the fade.
      const ed = this.edges;
      while (this.span < ed.length && ed[this.span][1] <= i) this.span++;
      const target = this.span < ed.length && ed[this.span][0] <= i ? ed[this.span][2] : 0;
      if (target !== this.to) { this.to = target; this.from = this.db; }
      if (this.db !== target) {
        const step = Math.max(this.from, target) * this.speed;
        this.db = target > this.db ? Math.min(target, this.db + step) : Math.max(target, this.db - step);
      }
      if (this.db !== this.lastDb) { this.lastDb = this.db; this.gain = this.job.video * this.gainAll * 10 ** (-this.db / 20); }
      const d = this.reads(i), pl = l * this.gain, pr = r * this.gain;
      if (this.meter) this.meter.push(pl + d, pr + d);
      else {
        mix.push(pl + d, pr + d);
        if (prog) { prog.push(pl, pr); said.push(d, d); }
      }
    }
  }

  // The readings at frame i, added together where they overlap, each between its samples
  // by a smooth curve (Catmull-Rom).
  reads(i) {
    const rs = this.said;
    while (this.first < rs.length && rs[this.first].end <= i) this.first++;
    let v = 0;
    for (let k = this.first; k < rs.length && rs[k].at <= i; k++) {
      const { at, end, s, ratio } = rs[k];
      if (i >= end) continue;
      const x = (i - at) * ratio, j = Math.floor(x);
      if (j < 1 || j + 2 >= s.length) { if (j < s.length) v += s[j]; continue; }
      const y0 = s[j - 1], y1 = s[j], y2 = s[j + 1], y3 = s[j + 2], f = x - j;
      v += (((-y0 + 3 * y1 - 3 * y2 + y3) / 2 * f + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * f + (y2 - y0) / 2) * f + y1;
    }
    return (v / 32768) * this.reading;
  }

  // Readings that go on past the end of the programme are kept whole.
  end() {
    if (!this.rate) throw new Error('the programme has no audio');
    const end = Math.max(0, ...this.said.map((r) => r.end));
    if (end > this.n) this.frames(null, 0, end - this.n);
  }
}

// Runs the programme through a mixer. Progress covers from..to of the whole job.
async function pass(job, mixer, from, to) {
  if (job.cmd === 'mixPlanes') mixer.add(0, job.planes, job.planes[0].length, job.rate);
  else {
    const ticker = setInterval(() => postMessage({ type: 'progress', done: from + (to - from) * mixer.progress }), 250);
    try { await parseMedia(job.file, mixer, job); } finally { clearInterval(ticker); closeDecoders(); }
  }
  mixer.end();
}

self.onmessage = async ({ data: job }) => {
  try {
    let gain = 1, was = null;
    if (job.target != null) {
      const measuring = new Mixer(job, { measure: true });
      await pass(job, measuring, 0, 0.5);
      was = measuring.meter.integrated();
      // Silence can't be brought up to a target.
      if (Number.isFinite(was)) gain = 10 ** ((job.target - was) / 20);
    }
    const mixer = new Mixer(job, { gain });
    await pass(job, mixer, job.target != null ? 0.5 : 0, 1);
    const files = mixer.parts.map((p) => ({ part: p.part, blob: p.finish() }));
    postMessage({ type: 'mix', files, loudness: mixer.parts[0].meter.integrated(), was });
  } catch (err) {
    postMessage({ type: err instanceof Unsupported ? 'unsupported' : 'error', message: err.message || String(err) });
  }
};
