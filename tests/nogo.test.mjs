import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonesAllowed, zonesShown, cleanZones, zoneAt, inZone, zoneLimits, parseSegments, zonesFromSegments, blocksInZones } from '../app/js/nogo.js';

// A made-up list in the layout one broadcaster sends, as pasted, with segment 3 there four
// times.
const LIST = `Seg 1
IN: 00:00:00:00
(Description can come in after 00:00:02:00)
OUT: 00:12:30:10
(Description must conclude by 00:12:29:15)

Seg 2
IN: 00:12:31:00
(Description can come in after 00:12:32:00)
OUT: 00:24:05:12
(Description must conclude by 00:24:04:20)
${`
Seg 3
IN: 00:24:06:00
(Description can come in after 00:24:07:00)
OUT: 00:38:50:08
(Description must conclude by 00:38:49:10)
`.repeat(4)}
Seg 4
IN: 00:38:51:00
(Description can come in after 00:38:52:00)
OUT: 00:51:15:00
(Description must conclude by 00:51:14:05)`;

const tc = (h, m, s, f) => ((h * 60 + m) * 60 + s) + f / 25;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('a segment list reads as windows, without the repeats', () => {
  const { segments, skipped } = parseSegments(LIST, 25);
  assert.equal(skipped, 0);
  assert.deepEqual(segments.map((s) => s.name), ['Seg 1', 'Seg 2', 'Seg 3', 'Seg 4']);
  near(segments[0].start, 2);
  near(segments[0].end, tc(0, 12, 29, 15));
  near(segments[3].start, tc(0, 38, 52, 0));
  near(segments[3].end, tc(0, 51, 14, 5));
});

test('the zones are everything outside the windows', () => {
  const { segments } = parseSegments(LIST, 25);
  const z = zonesFromSegments(segments, tc(0, 51, 20, 0));
  assert.deepEqual(z.map((x) => x.label), ['Before Seg 1', 'Between Seg 1 and Seg 2', 'Between Seg 2 and Seg 3', 'Between Seg 3 and Seg 4', 'After Seg 4']);
  near(z[0].start, 0); near(z[0].end, 2);
  near(z[1].start, tc(0, 12, 29, 15)); near(z[1].end, tc(0, 12, 32, 0));
  near(z[4].start, tc(0, 51, 14, 5)); near(z[4].end, tc(0, 51, 20, 0));
  // Without the video's length, the last OUT ends the tail.
  near(zonesFromSegments(segments, 0)[4].end, tc(0, 51, 15, 0));
});

test('a list with only IN and OUT, and no names, still reads', () => {
  const { segments } = parseSegments('IN 00:00:10:00\nOUT 00:01:00:00\nIN 00:01:30:00\nOUT 00:02:00:00', 25);
  assert.deepEqual(segments.map((s) => [s.name, s.start, s.end]), [['Segment 1', 10, 60], ['Segment 2', 90, 120]]);
  assert.deepEqual(zonesFromSegments(segments, 0).map((z) => [z.start, z.end]), [[0, 10], [60, 90]]);
});

test('nothing to read gives no segments', () => {
  assert.deepEqual(parseSegments('hello\nthere', 25).segments, []);
  assert.deepEqual(zonesFromSegments([], 100), []);
  assert.equal(parseSegments('IN: 00:00:99:00', 25).skipped, 1);
});

test('zones are cleaned and sorted', () => {
  const z = cleanZones([{ start: 10, end: 20, label: ' B ' }, { start: 1, end: 2 }, { start: 5, end: 5 }, null, { start: -1, end: 3 }]);
  assert.equal(z.length, 2);
  assert.deepEqual(z.map((x) => [x.start, x.label]), [[1, ''], [10, 'B']]);
});

test('blocks stop at the edges of zones', () => {
  const zones = cleanZones([{ start: 10, end: 20 }, { start: 30, end: 40 }]);
  assert.deepEqual(zoneLimits(zones, 22, 25), { lo: 20, hi: 30 });
  assert.deepEqual(zoneLimits(zones, 0, 5), { lo: -Infinity, hi: 10 });
  // A block already inside one isn't held by it.
  assert.deepEqual(zoneLimits(zones, 15, 25), { lo: -Infinity, hi: 30 });
  assert.equal(zoneAt(zones, 15).start, 10);
  assert.equal(zoneAt(zones, 10), null); // the edge is outside
  assert.ok(inZone(zones, 8, 11));
  assert.ok(!inZone(zones, 20, 30));
  assert.equal(blocksInZones([{ start: 8, end: 11 }, { start: 21, end: 25 }, { start: 39, end: 45 }], zones), 2);
});

