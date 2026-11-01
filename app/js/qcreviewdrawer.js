import { collaborationJob } from './collaboration.js';
import { voiceLabel } from './tts.js';
const $ = (id) => document.getElementById('reviewCompare' + id);
let h, controller, working = false, authoring = false, local, returned, result, generation, position = 0, decisions = [], finished = false;
const status = (text) => { $('Status').textContent = text; };
const key = (c) => c.kind === 'project' ? `project:${c.field}` : `${c.kind}:${c.uid}`;
function current() {
  if (!$('Dlg').open) throw new DOMException('Closed', 'AbortError');
  if (!h.allowed() || h.generation() !== generation) throw new Error('Your review changed during comparison. Close this window and compare again');
}
function busy(on) {
  $('Progress').hidden = !on;
  for (const id of ['Pick', 'Save', 'Previous', 'Next', 'UseLocal', 'UseRemote']) $(id).disabled = on || working;
  $('Stop').hidden = !controller;
  if (!on) render();
}
async function compare(resolutions = []) {
  controller = new AbortController(); $('Progress').value = 0; busy(true);
  try { return await collaborationJob({ task: 'returnedReview', local, file: returned, localPermission: h.permission(), authoring, resolutions }, {
    signal: controller.signal, progress: (done, total, stage) => {
      $('Progress').value = total ? done / total : 0;
      status(`${stage === 'readings' ? 'Checking original readings' : 'Comparing blocks'}: ${done} of ${total}`);
    },
  }); } finally { controller = null; $('Stop').hidden = true; $('Progress').hidden = true; }
}
const comments = (value = []) => value.map((c) => `${c.time == null ? '' : h.time(c.time) + ' · '}${c.author || 'Comment'}: ${c.text}${c.resolved ? ' (resolved)' : ''}`).join('\n\n') || 'No comments.';
function describe(block) {
  if (!block) return 'Block removed.';
  return [block.text || '(Empty block)', block.voice && `Voice: ${voiceLabel(block.voice)}`,
    block.speed && `Speed: ${Math.round(block.speed * 100)}%`, block.auto && 'End follows reading', block.fit && 'Speed fits slot', block.pinned && 'Speed fixed',
    block.vol != null && `Volume: ${block.vol}%`, block.dip != null && `Programme dip: ${block.dip === 0 ? 'None' : '−' + block.dip + ' dB'}`,
    block.dipBy != null && `Dip adjustment: ${String(block.dipBy).replace('-', '−')} dB`, block.pickup && `Pickup: ${block.pickup.note || 'Marked'}`,
    block.say?.length && `Sounds like: ${block.say.map(([a, b]) => `${a} → ${b}`).join('; ')}`, block.comments?.length && comments(block.comments)].filter(Boolean).join('\n\n');
}
function render() {
  const conflicts = result?.conflicts || [], conflict = conflicts[position], chosen = new Set(decisions.map(key));
  $('Conflicts').hidden = !conflict; $('Save').hidden = !result || finished;
  $('Save').textContent = authoring ? 'Accept review' : 'Save combined review';
  $('Save').disabled = !!controller || working || !result || conflicts.some((c) => !chosen.has(key(c)));
  if (!conflict) return;
  $('Count').textContent = `Conflict ${position + 1} of ${conflicts.length}`;
  $('Title').textContent = conflict.kind === 'block' ? 'Choose a block version' : conflict.kind === 'block-comments' ? 'Choose comments for this block' : 'Timeline comments';
  for (const [side, project] of [['Local', local], ['Remote', result.remote]]) {
    const block = conflict.kind !== 'project' ? project.blocks.find((b) => b.uid === conflict.uid) : null;
    $(side + 'Time').textContent = block ? `${h.time(block.start)} – ${h.time(block.end)}` : '';
    $(side + 'Text').textContent = conflict.kind === 'block' ? describe(block) : conflict.kind === 'block-comments' ? comments(block?.comments) : comments(project.comments);
    $('Use' + side).setAttribute('aria-pressed', String(decisions.some((d) => key(d) === key(conflict) && d.choice === side.toLowerCase())));
  }
  $('Previous').disabled = !!controller || working || position === 0;
  $('Next').disabled = !!controller || working || position === conflicts.length - 1;
}
function report(error) { status(error.name === 'AbortError' ? 'Stopped. Your current review is unchanged.' : error.message); }
async function saveReview(file, name, author = false) {
  if (!window.showSaveFilePicker) {
    const a = document.createElement('a'), url = URL.createObjectURL(file);
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); return null;
  }
  let handle = author ? h.authorHandle() : null;
  if (handle && (!/\.scribecue$/i.test(handle.name) || (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted')) handle = null;
  if (!handle) handle = await window.showSaveFilePicker({ suggestedName: name, types: author
    ? [{ description: 'Scribecue project', accept: { 'application/json': ['.scribecue'] } }]
    : [{ description: 'QC package', accept: { 'application/octet-stream': ['.scribecueqc'] } }] });
  const writer = await handle.createWritable();
  try { await writer.write(file); await writer.close(); }
  catch (error) { try { await writer.abort?.(); } catch { /* keep the write error */ } throw error; }
  return handle;
}
export function openReviewCompare() {
  if (!h.allowed() || working) return h.toast('Switch to QC and open the project or original QC package to compare a returned review');
  authoring = h.authoring(); local = h.project(); generation = h.generation(); returned = result = null; position = 0; decisions = []; finished = false;
  $('Intro').textContent = authoring
    ? 'Accept returned comments and permitted corrections into your authoring project. You keep editing access. Original readings stay on this computer; keep the QC package to reopen them elsewhere.'
    : 'Combine returned comments and permitted corrections with your work. The package’s original readings and editing permission stay with the review. Nothing is uploaded.';
  status(authoring ? 'Choose the returned QC package. Accepting saves your authoring project.' : 'Choose the returned QC package. Your current work stays open until the combined review is saved.');
  render(); $('Dlg').showModal();
}
export function initReviewCompare(hooks) {
  h = hooks;
  $('Close').onclick = () => $('Dlg').close();
  $('Dlg').addEventListener('close', () => {
    // close() queues this event; a fast reopen already owns fresh state.
    if ($('Dlg').open) return;
    controller?.abort(); local = returned = result = null; decisions = [];
  });
  document.addEventListener('keydown', (e) => { if ($('Dlg').open) e.stopPropagation(); }, true);
  $('Stop').onclick = () => controller?.abort();
  $('Pick').onclick = () => { if (!working) $('File').click(); };
  $('File').onchange = async () => {
    const file = $('File').files[0]; $('File').value = '';
    if (!file || working) return;
    working = true; result = null; decisions = []; position = 0; finished = false; busy(true); render();
    try {
      current();
      if (!/\.scribecueqc$/i.test(file.name)) throw new Error('Choose the returned .scribecueqc package');
      returned = file; status('Opening returned review…'); result = await compare(); current();
      status(result.conflicts.length ? `${result.conflicts.length === 1 ? '1 conflict needs' : result.conflicts.length + ' conflicts need'} a choice. Other changes will be combined.`
        : authoring ? 'The review is ready to accept into your authoring project. Original readings will stay available in QC.' : 'The review can be combined. Its original readings and editing permission will be kept.');
    } catch (error) { result = null; report(error); }
    finally { working = false; busy(false); }
  };
  for (const side of ['Local', 'Remote']) $('Use' + side).onclick = () => {
    const conflict = result?.conflicts[position]; if (!conflict || working) return;
    decisions = [...decisions.filter((d) => key(d) !== key(conflict)), { ...conflict, choice: side.toLowerCase() }]; render();
  };
  $('Previous').onclick = () => { if (position > 0) { position--; render(); } };
  $('Next').onclick = () => { if (position + 1 < result.conflicts.length) { position++; render(); } };
  $('Save').onclick = async () => {
    if (working || !result) return;
    working = true; busy(true);
    try {
      current(); const resolved = await compare(decisions); current();
      if (!resolved.file) throw new Error('Choose a version for each conflict first');
      const name = h.baseName() + (authoring ? '.scribecue' : '-reviewed.scribecueqc');
      const file = authoring ? resolved.authorFile : resolved.file;
      if (!file) throw new Error('The review could not be prepared for this project');
      // Store audio independently of the authoring file, so saving a script never packs
      // a full movie's narration into JSON. The returned package remains the portable copy.
      let kept = true;
      if (authoring) {
        status('Keeping original readings…'); $('Progress').hidden = false; $('Progress').removeAttribute('value');
        kept = await h.cacheAudio(resolved.authorProject.projectId, resolved.authorProject.reviewAudio.baselineId, resolved.file);
      }
      current();
      status(authoring ? 'Saving authoring project…' : 'Saving combined review…');
      $('Progress').hidden = false; $('Progress').removeAttribute('value');
      const handle = await saveReview(file, name, authoring); current();
      if (!handle) {
        finished = true;
        status(authoring ? 'Authoring project downloaded. Open it to continue. Keep the QC package for its original readings.' : 'Combined review downloaded. Open it to continue. Your current work is unchanged.');
        return;
      }
      const applied = authoring
        ? await h.applyAuthor(file, resolved.file, handle, handle.name, generation)
        : await h.apply(resolved.file, handle, handle.name, generation);
      if (!applied) throw new Error('The file was saved, but your current work changed. Your newer work is kept');
      $('Dlg').close();
      h.toast(authoring ? kept ? 'Review accepted. Your project stays editable, with original readings in QC' : 'Review accepted. Keep the QC package to reopen its original readings next time' : 'Combined review saved and opened');
    } catch (error) { report(error); }
    finally { working = false; busy(false); }
  };
}
