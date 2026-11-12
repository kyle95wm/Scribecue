// The takes in a narration WAV from Record mode. The WAV is exact silence apart from the
// takes, so any stretch of samples that aren't zero is a take. It's fed the WAV's 24-bit
// samples a piece at a time, so a long programme is never held in memory, and keeps only
// the takes, as 16-bit samples for the mixer.

// Zeros shorter than this inside a take keep it in one piece, in seconds.
export const GAP = 0.5;

// rate: the WAV's sample rate. push(bytes): the next piece of 24-bit mono samples, a whole
// number of samples long. end(): the takes, as [{ start (seconds), samples: Int16Array }].
export function createScan(rate, gap = GAP) {
  const maxGap = Math.max(1, Math.round(gap * rate));
  const runs = [];
  let pos = 0;      // the sample number of the next sample pushed
  let cur = null;   // the take being read: { start, buf, n }
  let zeros = 0;    // zeros since the take's last sound
  const put = (v) => {
    if (cur.n === cur.buf.length) { const b = new Int16Array(cur.buf.length * 2); b.set(cur.buf); cur.buf = b; }
    cur.buf[cur.n++] = v;
  };
  const close = () => {
    if (cur) runs.push({ start: cur.start / rate, samples: cur.buf.slice(0, cur.n) });
    cur = null;
    zeros = 0;
  };
  return {
    push(bytes) {
      for (let o = 0; o + 2 < bytes.length; o += 3, pos++) {
        const v = ((bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16)) << 8) >> 8;
        if (v === 0) {
          if (cur && ++zeros > maxGap) close();
          continue;
        }
        if (!cur) cur = { start: pos, buf: new Int16Array(rate), n: 0 };
        for (; zeros > 0; zeros--) put(0);
        put(v >> 8);
      }
    },
    end() { close(); return runs; },
  };
}

// Whether time t, on the narration's timeline, falls in one of the pauses. pauses:
// [{ at, secs }] in the programme's time, in order, as the narration's note keeps them.
export function inPause(pauses, t) {
  let added = 0;
  for (const { at, secs } of pauses) {
    const from = at + added;
    if (t < from) return false;
    if (t < from + secs) return true;
    added += secs;
  }
  return false;
}