test('a project keeps its no-go zones', async () => {
  const { toProject, fromProject } = await import('../app/js/project.js');
  const zones = cleanZones([{ start: 0, end: 2, label: 'Before Seg 1' }, { start: 749.6, end: 752, label: 'Between Seg 1 and Seg 2' }]);
  const back = fromProject(JSON.parse(JSON.stringify(toProject({ blocks: [], zones }))));
  assert.deepEqual(back.zones, zones);
  assert.equal('zones' in toProject({ blocks: [] }), false);
});

test('QC shows the zones but only Write and Transcribe change them', () => {
  for (const m of ['write', 'transcribe']) { assert.ok(zonesAllowed(m)); assert.ok(zonesShown(m)); }
  assert.ok(zonesShown('qc'));
  assert.ok(!zonesAllowed('qc'));
  assert.ok(!zonesShown('record'));
  assert.ok(!zonesAllowed('record'));
});

const zid = (n) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);
const zone = (n, start, end, label = '') => ({ id: zid(n), start, end, label });

test('a QC package keeps the no-go zones', async () => {
  const { buildReview, readReview } = await import('../app/js/qc.js');
  const { toProject, fromProject } = await import('../app/js/project.js');
  const zones = [zone(1, 10, 20, 'Break 1')];
  const p = toProject({ blocks: [{ start: 3, end: 6, text: 'Mara arrives.' }], zones, settings: { mode: 'write', ttsBase: 1, ttsVoice: 'kokoro:bf_emma' } });
  const make = async (b) => ({ blob: new Blob([new Uint8Array(100)], { type: 'audio/wav' }), secs: b.end - b.start, voice: 'kokoro:bf_emma' });
  const r = await readReview(await buildReview(p, make));
  assert.deepEqual(fromProject(r.project).zones, zones);
});

test('no-go zones reach the other people on a share link, with the script', async () => {
  const { SharedProject } = await import('../app/js/shared.js');
  const a = new SharedProject(), b = new SharedProject(), seen = [];
  a.onUpdate((doc, u, origin) => { if (origin !== 'remote') b.apply(doc, u); });
  b.onUpdate((doc, u, origin) => { if (origin !== 'remote') a.apply(doc, u); });
  b.observe((uids, timeline, suggestions, marks) => seen.push(!!marks));
  const list = [zone(2, 30, 40, 'Break 2'), zone(1, 10, 20, 'Break 1')];
  a.write([], [], null, { zones: list });
  assert.deepEqual(b.readZones(), [list[1], list[0]], 'in time order');
  assert.deepEqual(b.read().zones, [list[1], list[0]]);
  assert.deepEqual(seen, [true]);
  assert.equal(a.write([], [], null, { zones: list }), 0, 'writing them again changes nothing');
  a.write([], [], null, { zones: [{ ...list[1], end: 25 }] });
  assert.deepEqual(b.readZones(), [{ ...list[1], end: 25 }]);
  // Those who can't edit the script don't change them.
  b.write([], [], null, { script: false, zones: [] });
  assert.equal(a.readZones().length, 1);
  // Undo takes back one's own change.
  const undo = a.undoer(), mark0 = undo.step();
  a.write([], [], null, { zones: [] });
  undo.undoTo(mark0);
  assert.equal(a.readZones().length, 1);
});

test('no-go zones changed in two copies merge one by one', async () => {
  const { mergeProjects } = await import('../app/js/collaboration.js');
  const { toProject, newIdentity } = await import('../app/js/project.js');
  const base = toProject({ projectId: newIdentity(), blocks: [{ uid: newIdentity(), start: 1, end: 2, text: 'First' }], zones: [zone(1, 10, 20, 'Break')], settings: {} });
  const local = structuredClone(base), remote = structuredClone(base);
  local.zones.push(zone(2, 5, 8, 'Opening'));
  remote.zones[0].label = 'Break 1';
  const result = mergeProjects(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.project.zones.map((z) => z.label), ['Opening', 'Break 1']);
});
