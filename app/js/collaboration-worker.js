// QC metadata and one original clip at a time; no full-film audio decoding.
import { mergeProjects } from './collaboration.js';
import { prepareReviewBaseline, compareReturnedReview, verifyReviewAttachment, acceptedReviewProject } from './qcreview.js';
import { readReview, resaveReview } from './qc.js';
self.onmessage = async ({ data }) => {
  const progress = (done, total, stage = 'blocks') => self.postMessage({ type: 'progress', done, total, stage });
  try {
    let result;
    if (data.task === 'prepareReview') result = await prepareReviewBaseline(data.project, data.readings, data.allowEdits);
    else if (data.task === 'returnedReview') {
      const review = await readReview(data.file);
      result = await compareReturnedReview(data.local, review, { progress, resolutions: data.resolutions, localPermission: data.localPermission });
      if (result.project) {
        result.file = resaveReview(review, result.project);
        if (data.authoring) {
          result.authorProject = acceptedReviewProject(data.local, result.project, review.baselineId);
          result.authorFile = new Blob([JSON.stringify(result.authorProject, null, 1)], { type: 'application/json' });
        }
      }
    } else if (data.task === 'reviewAudio') {
      const review = await readReview(data.file);
      await verifyReviewAttachment(data.project, review, progress);
      result = { review: await readReview(resaveReview(review, review.project)) };
    } else if (data.task === 'compare') result = mergeProjects(data.base, data.local, data.remote, progress);
    else throw new Error('Unknown review comparison');
    self.postMessage({ type: 'result', result });
  } catch (error) { self.postMessage({ type: 'error', error: error.message }); }
};
