import { readReview } from './qc.js';
self.onmessage = async ({ data }) => {
  try { self.postMessage({ review: await readReview(data) }); }
  catch (e) { self.postMessage({ error: e.message || 'The QC package could not be opened' }); }
};
