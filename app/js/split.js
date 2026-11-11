// The bar between the block list and the video. Dragging it sets how wide the list is, as a
// share of the space, so it holds when the window changes size. null is the usual width; 0
// hides the list and gives the video the whole space.

export const LIST_MIN = 340; // px: let go narrower than this and the list hides
export const VIDEO_MIN = 440; // px always left for the video and the controls under it
export const SNAP = 16; // px: this close to the usual width, it snaps back to it
export const STEP = 0.05; // share moved by one arrow key

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The usual width, as the CSS has it: 38% of the space, but at least 380 px.
export const usualWidth = (total) => Math.min(Math.max(380, total * 0.38), Math.max(0, total - VIDEO_MIN));

// The list's width in pixels for a share.
export function widthOf(share, total) {
  if (share === null || share === undefined) return usualWidth(total);
  if (share <= 0) return 0;
  return clamp(share * total, Math.min(LIST_MIN, total - VIDEO_MIN), Math.max(0, total - VIDEO_MIN));
}

// The share for a list dragged to `px` wide, out of `total`.
export function shareFor(px, total) {
  if (!(total > 0)) return null;
  if (Math.abs(px - usualWidth(total)) <= SNAP) return null;
  if (px < LIST_MIN) return 0;
  return clamp(px, LIST_MIN, total - VIDEO_MIN) / total;
}

// One arrow key from `share`: dir is +1 for a wider list, −1 for a narrower one.
export function stepShare(share, dir, total) {
  if (!(total > 0)) return share;
  const now = widthOf(share, total);
  if (dir < 0 && now <= LIST_MIN + 0.5) return 0;
  if (dir > 0 && now === 0) return shareFor(Math.min(LIST_MIN, total - VIDEO_MIN), total) ?? null;
  const next = now + dir * STEP * total;
  // Passing the usual width stops there first.
  const usual = usualWidth(total);
  if ((now < usual && next > usual) || (now > usual && next < usual)) return null;
  return shareFor(next, total);
}

// A stored share, or null for the usual width when it's missing or doesn't make sense.
export function readShare(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v < 1 ? v : null;
}
