// Makes the full mix: the programme's sound with the readings, the programme lowered
// under each one as it is during playback, as one stereo WAV or MP3. The programme is
// streamed from disk by wave-worker.js's parsers and mixed as it's decoded, so a long
// film never has to fit in memory at once.
//
// in:  { cmd: 'mix', file, track, ...mix }        the programme, from the file
//      { cmd: 'mixPlanes', planes, rate, ...mix }  the programme, decoded by the page
//      mix: { desc, descRate, spans, dipDb, fade, video, reading, kbps }
//        desc: the readings, mono 16-bit at descRate; spans: [[start, end]] in seconds, when
//        each reading plays; dipDb: how far the programme is lowered (0: not at all);
//        fade: seconds to go down or back up; video, reading: levels from the mix slider;
//        kbps: an MP3 at this bitrate, or 0 for a WAV.
// out: { type: 'progress', done: 0..1 } ... then { type: 'mix', blob }
//      or { type: 'unsupported' | 'error', message }

importScripts('wave-worker.js', '../vendor/lame.min.js');

// The limiter keeps peaks at CEILING (−1 dBFS), looking LOOKAHEAD seconds ahead so it
// turns down smoothly before a peak rather than at it, then lets go over RELEASE.
const CEILING = 10 ** (-1 / 20), LOOKAHEAD = 0.005, RELEASE = 0.1;
// MP3 encoders add this many samples before the audio (see mp3.js).
const MP3_DELAY = 1105;

class Limiter {
  constructor(rate, out) {
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
    const need = peak > CEILING ? CEILING / peak : 1;
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

const toInt16 = (v) => (v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767));

// 16-bit stereo WAV. Pieces are gathered into a Blob as they fill, which the browser can
// keep on disk.
class WavOut {
  constructor(rate) {
    this.rate = rate;
    this.buf = new Int16Array(1 << 17);
    this.at = 0;
    this.parts = [];
    this.blob = new Blob([]);
    this.bytes = 0;
  }
  push(l, r) {
    this.buf[this.at++] = toInt16(l);
    this.buf[this.at++] = toInt16(r);
    if (this.at === this.buf.length) this.spill();
  }
  spill() {
    if (this.at) { this.parts.push(this.buf.slice(0, this.at)); this.bytes += this.at * 2; this.at = 0; }
    if (this.parts.length >= 64) { this.blob = new Blob([this.blob, ...this.parts]); this.parts = []; }
  }
  finish() {
    this.spill();
    const h = new DataView(new ArrayBuffer(44)), n = this.bytes, rate = this.rate;
    const str = (o, t) => [...t].forEach((ch, i) => h.setUint8(o + i, ch.charCodeAt(0)));
    str(0, 'RIFF'); h.setUint32(4, 36 + n, true); str(8, 'WAVE');
    str(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 2, true);
    h.setUint32(24, rate, true); h.setUint32(28, rate * 4, true); h.setUint16(32, 4, true); h.setUint16(34, 16, true);
    str(36, 'data'); h.setUint32(40, n, true);
    return new Blob([h.buffer, this.blob, ...this.parts], { type: 'audio/wav' });
  }
}

class Mp3Out {
  constructor(rate, kbps) {
    if (![32000, 44100, 48000].includes(rate)) throw new Unsupported(`an MP3 can't be made at ${rate / 1000} kHz; choose WAV`);
    this.enc = new lamejs.Mp3Encoder(2, rate, kbps);
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
    const out = this.enc.encodeBuffer(this.l.subarray(0, this.at), this.r.subarray(0, this.at));
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

// Takes the programme as the parsers hand it over, as Peaks does, and writes the mix.
class Mixer {
  constructor({ desc, descRate, spans, dipDb, fade, video, reading, kbps }) {
    Object.assign(this, { desc, descRate, spans, dipDb, fade, video, reading, kbps });
    this.rate = 0;
    this.n = 0; // frames written
    this.cursor = null;
    this.shift = 0;
    this.progress = 0;
    this.f = 0; // how far down the programme is, 0..1
    this.span = 0;
    this.lastF = 0;
    this.gain = video;
  }

  start(rate) {
    this.rate = rate;
    this.out = this.kbps ? new Mp3Out(rate, this.kbps) : new WavOut(rate);
    this.limiter = new Limiter(rate, (l, r) => this.out.push(l, r));
    this.step = this.fade > 0 ? 1 / (this.fade * rate) : 1;
    this.edges = this.spans.map(([s, e]) => [Math.round(s * rate), Math.round(e * rate)]);
    this.ratio = this.descRate / rate;
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
      // Down while a reading plays and back up after, at the same pace as playback.
      const ed = this.edges;
      while (this.span < ed.length && ed[this.span][1] <= i) this.span++;
      const target = this.dipDb && this.span < ed.length && ed[this.span][0] <= i ? 1 : 0;
      if (this.f !== target) this.f = target > this.f ? Math.min(target, this.f + this.step) : Math.max(target, this.f - this.step);
      if (this.f !== this.lastF) { this.lastF = this.f; this.gain = this.video * 10 ** (-this.dipDb * this.f / 20); }
      const d = this.said(i);
      this.limiter.push(l * this.gain + d, r * this.gain + d);
    }
  }

  // The readings at frame i, between their samples by a smooth curve (Catmull-Rom).
  said(i) {
    const s = this.desc, x = i * this.ratio, j = Math.floor(x);
    if (j < 1 || j + 2 >= s.length) return j >= 0 && j < s.length ? (s[j] / 32768) * this.reading : 0;
    const y0 = s[j - 1], y1 = s[j], y2 = s[j + 1], y3 = s[j + 2];
    if (!(y0 | y1 | y2 | y3)) return 0;
    const f = x - j;
    const v = (((-y0 + 3 * y1 - 3 * y2 + y3) / 2 * f + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * f + (y2 - y0) / 2) * f + y1;
    return (v / 32768) * this.reading;
  }

  post() { postMessage({ type: 'progress', done: this.progress }); }

  finish() {
    if (!this.rate) throw new Error('the programme has no audio');
    // Readings that go on past the end of the programme are kept whole.
    const end = Math.ceil((this.desc.length / this.descRate) * this.rate);
    if (end > this.n) this.frames(null, 0, end - this.n);
    this.limiter.flush();
    return this.out.finish();
  }
}

self.onmessage = async ({ data: job }) => {
  let ticker = 0;
  try {
    const mixer = new Mixer(job);
    if (job.cmd === 'mixPlanes') {
      mixer.add(0, job.planes, job.planes[0].length, job.rate);
    } else {
      ticker = setInterval(() => mixer.post(), 250);
      await parseMedia(job.file, mixer, job);
    }
    const blob = mixer.finish();
    postMessage({ type: 'mix', blob });
  } catch (err) {
    postMessage({ type: err instanceof Unsupported ? 'unsupported' : 'error', message: err.message || String(err) });
  } finally {
    clearInterval(ticker);
    closeDecoders();
  }
};
