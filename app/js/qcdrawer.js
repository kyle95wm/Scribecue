import { buildReview, openReview, hasReviewText, playbackReading, reviewSink, voiceReport, readsLive, liveBlock, liveVoices, REVIEW_EXT } from './qc.js';
import { reviewVoices, reviewAudio, voiceLabel, chosenVoice, usingGoogle, hasGoogleKey, isPersonalGoogleKey, webPiper, downloadVoice, loadPiper, megabytes, missingVoiceAdvice } from './tts.js';
import { HOSTED } from './config.js';
const $ = (id) => document.getElementById(id);
let h, controller = null;
export function qcReport() { const p = h.project(); return voiceReport(p.blocks, p.settings, reviewVoices()); }
export function refreshQc() {
  if (!h) return;
  if (!$('qcPlaybackDlg').open && !$('qcExportDlg').open) return;
  const p = h.project(), report = voiceReport(p.blocks, p.settings, reviewVoices());
  for (const id of ['qcVoiceList', 'qcExportVoices']) {
    const list = $(id); list.replaceChildren();
    for (const v of report) {
      const row = document.createElement('li');
      row.textContent = `${v.id ? voiceLabel(v.id) : 'No voice chosen'} · blocks ${v.blocks.slice(0, 12).join(', ')}${v.blocks.length > 12 ? '…' : ''}: ${!v.available ? 'not available here' : !v.exportable ? 'playback only; cannot package audio' : v.id.startsWith('piper:') ? 'read on the reviewer’s computer' : 'audio kept in the package'}`;
      list.append(row);
    }
  }
  const review = h.review(), spoken = p.blocks.filter((b) => hasReviewText(b, p.settings));
  const live = spoken.filter((b) => liveBlock(review, b, p.settings)).length, missing = review ? missingVoices() : [];
  const valid = spoken.filter((b) => playbackReading(review, b, p.settings) || liveBlock(review, b, p.settings)).length;
  $('qcPackageInfo').textContent = review ? `${valid} of ${spoken.length} blocks have matching saved readings. ${valid < spoken.length ? 'Changed Google blocks are read when you finish editing them. Other missing readings need a new package from the writer.' : live ? 'Piper blocks are read on this computer. Other audio is included.' : 'The included audio plays without installing these voices or adding a key.'}` : 'No original readings are included. Use the programme sound, ask for a QC package, or explicitly choose an approximate TTS preview.';
  for (const [id, source] of [['qcSourceVideo', 'video'], ['qcSourcePackage', 'package'], ['qcSourcePreview', 'preview']]) {
    $(id).setAttribute('aria-pressed', String(h.source() === source));
  }
  $('qcAttachReadings').hidden = !h.audioReference?.() || !!review;
  $('qcGetVoices').hidden = !missing.length;
  if (!review && h.audioReference?.()) $('qcPackageInfo').textContent = 'Original readings are not available in this browser. Locate the matching QC package to hear them again.';
  $('qcSourcePackage').disabled = !review;
  $('qcSourcePackage').textContent = review?.proposals.length ? 'Saved readings' : 'Original readings';
  const googleReview = h.package() && review?.permissions.allowEdits && review.readings.some((r) => r.voice.startsWith('google:'));
  $('qcKeyInfo').hidden = !googleReview;
  $('qcKeyInfo').textContent = `${hasGoogleKey() ? `Your Google key reads changed blocks when you finish editing them${review?.reviewAccess ? '. If it fails, the separate key in this package is used' : ''}.` : review?.reviewAccess ? 'The separate key in this package reads changed blocks when you finish editing them.' : 'Add your Google key in Text to speech settings to read changed blocks.'} Only changed wording or speed needs Google. Saved readings play offline. Save keeps the review key for continued work; Export → Return package leaves it out.`;
  const select = $('qcPreviewVoice'), selected = select.value;
  select.replaceChildren(...reviewVoices().map((v) => new Option(v.name, v.id)));
  select.value = reviewVoices().some((v) => v.id === selected) ? selected : chosenVoice();
  $('qcSourcePreview').disabled = !select.options.length;
  $('qcPreviewNote').textContent = 'Approximate preview: missing voices use the voice selected below, and blocks read in it keep their timings. This is not the writer’s original reading. Online voices send text to their provider.';
  if (!controller) $('qcExportStart').disabled = !spoken.length || report.some((v) => !v.available || !v.exportable);
  $('qcExportCost').hidden = !report.some((v) => usingGoogle(v.id));
  const googleAccess = $('qcExportAllowEdits').getAttribute('aria-pressed') === 'true' && report.some((v) => v.id.startsWith('google:'));
  $('qcGoogleAccess').hidden = !googleAccess;
  if (!googleAccess) { $('qcExportGoogle').setAttribute('aria-pressed', 'false'); $('qcGoogleKey').value = ''; }
  $('qcGoogleKeyRow').hidden = $('qcExportGoogle').getAttribute('aria-pressed') !== 'true';
}
function missingVoices() {
  const p = h.project(), here = new Set(reviewVoices().map((v) => v.id));
  return liveVoices(h.review(), p.blocks, p.settings).filter((id) => !here.has(id));
}
// Downloadable voices in the web version. Docker's Piper voices come with its setup.
const offered = (id) => webPiper.offered?.[id.slice(6)];
function showVoiceOffer() {
  const missing = missingVoices();
  if (!missing.length) { if ($('qcVoiceDlg').open) $('qcVoiceDlg').close(); return; }
  const get = HOSTED ? missing.filter(offered) : [];
  const size = get.reduce((sum, id) => sum + offered(id), webPiper.engineReady ? 0 : webPiper.engine);
  $('qcVoiceList2').replaceChildren(...missing.map((id) => {
    const row = document.createElement('li');
    row.textContent = `${voiceLabel(id)}${get.includes(id) ? '' : `: ${missingVoiceAdvice(id, { hosted: HOSTED })}`}`;
    return row;
  }));
  $('qcVoiceGet').hidden = !get.length;
  $('qcVoiceGet').textContent = `Download ${megabytes(size)}`;
  $('qcVoiceStatus').textContent = '';
  if (!$('qcVoiceDlg').open) $('qcVoiceDlg').showModal();
}
async function getVoices() {
  $('qcVoiceGet').disabled = true;
  const timer = setInterval(() => {
    const d = webPiper.downloading;
    $('qcVoiceStatus').textContent = d?.total ? `${megabytes(d.loaded)} of ${megabytes(d.total)}` : 'Starting…';
  }, 300);
  try { for (const id of missingVoices().filter(offered)) await downloadVoice(id.slice(6), { choose: false }); }
  finally { clearInterval(timer); $('qcVoiceGet').disabled = false; }
  showVoiceOffer(); refreshQc();
}
// Offered once a package has opened and anything showing first, such as setup, has closed.
export async function offerLiveVoices() {
  const review = h.review();
  await loadPiper();
  while (document.querySelector('dialog[open]')) await new Promise((r) => setTimeout(r, 500));
  if (h.review() === review) showVoiceOffer();
}
export function openQcPlayback() { if (!h.qc()) return; refreshQc(); $('qcPlaybackDlg').showModal(); refreshQc(); }
export function openQcExport() {
  if (!h.canCreate()) return h.toast('QC packages are made from the writer’s project. Open it to create a new package');
  $('qcExportAllowEdits').setAttribute('aria-pressed', 'false'); $('qcExportGoogle').setAttribute('aria-pressed', 'false'); $('qcGoogleKey').value = ''; $('qcExportStatus').textContent = ''; $('qcExportDlg').showModal(); refreshQc(); }
