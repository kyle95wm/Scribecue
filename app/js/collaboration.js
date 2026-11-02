// Local collaboration primitives. No transport, account state or permission enforcement.
// Merge saved project snapshots against their exact shared ancestor, never by position.
import { fromProject, toProject, validIdentity, HISTORY_LIMIT, HISTORY_CHARS } from './project.js';

const equal = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
};

function checked(project) {
  const parsed = fromProject(project);
  if (!validIdentity(project.projectId)) throw new Error('Save the project in this version before sharing it');
  if (parsed.blocks.length !== project.blocks.length || parsed.blocks.some((b) => !validIdentity(b.uid))) {
    throw new Error('Every shared block needs an identity');
  }
  return parsed;
}

// Fail closed on unknown roles and actions. This describes the proposed service policy;
// callers must still authenticate users and check current membership on every request.
const grants = {
  view: ['read'],
  review: ['read', 'comment'],
  edit: ['read', 'comment', 'edit'],
  record: ['read', 'record'],
  owner: ['read', 'comment', 'edit', 'record', 'manage'],
};
export const allows = (role, action) => Object.hasOwn(grants, role) && grants[role].includes(action);

// Conflicting results have no project to apply. The caller keeps all three originals
// and asks the user to resolve the listed conflicts. Inputs are never changed.
// Comments and settings are atomic for now: concurrent changes require review.
// `changes` lists blocks only the remote side changed; a 'local' choice declines one.
// A 'remote' choice may carry `edit`: wording and times to use instead of the remote ones.
export function mergeProjects(base, local, remote, progress = () => {}, resolutions = []) {
  const [b, l, r] = [base, local, remote].map(checked);
  if (base.projectId !== local.projectId || base.projectId !== remote.projectId) {
    throw new Error('These copies belong to different projects');
  }
  const conflicts = [], changes = [], blocks = [];
  const key = (r) => r.kind === 'project' ? `project:${r.field}` : `${r.kind}:${r.uid}`;
  const choices = new Map(resolutions.map((r) => [key(r), r]));
  const edited = (theirs, edit) => {
    if (!theirs || !edit) return theirs;
    const { text, start, end } = edit;
    if (typeof text !== 'string' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('An edited block needs wording, and an end after its start');
    return { ...theirs, text, start, end };
  };
  const choose = (before, ours, theirs, target) => {
    if (equal(ours, theirs) || equal(before, theirs)) return ours;
    const { choice, edit } = choices.get(key(target)) || {};
    if (equal(before, ours)) {
      if (target.kind !== 'block') return theirs;
      changes.push(target);
      return choice === 'local' ? ours : edited(theirs, edit);
    }
    if (choice === 'local') return ours;
    if (choice === 'remote') return target.kind === 'block' ? edited(theirs, edit) : theirs;
    conflicts.push(target);
    return ours;
  };
  const maps = [b, l, r].map((p) => new Map(p.blocks.map((block) => [block.uid, block])));
  const ids = new Set(maps.flatMap((m) => [...m.keys()]));
  let done = 0;
  for (const uid of ids) {
    const [before, ours, theirs] = maps.map((m) => m.get(uid));
    let result;
    if (before && ours && theirs) {
      const body = ({ comments, ...block }) => block;
      const block = choose(body(before), body(ours), body(theirs), { kind: 'block', uid });
      const comments = choose(before.comments || [], ours.comments || [], theirs.comments || [], { kind: 'block-comments', uid });
      result = { ...block, ...(comments.length ? { comments } : {}) };
    } else result = choose(before, ours, theirs, { kind: 'block', uid });
    if (result) blocks.push(result);
    if (++done % 128 === 0) progress(done, ids.size);
  }
  // Ignore view state, save timestamps, app versions and each person's working mode.
  const sharedSettings = ({ mode, ...settings }) => settings;
  const project = toProject({ ...l, projectId: local.projectId, app: typeof local.app === 'string' ? local.app : '',
    blocks: blocks.sort((a, z) => a.start - z.start || a.uid.localeCompare(z.uid)) });
  for (const field of ['notes', 'comments', 'media', 'recording']) {
    project[field] = choose(b[field], l[field], r[field], { kind: 'project', field });
  }
  project.settings = { ...choose(...[b, l, r].map((p) => sharedSettings(p.settings)), { kind: 'project', field: 'settings' }),
    ...(l.settings.mode ? { mode: l.settings.mode } : {}) };
  progress(ids.size, ids.size);
  return { project: conflicts.length ? null : structuredClone(project), conflicts, changes };
}

// The page entry point. A fresh worker keeps comparisons off the UI thread and bounds
// their lifetime. Cancelling terminates it rather than letting an obsolete job finish.
export function compareProjectCopies(base, local, remote, options = {}) {
  return collaborationJob({ task: 'compare', base, local, remote }, options);
}
export function collaborationJob(job, { signal, progress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Comparison stopped', 'AbortError'));
    const worker = new Worker(new URL('./collaboration-worker.js', import.meta.url), { type: 'module' });
    const finish = (error, result) => {
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const cancel = () => finish(new DOMException('Comparison stopped', 'AbortError'));
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        try { progress(data.done, data.total, data.stage); } catch (error) { finish(error); }
      }
      else if (data.type === 'error') finish(new Error(data.error));
      else if (data.type === 'result') finish(null, data.result);
    };
    worker.onerror = (event) => finish(new Error(event.message || 'The project copies could not be compared'));
    worker.onmessageerror = () => finish(new Error('The comparison result could not be read'));
    try { worker.postMessage(job); } catch (error) { finish(error); }
  });
}

// Content-addressed checkpoints are opt-in and bounded. They establish a common file
// baseline, not authenticated membership or tamper-proof history.
export function sharedSnapshot(project) {
  const p = checked(project);
  const { mode, ...settings } = p.settings;
  return { scribecue: 1, projectId: p.projectId, blocks: p.blocks.map(({ qcReading, ...b }) => b),
    notes: p.notes, comments: p.comments, media: p.media, recording: p.recording, settings };
}
export const stable = (value) => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);
export const digest = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
  (b) => b.toString(16).padStart(2, '0')).join('');

export function retainHistory(checkpoints) {
  const unique = new Map();
  for (const c of checkpoints) { unique.delete(c.id); unique.set(c.id, c); }
  const kept = [...unique.values()];
  while (kept.length > 1 && (kept.length > HISTORY_LIMIT || kept.reduce((n, c) => n + c.snapshot.length, 0) > HISTORY_CHARS)) kept.shift();
  if (kept[0].snapshot.length > HISTORY_CHARS) throw new Error('This script is too large for a QC package');
  return { version: 1, checkpoints: kept };
}
