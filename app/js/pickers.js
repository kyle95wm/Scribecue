// What each file picker offers, in one place, so scripts/picker-check.mjs can ask Chrome
// whether it accepts them. Chrome refuses some types outright, such as an extension longer
// than 16 characters or with a hyphen, and then the picker never opens: 0.77.0's Open did.
import { PROJECT_EXT } from './project.js';
import { REVIEW_EXT } from './qc.js';
import { RECORDING_EXT } from './recording.js';
import { SESSION_EXT } from './session.js';

const VIDEO = { 'video/*': ['.mp4', '.m4v', '.mov', '.mkv', '.webm'], 'audio/*': ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus'] };

export const PICKERS = {
  // Open: a project, a script, a video or audio file, or several at once.
  open: { kind: 'open', multiple: true, types: [{ description: 'Scribecue project, script, video or audio', accept: {
    'application/json': [PROJECT_EXT, REVIEW_EXT, RECORDING_EXT], 'application/zip': [SESSION_EXT], 'text/plain': ['.srt', '.vtt', '.txt', '.adc'], ...VIDEO,
  } }] },
  video: { kind: 'open', types: [{ description: 'Video or audio', accept: VIDEO }] },
  project: { kind: 'save', types: [{ description: 'Scribecue project', accept: { 'application/json': [PROJECT_EXT, REVIEW_EXT] } }] },
  authorProject: { kind: 'save', types: [{ description: 'Scribecue project', accept: { 'application/json': [PROJECT_EXT] } }] },
  qcPackage: { kind: 'save', types: [{ description: 'QC package', accept: { 'application/octet-stream': [REVIEW_EXT] } }] },
  session: { kind: 'save', id: 'scribecue-session', types: [{ description: 'Scribecue recording session', accept: { 'application/zip': [SESSION_EXT] } }] },
  folder: { kind: 'folder', id: 'scribecue-session', mode: 'readwrite', startIn: 'documents' },
};

const FN = { open: 'showOpenFilePicker', save: 'showSaveFilePicker', folder: 'showDirectoryPicker' };

// Opens the picker named, with any extra options, such as suggestedName.
export function picker(name, extra = {}) {
  const { kind, ...opts } = PICKERS[name];
  return window[FN[kind]]({ ...opts, ...extra });
}

// Whether a picker failed because Chrome refused its options, rather than being cancelled
// or blocked. Chrome checks them before it uses up the click, so a plain file input can
// still open in its place.
export const refused = (e) => e?.name === 'TypeError';
