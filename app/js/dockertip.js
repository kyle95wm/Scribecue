// In the web version, once someone has finished setting up and seen how the editor works,
// a one-time note says Scribecue can also run on their own computer with Docker, and what
// that adds. "How to set it up" opens the install guide; either way, it doesn't come back.

const SEEN = 'scribecue.dockerTip';

// Whether to show the note now: in the web version, after setup and the first loop card,
// and only once.
export function offerDocker({ hosted, welcomed, loopSeen, seen }) {
  return hosted && welcomed && loopSeen && !seen;
}

const $ = (id) => document.getElementById(id);
const seen = () => { try { return localStorage.getItem(SEEN) !== null; } catch { return true; } };

// hooks: hosted, welcomed(), loopSeen(), guide() opens the install guide.
export function initDockerTip(hooks) {
  const d = $('dockerTip');
  d.addEventListener('close', () => { try { localStorage.setItem(SEEN, '1'); } catch { /* ignore */ } });
  $('dockerTipLater').addEventListener('click', () => d.close());
  $('dockerTipHow').addEventListener('click', () => { d.close(); hooks.guide(); });
  return () => {
    if (d.open || !offerDocker({ hosted: hooks.hosted, welcomed: hooks.welcomed(), loopSeen: hooks.loopSeen(), seen: seen() })) return;
    d.showModal();
    $('dockerTipHow').focus();
  };
}
