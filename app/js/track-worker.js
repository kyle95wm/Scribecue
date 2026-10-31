// Lays the readings out as the description track, away from the page: for a long film
// it's a big job, which would freeze the page on a slower computer.
//
// in:  { readings, secs } as layTrack takes them
// out: { samples, rate, overlaps }

import { layTrack } from './audio.js';

self.onmessage = ({ data: { readings, secs } }) => {
  const out = layTrack(readings, secs);
  postMessage(out, [out.samples.buffer]);
};
