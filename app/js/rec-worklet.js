// Captures the microphone's raw samples for the narrator's takes (see record.js). It
// reports the loudest sample for the level meter all the time, and hands over the samples
// in pieces once told to start, until told to stop.

class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.keep = false;
    this.buf = new Float32Array(4096);
    this.n = 0;
    this.peak = 0;
    this.blocks = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'start') this.keep = true;
      else if (e.data === 'stop') {
        this.keep = false;
        this.port.postMessage({ pcm: this.buf.slice(0, this.n), done: true });
        this.n = 0;
      }
    };
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > this.peak) this.peak = v; }
    if (++this.blocks >= 8) { this.port.postMessage({ peak: this.peak }); this.peak = 0; this.blocks = 0; }
    if (this.keep) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage({ pcm: this.buf }, [this.buf.buffer]); this.buf = new Float32Array(4096); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('rec-capture', Capture);
