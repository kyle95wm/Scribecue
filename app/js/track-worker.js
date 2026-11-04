// Lays the readings out as the description track, away from the page: for a long film
// it's a big job, which would freeze the page on a slower computer.
//
// in:  { readings, secs } as layTrackBlob takes them
// out: { pcm, rate, overlaps }, pcm a Blob of 16-bit mono samples

import { layTrackBlob } from './audio.js';

self.onmessage = ({ data: { readings, secs } }) => postMessage(layTrackBlob(readings, secs));