export function initQc(hooks) {
  h = hooks;
  $('qcExportAllowEdits').onclick = () => { if (!controller) { $('qcExportAllowEdits').setAttribute('aria-pressed', String($('qcExportAllowEdits').getAttribute('aria-pressed') !== 'true')); refreshQc(); } };
  $('qcExportGoogle').onclick = () => {
    if (controller) return;
    const on = $('qcExportGoogle').getAttribute('aria-pressed') !== 'true';
    $('qcExportGoogle').setAttribute('aria-pressed', String(on));
    if (!on) $('qcGoogleKey').value = '';
    refreshQc(); if (on) $('qcGoogleKey').focus();
  };
  for (const [id, source] of [['qcSourceVideo', 'video'], ['qcSourcePackage', 'package'], ['qcSourcePreview', 'preview']]) {
    $(id).onclick = () => { h.setSource(source, $('qcPreviewVoice').value); refreshQc(); };
  }
  $('qcPreviewVoice').onchange = () => { if (h.source() === 'preview') h.setSource('preview', $('qcPreviewVoice').value); };
  $('qcCompareReturned').onclick = () => { $('qcPlaybackDlg').close(); h.compare(); };
  $('qcAttachReadings').onclick = () => $('qcReadingsFile').click();
  $('qcReadingsFile').onchange = async () => {
    const file = $('qcReadingsFile').files[0]; $('qcReadingsFile').value = ''; if (!file) return;
    $('qcAttachReadings').disabled = true; $('qcPackageInfo').textContent = 'Checking original readings…';
    try { await h.attachAudio(file); refreshQc(); }
    catch (error) { $('qcPackageInfo').textContent = error.message; }
    finally { $('qcAttachReadings').disabled = false; }
  };
  $('qcPlaybackClose').onclick = () => $('qcPlaybackDlg').close();
  $('qcGetVoices').onclick = () => { $('qcPlaybackDlg').close(); showVoiceOffer(); };
  $('qcVoiceGet').onclick = getVoices;
  $('qcVoiceLater').onclick = () => $('qcVoiceDlg').close();
  $('qcExportClose').onclick = () => { controller?.abort(); $('qcExportDlg').close(); };
  $('qcExportStop').onclick = () => controller?.abort();
  $('qcExportDlg').addEventListener('cancel', () => controller?.abort());
  $('qcExportDlg').addEventListener('close', () => { $('qcGoogleKey').value = ''; });
  for (const id of ['qcPlaybackDlg', 'qcExportDlg', 'qcVoiceDlg']) document.addEventListener('keydown', (e) => { if ($(id).open) e.stopPropagation(); }, true);
  $('qcExportStart').onclick = async () => {
    if (controller || !h.canCreate()) return;
    const allowEdits = $('qcExportAllowEdits').getAttribute('aria-pressed') === 'true';
    const googleReviewKey = $('qcExportGoogle').getAttribute('aria-pressed') === 'true' ? $('qcGoogleKey').value.trim() : '';
    if ($('qcExportGoogle').getAttribute('aria-pressed') === 'true' && !googleReviewKey) { $('qcExportStatus').textContent = 'Paste the separate review key first'; return; }
    if (isPersonalGoogleKey(googleReviewKey)) { $('qcExportStatus').textContent = 'Use a separate review key. This is your main Google key'; return; }
    const project = h.project();
    project.settings.mode = 'qc';
    const report = voiceReport(project.blocks, project.settings, reviewVoices());
    if (report.some((v) => !v.available || !v.exportable)) return refreshQc();
    controller = new AbortController(); h.busy(true); $('qcExportAllowEdits').disabled = true; $('qcExportGoogle').disabled = true; $('qcGoogleKey').disabled = true;
    $('qcExportStart').disabled = true; $('qcExportStop').hidden = false; $('qcExportProgress').hidden = false;
    let sink;
    try {
      sink = await reviewSink();
      if (!sink) throw new Error('Making a QC package needs browser disk storage. Use a current Chrome or Edge browser');
      const blob = await buildReview(project, (b) => reviewAudio(h.said(b), b.speed || 1, b.voice || project.settings.ttsVoice), {
        sink, signal: controller.signal, allowEdits, handoff: true, googleReviewKey, progress: (done, total) => {
          $('qcExportProgress').value = total ? done / total : 0;
          $('qcExportStatus').textContent = `Packaging blocks: ${done} of ${total}`;
        },
      });
      if (controller.signal.aborted) throw new Error('QC export stopped');
      const prepared = await openReview(blob);
      if (controller.signal.aborted) throw new Error('QC export stopped');
      const a = document.createElement('a'), url = URL.createObjectURL(blob);
      a.href = url; a.download = h.baseName() + REVIEW_EXT; a.click();
      h.rememberReview(prepared.parsed.reviewHistory, project.projectId);
      setTimeout(() => { URL.revokeObjectURL(url); sink.clean(); }, 60000);
      $('qcExportStatus').textContent = 'QC package saved. Send it with the matching video. The video is not included.';
    } catch (e) { await sink?.clean(); $('qcExportStatus').textContent = e.message; }
    finally { controller = null; h.busy(false); $('qcExportAllowEdits').disabled = false; $('qcExportGoogle').disabled = false; $('qcGoogleKey').disabled = false; $('qcExportStop').hidden = true; $('qcExportProgress').hidden = true; refreshQc(); }
  };
}
