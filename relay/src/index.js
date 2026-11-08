// Scribecue's relay, as a Cloudflare Worker. Each shared project is a room: a Durable Object
// that keeps its encrypted changes and passes them between the people in it. The rules are
// in room.js. Sockets sleep between messages (WebSocket hibernation), so an open project
// with nobody typing costs nothing.
import { DurableObject } from 'cloudflare:workers';
import { Room, validRoom } from './room.js';

const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
// Browsers send the page's origin: only Scribecue's own pages may connect. Other programs
// send none; they can't be stopped this way, and get no further without a link anyway.
// Each address may open so many connections, and make so many new projects, a minute
// (CONNECTS and NEW_ROOMS in wrangler.toml). Without those bindings there's no limit.
const allowed = (origin, env) => !origin || local.test(origin) || String(env.ORIGINS || '').split(',').map((s) => s.trim()).includes(origin);
const address = (request) => request.headers.get('CF-Connecting-IP') || 'unknown';
const under = async (limiter, key) => { try { return !limiter || (await limiter.limit({ key })).success; } catch { return true; } };
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
        mayCreate: (socket) => under(this.env.NEW_ROOMS, socket.address),
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

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, 'closed'); } catch { /* already closed */ }
  }

  async alarm() {
    // Deleting needs no id: any room object here will do.
    await new Room({ id: null, storage: this.ctx.storage, sockets: () => [] }).alarm();
  }
}
