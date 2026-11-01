// QC handoff comparison. A local exported baseline is authoritative; a returned
// package cannot grant itself editing permission or substitute its original audio.
import { fromProject, toProject, cleanReviewHistory, validIdentity, validRevision } from './project.js';
import { mergeProjects, sharedSnapshot, stable, digest, retainHistory } from './collaboration.js';

export const hashReading = async (blob) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
  (b) => b.toString(16).padStart(2, '0')).join('');
const descriptor = ({ blockUid, key, offset, bytes, secs, voice, sha }) => ({ blockUid, key, offset, bytes, secs, voice, sha });
function checkReadings(readings, project) {
  if (!Array.isArray(readings)) throw new Error('The QC starting point is damaged');
  const blocks = new Set(project.blocks.map((b) => b.uid)), seen = new Set();
  let offset = 8;
  for (const r of readings) {
    if (!r || !validIdentity(r.blockUid) || !blocks.has(r.blockUid) || seen.has(r.blockUid) || !validRevision(r.sha) ||
      typeof r.key !== 'string' || typeof r.voice !== 'string' || r.offset !== offset || !Number.isSafeInteger(r.bytes) || r.bytes < 44 ||
      !Number.isFinite(r.secs) || r.secs <= 0) throw new Error('The QC starting point is damaged');
    seen.add(r.blockUid); offset += r.bytes;
  }
}
export async function reviewBaseline(checkpoint, projectId) {
  let value;
  try { value = JSON.parse(checkpoint.snapshot); } catch { throw new Error('The QC starting point is damaged'); }
  if (!value || typeof value.allowEdits !== 'boolean' || value.project?.projectId !== projectId ||
    stable(sharedSnapshot(value.project)) !== stable(value.project) || stable(value) !== checkpoint.snapshot || await digest(checkpoint.snapshot) !== checkpoint.id) {
    throw new Error('The QC starting point does not match its saved revision');
  }
  checkReadings(value.readings, value.project);
  return value;
}
export async function prepareReviewBaseline(project, readings, allowEdits = false) {
  const script = sharedSnapshot(project), history = cleanReviewHistory(project.reviewHistory);
  if (history) for (const checkpoint of history.checkpoints) await reviewBaseline(checkpoint, project.projectId);
  const audio = readings.map(descriptor); checkReadings(audio, script);
  const snapshot = stable({ project: script, readings: audio, allowEdits: allowEdits === true }), id = await digest(snapshot);
  const checkpoint = { id, parents: history?.checkpoints.length && history.checkpoints.at(-1).id !== id ? [history.checkpoints.at(-1).id] : [], snapshot };
  return { project: toProject({ ...fromProject(project), app: project.app,
    reviewHistory: { version: 1, checkpoints: [checkpoint] } }), baselineId: id };
}
const scriptOnly = (project) => project.blocks.map(({ comments, qcReading, ...b }) => b);
export async function compareReturnedReview(local, returned, { progress = () => {}, resolutions = [], localPermission = null } = {}) {
  const history = cleanReviewHistory(local.reviewHistory);
  const checkpoint = history?.checkpoints.find((c) => c.id === returned.baselineId);
  if (!checkpoint) throw new Error('No matching QC starting point. Export a new QC package and send it again');
  const baseline = await reviewBaseline(checkpoint, local.projectId);
  if (returned.parsed.projectId !== local.projectId) throw new Error('This review belongs to a different project');
  if (returned.permissions.allowEdits !== baseline.allowEdits || (localPermission === false && baseline.allowEdits)) {
    throw new Error('The review’s editing permission differs from the exported package');
  }
  const remote = sharedSnapshot(returned.project);
  if (!baseline.allowEdits && (stable(scriptOnly(remote)) !== stable(scriptOnly(baseline.project)) ||
    (localPermission === false && stable(scriptOnly(sharedSnapshot(local))) !== stable(scriptOnly(baseline.project))))) {
    throw new Error('A comments-only review changed the script or timings');
  }
  await verifyOriginalAudio(baseline, returned, progress);
  // Listening preferences, programme notes and recording handoffs belong to the writer.
  // A review brings back block corrections and comments, not replacement project settings.
  const incoming = { ...baseline.project, blocks: remote.blocks, comments: remote.comments };
  const result = mergeProjects(baseline.project, { ...sharedSnapshot(local), settings: fromProject(local).settings }, incoming,
    (done, total) => progress(done, total, 'blocks'), resolutions);
  if (result.project) {
    const offsets = new Map(baseline.readings.map((r) => [r.blockUid, r.offset]));
    for (const b of result.project.blocks) if (offsets.has(b.uid)) b.qcReading = offsets.get(b.uid);
    result.project.settings.mode = 'qc';
    result.project.reviewHistory = { version: 1, checkpoints: [checkpoint] };
  }
  return { ...result, remote: toProject({ ...fromProject(incoming), app: returned.project.app }), base: baseline.project };
}

// Attach audio using a known baseline hash. Package contents never grant author access.
async function verifyOriginalAudio(baseline, returned, progress) {
  if (returned.permissions.allowEdits !== baseline.allowEdits) throw new Error('The review’s editing permission differs from the exported package');
  if (stable(returned.readings.map(descriptor)) !== stable(baseline.readings)) throw new Error('The review’s original readings differ from the exported package');
  // Read and hash one clip at a time, never a full film's decoded audio.
  for (let i = 0; i < baseline.readings.length; i++) {
    const r = baseline.readings[i]; progress(i, baseline.readings.length, 'readings');
    if (await hashReading(returned.file.slice(r.offset, r.offset + r.bytes)) !== r.sha) {
      throw new Error('The review’s original audio differs from the exported package');
    }
  }
  progress(baseline.readings.length, baseline.readings.length, 'readings');
}
export async function verifyReviewAttachment(project, returned, progress = () => {}) {
  const id = project.reviewAudio?.baselineId;
  if (!id || returned.baselineId !== id || returned.parsed.projectId !== project.projectId) throw new Error('Choose the QC package matching this project’s original readings');
  // The retained hash commits the baseline even after an old round leaves local history.
  const checkpoint = [...(project.reviewHistory?.checkpoints || []), ...(returned.parsed.reviewHistory?.checkpoints || [])].find((c) => c.id === id);
  if (!checkpoint) throw new Error('This package has no matching original readings');
  const baseline = await reviewBaseline(checkpoint, project.projectId);
  await verifyOriginalAudio(baseline, returned, progress);
  return returned;
}
export function acceptedReviewProject(local, merged, baselineId) {
  if (local.projectId !== merged.projectId || !validRevision(baselineId)) throw new Error('The accepted review belongs to a different project');
  const checkpoint = merged.reviewHistory?.checkpoints.find((c) => c.id === baselineId);
  if (!checkpoint) throw new Error('The accepted review has no matching starting point');
  const author = fromProject(local), combined = fromProject(merged);
  return toProject({ ...combined, app: local.app, view: author.view,
    settings: { ...combined.settings, mode: author.settings.mode || 'write' },
    reviewHistory: retainHistory([...(author.reviewHistory?.checkpoints || []), checkpoint]),
    reviewAudio: { baselineId } });
}
