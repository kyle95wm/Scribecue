// Scribecue's relay, as a Cloudflare Worker. Each shared project is a room: a Durable Object
// that keeps its encrypted changes and passes them between the people in it. The rules are
// in room.js. Sockets sleep between messages (WebSocket hibernation), so an open project
// with nobody typing costs nothing.
import { DurableObject } from 'cloudflare:workers';
import { Room, validRoom, takeSlot, NEW_ROOMS } from './room.js';

const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
// Browsers send the page's origin: only Scribecue's own pages may connect. Other programs
// send none; they can't be stopped this way, and get no further without a link anyway.
// Each address may open so many connections a minute (CONNECTS in wrangler.toml), counted
// roughly by Cloudflare where it connects. New projects are counted exactly, by a limiter
// object for each address (LIMITER), since each project is its own room object. A limit that
// fails lets the request through, and says why in the Worker's log.
const allowed = (origin, env) => !origin || local.test(origin) || String(env.ORIGINS || '').split(',').map((s) => s.trim()).includes(origin);
const address = (request) => request.headers.get('CF-Connecting-IP') || 'unknown';
const under = async (limiter, key) => {
  if (!limiter) return true;
  try { return (await limiter.limit({ key })).success; } catch (e) { console.error('connection limit failed:', e?.message || e); return true; }
};
async function newRoomAllowed(env, address) {
  if (!env.LIMITER) return true;
  try { return await env.LIMITER.get(env.LIMITER.idFromName('new-room:' + address)).take(NEW_ROOMS.limit, NEW_ROOMS.period); } catch (e) { console.error('new project limit failed:', e?.message || e); return true; }
}
const text = (body, status) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') return text('Scribecue relay\n', 200);
    const m = url.pathname.match(/^\/rooms\/([^/]+)$/);
    if (!m || !validRoom(m[1])) return text('Not found\n', 404);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return text('Connect with a WebSocket\n', 426);
    if (!allowed(request.headers.get('Origin'), env)) return text('Not allowed from this site\n', 403);
    if (!(await under(env.CONNECTS, address(request)))) return text('Too many connections. Try again in a minute\n', 429);
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(request);
  },
};

export class RoomObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.wrapped = new WeakMap();
    this.rooms = new Map();
  }

  // Each socket remembers its room's id and what room.js keeps about it, across sleeps.
  wrap(ws) {
    if (!this.wrapped.has(ws)) {
      this.wrapped.set(ws, {
        send: (t) => ws.send(t),
        close: (code, reason) => ws.close(code, reason),
        get address() { return ws.deserializeAttachment()?.address || 'unknown'; },
        get state() { return ws.deserializeAttachment()?.r || {}; },
        set state(r) { ws.serializeAttachment({ ...ws.deserializeAttachment(), r }); },
      });
    }
    return this.wrapped.get(ws);
  }
  room(id) {
    if (!this.rooms.has(id)) {
      this.rooms.set(id, new Room({
        id,
        storage: this.ctx.storage,
        sockets: () => this.ctx.getWebSockets().map((ws) => this.wrap(ws)),
        mayCreate: (socket) => newRoomAllowed(this.env, socket.address),
      }));
    }
    return this.rooms.get(id);
  }

  async fetch(request) {
    const id = new URL(request.url).pathname.split('/').pop();
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, r: {}, address: address(request) });
    this.room(id).open(this.wrap(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const { id } = ws.deserializeAttachment() || {};
    if (typeof message !== 'string' || !validRoom(id)) { ws.close(4000, 'bad-message'); return; }
    await this.room(id).message(this.wrap(ws), message);
  }

  // A connection closed: answer it, then tell the others in its room it's gone.
  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, 'closed'); } catch { /* already closed */ }
    this.gone(ws);
  }
  async webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    try {
      const { id } = ws.deserializeAttachment() || {};
      if (validRoom(id)) this.room(id).close(this.wrap(ws));
    } catch (e) { console.error('saying a connection went failed:', e?.message || e); }
  }

  async alarm() {
    // Deleting needs no id: any room object here will do.
    await new Room({ id: null, storage: this.ctx.storage, sockets: () => [] }).alarm();
  }
}

// Counts what one address does, such as making projects, in a window that slides. It forgets
// the address once the window has passed.
export class LimiterObject extends DurableObject {
  async take(limit, period) {
    const now = Date.now();
    const { ok, times } = takeSlot(await this.ctx.storage.get('times'), now, limit, period);
    await this.ctx.storage.put('times', times);
    await this.ctx.storage.setAlarm(now + period);
    return ok;
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}
