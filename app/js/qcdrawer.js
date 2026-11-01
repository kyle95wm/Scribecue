import { buildReview, hasReviewText, reviewReading, reviewSink, voiceReport, REVIEW_EXT } from './qc.js';
import { reviewVoices, reviewAudio, voiceLabel, chosenVoice, usingGoogle } from './tts.js';
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
      row.textContent = `${v.id ? voiceLabel(v.id) : 'No voice chosen'} · blocks ${v.blocks.slice(0, 12).join(', ')}${v.blocks.length > 12 ? '…' : ''}: ${!v.available ? 'not available here' : !v.exportable ? 'playback only; cannot package audio' : 'available for playback and packaging'}`;
      list.append(row);
    }
  }
  const review = h.review(), spoken = p.blocks.filter((b) => hasReviewText(b, p.settings));
  const valid = spoken.filter((b) => reviewReading(review, b, p.settings)).length;
  $('qcPackageInfo').textContent = review ? `${valid} of ${spoken.length} blocks have matching original readings. ${valid < spoken.length ? 'Missing or changed readings need a new package from the writer. They will not be replaced automatically.' : 'The included audio plays without installing these voices or adding a key.'}` : 'No original readings are included. Use the programme sound, ask for a QC package, or explicitly choose an approximate TTS preview.';
  for (const [id, source] of [['qcSourceVideo', 'video'], ['qcSourcePackage', 'package'], ['qcSourcePreview', 'preview']]) {
    $(id).setAttribute('aria-pressed', String(h.source() === source));
  }
  $('qcSourcePackage').disabled = !review;
  const select = $('qcPreviewVoice'), selected = select.value;
  select.replaceChildren(...reviewVoices().map((v) => new Option(v.name, v.id)));
  select.value = reviewVoices().some((v) => v.id === selected) ? selected : chosenVoice();
  $('qcSourcePreview').disabled = !select.options.length;
  $('qcPreviewNote').textContent = 'Approximate preview: missing voices use the voice selected below. Automatic timing changes stay off. This is not the writer’s original reading. Online voices send text to their provider.';
  if (!controller) $('qcExportStart').disabled = !spoken.length || report.some((v) => !v.available || !v.exportable);
  $('qcExportCost').hidden = !report.some((v) => usingGoogle(v.id));
}
export function openQcPlayback() { if (!h.qc()) return; refreshQc(); $('qcPlaybackDlg').showModal(); refreshQc(); }
export function openQcExport() { $('qcExportStatus').textContent = ''; $('qcExportDlg').showModal(); refreshQc(); }
export function initQc(hooks) {
  h = hooks;
  for (const [id, source] of [['qcSourceVideo', 'video'], ['qcSourcePackage', 'package'], ['qcSourcePreview', 'preview']]) {
    $(id).onclick = () => { h.setSource(source, $('qcPreviewVoice').value); refreshQc(); };
  }
  $('qcPreviewVoice').onchange = () => { if (h.source() === 'preview') h.setSource('preview', $('qcPreviewVoice').value); };
  $('qcPlaybackClose').onclick = () => $('qcPlaybackDlg').close();
  $('qcExportClose').onclick = () => { controller?.abort(); $('qcExportDlg').close(); };
  $('qcExportStop').onclick = () => controller?.abort();
  $('qcExportDlg').addEventListener('cancel', () => controller?.abort());
  for (const id of ['qcPlaybackDlg', 'qcExportDlg']) document.addEventListener('keydown', (e) => { if ($(id).open) e.stopPropagation(); }, true);
  $('qcExportStart').onclick = async () => {
    if (controller) return;
    const project = h.project();
    project.settings.mode = 'qc';
    const report = voiceReport(project.blocks, project.settings, reviewVoices());
    if (report.some((v) => !v.available || !v.exportable)) return refreshQc();
    controller = new AbortController(); h.busy(true);
    $('qcExportStart').disabled = true; $('qcExportStop').hidden = false; $('qcExportProgress').hidden = false;
    let sink;
    try {
      sink = await reviewSink();
      if (!sink) throw new Error('Making a QC package needs browser disk storage. Use a current Chrome or Edge browser');
      const blob = await buildReview(project, (b) => reviewAudio(h.said(b), b.speed || 1, b.voice || project.settings.ttsVoice), {
        sink, signal: controller.signal, progress: (done, total) => {
          $('qcExportProgress').value = total ? done / total : 0;
          $('qcExportStatus').textContent = `Making readings: ${done} of ${total}`;
        },
      });
      if (controller.signal.aborted) throw new Error('QC export stopped');
      const a = document.createElement('a'), url = URL.createObjectURL(blob);
      a.href = url; a.download = h.baseName() + REVIEW_EXT; a.click();
      setTimeout(() => { URL.revokeObjectURL(url); sink.clean(); }, 60000);
      $('qcExportStatus').textContent = 'QC package saved. Send it with the matching video. The video is not included.';
    } catch (e) { await sink?.clean(); $('qcExportStatus').textContent = e.message; }
    finally { controller = null; h.busy(false); $('qcExportStop').hidden = true; $('qcExportProgress').hidden = true; refreshQc(); }
  };
}
