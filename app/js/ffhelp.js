// Help for people without ffmpeg, under each ffmpeg command Scribecue shows: how to install
// it on their system, how to open a terminal in the right folder, and that Docker can do it
// for them instead.

// The system, from navigator.userAgentData.platform or navigator.platform. null if unknown.
export function systemOf(platform = '') {
  if (/^win/i.test(platform)) return 'windows';
  if (/^mac/i.test(platform)) return 'mac';
  if (/linux|x11|freebsd/i.test(platform) && !/android/i.test(platform)) return 'linux';
  return null;
}

export const SYSTEMS = {
  windows: {
    name: 'Windows',
    install: 'winget install --id Gyan.FFmpeg -e',
    after: 'Then close the terminal and open a new one, so it finds ffmpeg.',
    terminal: 'To open a terminal in a folder: open the folder in File Explorer, right-click an empty space and choose Open in Terminal.',
  },
  mac: {
    name: 'Mac',
    install: 'brew install ffmpeg',
    after: 'This needs Homebrew, from brew.sh.',
    terminal: 'To open a terminal in a folder: right-click the folder in Finder and choose New Terminal at Folder.',
  },
  linux: {
    name: 'Linux',
    install: 'sudo apt install ffmpeg',
    after: 'Or use your system’s own package manager.',
    terminal: 'To open a terminal in a folder: right-click the folder in your file manager and choose Open in Terminal.',
  },
};

// The systems to show: this one, or all of them when it isn't known.
export const systemsFor = (platform) => (systemOf(platform) ? [systemOf(platform)] : Object.keys(SYSTEMS));

// One sentence on installing ffmpeg, for a message that can't hold the full help.
export function installSentence(platform) {
  const s = SYSTEMS[systemOf(platform)];
  return s ? `To install ffmpeg on ${s.name}, run ${s.install} in a terminal.` : 'To install ffmpeg, see ffmpeg.org.';
}

// Where Docker comes in: the web version can't run ffmpeg, a copy in Docker can.
export const dockerLine = (hosted) => (hosted
  ? 'Or run Scribecue in Docker with ffmpeg, which makes the file for you.'
  : 'Or add ffmpeg to Scribecue in Docker, which makes the file for you.');

// Adds "Don't have ffmpeg?" to every .ffcmds box. hooks: platform, hosted, copy(text),
// guide() opens the ffmpeg part of the install guide.
export function initFfHelp(hooks) {
  for (const box of document.querySelectorAll('.ffcmds')) {
    const d = document.createElement('details');
    d.className = 'ffhelp';
    const el = (tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
    d.append(el('summary', 'Don’t have ffmpeg?'),
      el('p', 'Install it once, in a terminal. The files you saved are probably in Downloads: move them to the folder with the video.', 'small'));
    for (const key of systemsFor(hooks.platform)) {
      const s = SYSTEMS[key];
      const copy = el('button', 'Copy');
      copy.addEventListener('click', () => hooks.copy(s.install));
      const head = el('p', '', 'ffcmdhead');
      head.append(el('span', `Install on ${s.name}`), copy);
      d.append(head, el('pre', s.install), el('p', s.after, 'dim small'), el('p', s.terminal, 'dim small'));
    }
    const docker = el('p', `${dockerLine(hooks.hosted)} `, 'dim small');
    const how = el('a', 'How to set it up');
    how.href = '#';
    how.addEventListener('click', (e) => { e.preventDefault(); hooks.guide(); });
    docker.append(how);
    d.append(docker);
    box.append(d);
  }
}
