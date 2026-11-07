// Offline support for the web version of Scribecue. It keeps a copy of the app's own
// files, so once it's been opened it works without a connection. Piper voices people
// download are kept apart, in the "piper-voices" cache, and Whisper in "whisper-model", so new versions don't clear them. Video, audio and
// scripts never pass through here: they're opened straight from disk.
// The cache is named after the version, so a new release brings a new copy, and the app
// asks to reload when it's ready. Keep VERSION in step with app/js/update.js.
const VERSION = '0.88.0';
const CACHE = `scribecue-${VERSION}`;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'changelog.json', 'css/style.css',
  'js/newproject.js', 'js/qc.js', 'js/qcspeech.js', 'js/qcdrawer.js', 'js/qcplayer.js', 'js/extended.js', 'js/qc-worker.js', 'js/comments.js', 'js/commentsdrawer.js', 'js/profile.js', 'js/ai.js', 'js/aidrawer.js', 'js/app.js', 'js/browser.js', 'js/nav.js', 'js/tour.js', 'js/keymap.js', 'js/keys.js', 'js/settings.js', 'js/whatsnew.js', 'js/config.js', 'js/formats.js', 'js/polly.js', 'js/piper-engine.js', 'js/piper-worker.js',
  'js/qcreviewdrawer.js', 'js/qcpending.js', 'js/qcreview.js', 'js/collaboration.js', 'js/collaboration-worker.js', 'js/project.js', 'js/recording.js', 'js/bwf.js', 'js/record.js', 'js/levelmeter.js', 'js/takestore.js', 'js/session.js', 'js/pickers.js', 'js/diagnostics.js', 'js/zip.js', 'js/rec-worklet.js', 'js/old.js', 'js/tmdb.js', 'js/findreplace.js', 'js/guide.js', 'js/offline.js', 'js/autosave.js', 'js/reminder.js', 'js/dockertip.js', 'js/wavestore.js', 'js/spelling.js', 'js/proofing.js', 'js/proofing-worker.js', 'js/proofdialog.js', 'js/stt.js', 'js/tts.js', 'js/whisper-worker.js',
  'js/update.js', 'js/welcome.js', 'js/wave-worker.js', 'js/dialogue.js', 'js/mp3.js', 'js/mp3-worker.js', 'js/mix-worker.js', 'js/audio.js', 'js/track-worker.js', 'js/ffcmd.js', 'js/codecs.js', 'vendor/lame.min.js', 'vendor/ac3.js', 'vendor/nspell.js',
  'vendor/dictionaries/en-us.aff', 'vendor/dictionaries/en-us.dic', 'vendor/dictionaries/en-gb.aff', 'vendor/dictionaries/en-gb.dic', 'vendor/dictionaries/en-ca.aff', 'vendor/dictionaries/en-ca.dic',
  'icons/icon-192.png', 'icons/icon-512.png',
];

// The guides and their screenshots, copied next to the app when it's built (see
// .github/workflows/pages.yml). Kept too if they're there, but the app works without them.
const GUIDES = [
  'guides/README.md',
  'guides/GETTING-STARTED.md',
  'guides/WRITING.md',
  'guides/VOICES.md',
  'guides/SHORTCUTS.md',
  'guides/TRANSCRIBING.md',
  'guides/RECORDING.md',
  'guides/QC.md',
  'guides/AI.md',
  'guides/GOOGLE-VOICES.md',
  'guides/POLLY-VOICES.md',
  'guides/INSTALL.md',
  'guides/TROUBLESHOOTING.md',
  'guides/docs/screenshots/ai-help.png',
  'guides/docs/screenshots/comments.png',
  'guides/docs/screenshots/qc-playback.png',
  'guides/docs/screenshots/qc-editing.png',
  'guides/docs/screenshots/qc-new-project.png',
  'guides/docs/screenshots/qc-package.png',
  'guides/docs/screenshots/recording.png',
  'guides/docs/screenshots/recording-menu.png',
  'guides/docs/screenshots/recording-export.png',
  'guides/docs/screenshots/recording-pickups.png',
  'guides/docs/screenshots/pickup-mark.png',
  'guides/docs/screenshots/check-pickups.png',
  'guides/docs/screenshots/check-mismatch.png',
  'guides/docs/screenshots/hold-to-mark.png',
  'guides/docs/screenshots/import-timings.png',
  'guides/docs/screenshots/main.png',
  'guides/docs/screenshots/qc-compare.png',
  'guides/docs/screenshots/qc-accept.png',
  'guides/docs/screenshots/qc-authoring.png',
  'guides/docs/screenshots/qc-google-rewrite.png',
  'guides/docs/screenshots/qc-google-package.png',
  'guides/docs/screenshots/piper-tip.png',
  'guides/docs/screenshots/settings.png',
  'guides/docs/screenshots/shortcuts.png',
  'guides/docs/screenshots/sounds-like.png',
  'guides/docs/screenshots/text-to-speech.png',
  'guides/docs/voices/lessac.mp3',
  'guides/docs/voices/ryan.mp3',
  'guides/docs/voices/alba.mp3',
  'guides/docs/voices/alan.mp3',
  'guides/docs/voices/kokoro-heart.mp3',
  'guides/docs/voices/kokoro-liam.mp3',
  'guides/docs/voices/kokoro-alice.mp3',
  'guides/docs/voices/kokoro-lewis.mp3',
];

// Straight from the site, never the browser's own cache: GitHub Pages lets browsers keep
// files for 10 minutes, so a release soon after a visit would otherwise keep the old
// version's files under the new version's name, until the next release.
const fresh = (f) => new Request(f, { cache: 'reload' });
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(FILES.map(fresh));
    await Promise.allSettled(GUIDES.map((f) => c.add(fresh(f))));
  }));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('scribecue-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The page asks for this when you choose to reload into a new version.
self.addEventListener('message', (e) => { if (e.data === 'update') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/tts/') || url.pathname.includes('/stt/') ||
    url.pathname.includes('/ffmpeg/')) return; // the containers' answers, and big files to and from ffmpeg
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true }) ||
      (e.request.mode === 'navigate' ? await caches.match('index.html') : null);
    return hit || fetch(e.request);
  })());
});
