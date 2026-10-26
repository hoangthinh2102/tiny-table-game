'use strict';
/* ===== Tiny Tumble — game server =====
   Serves the client files and runs matches over WebSocket. The server owns the match (it runs shared/sim.js);
   clients send inputs and draw snapshots.
   - Quick play: join the first open public room; it starts when it is full or a countdown runs out.
   - Private rooms: the host gets a 4-letter code to share, friends join with it, and the host starts the match.
   Either way bots (bots.js) fill the empty seats, and players are paired into duos in join order. */
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const SIM = require('./shared/sim.js');
const { botInput, initBot } = require('./bots.js');

const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ROOM_SIZE = +process.env.ROOM_SIZE || 8;   // players per match (duos = ROOM_SIZE / 2)
const LOBBY_WAIT = +process.env.LOBBY_WAIT || 12; // seconds before bots fill the room
const MATCH_T = +process.env.MATCH_T || 0;        // seconds per match (0: the sim's default)
const SCORE_WIN = +process.env.SCORE_WIN || 0;    // points that end the match early (0: the sim's default)
const SNAP_EVERY = 2;                             // snapshot every 2 ticks (15 Hz) + events every tick
const PRIVATE_IDLE = 15 * 60;                     // seconds a private lobby may wait for its host
const C = SIM.C;

/* ---------- static files ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const ROOT = __dirname;
const server = http.createServer((req, res) => {
  let p = '/';
  try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { /* bad escape: serve the page */ }
  if (p === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (p === '/') p = '/client/index.html';
  if (!p.startsWith('/client/') && !p.startsWith('/shared/')) { res.writeHead(404); return res.end(); }
  const f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(d);
  });
});

/* ---------- rooms ---------- */
const rooms = new Set();
let nextId = 1, nextRoom = 1;
const BOT_NAMES = ['Nút Áo', 'Cuộn Len', 'Kẹp Giấy', 'Bút Sáp', 'Hạt Đậu', 'Que Kem', 'Tí Tẹo', 'Chun Chun', 'Bi Ve', 'Gấu Bông', 'Kim Chỉ', 'Lego'];

const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: easy to read out loud
function newCode() { for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += CODE_ABC[(Math.random() * CODE_ABC.length) | 0]; if (![...rooms].some((r) => r.code === c)) return c; } }
function openRoom(priv) {
  if (!priv) for (const r of rooms) if (!r.code && r.state === 'lobby' && r.clients.size < ROOM_SIZE) return r;
  const r = { id: nextRoom++, code: priv ? newCode() : '', host: 0, state: 'lobby', clients: new Map(), wait: priv ? PRIVATE_IDLE : LOBBY_WAIT, S: null, inputs: {}, timer: null, endT: 0 };
  rooms.add(r);
  // a fixed-rate clock: the tick that is due is worked out from the real time, so timer lateness (or a slow CPU) never
  // makes the match run slower than 30 ticks a second; a stalled server catches up a few ticks at a time
  const T = 1000 / C.TICK; r.t0 = performance.now(); r.ticks = 0;
  const loop = () => {
    if (!rooms.has(r)) return;
    const due = Math.floor((performance.now() - r.t0) / T);
    if (due - r.ticks > 30) r.ticks = due - 1; // more than a second behind: skip ahead rather than fast-forward
    try { for (let n = 0; r.ticks < due && n < 4 && rooms.has(r); n++) { r.ticks++; roomTick(r); } } catch (e) { console.error('room', r.id, e); closeRoom(r); return; }
    r.timer = setTimeout(loop, Math.max(1, r.t0 + (r.ticks + 1) * T - performance.now()));
  };
  r.timer = setTimeout(loop, T);
  return r;
}
function send(ws, m) { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }
function broadcast(r, m) { const s = JSON.stringify(m); for (const c of r.clients.values()) if (c.ws.readyState === 1) c.ws.send(s); }
function lobbyInfo(r) {
  broadcast(r, { t: 'lobby', room: r.id, code: r.code, host: r.host, n: r.clients.size, size: ROOM_SIZE, wait: r.code ? 0 : Math.ceil(r.wait), names: [...r.clients.values()].map((c) => [c.id, c.name]) });
}

function startMatch(r) {
  // humans first, partners next to each other in join order; bots fill the rest
  const humans = [...r.clients.values()];
  const players = [];
  let i = 0;
  for (const c of humans) { players.push(SIM.newPlayer(c.id, (i / 2) | 0, i % 2, c.name, false)); i++; }
  let b = 0;
  while (players.length < ROOM_SIZE) { players.push(SIM.newPlayer(nextId++, (i / 2) | 0, i % 2, BOT_NAMES[b++ % BOT_NAMES.length], true)); i++; }
  const seed = (Math.random() * 1e9) | 0;
  r.S = SIM.newMatch(seed, players, { matchT: MATCH_T, scoreWin: SCORE_WIN });
  r.state = 'play';
  for (const p of players) if (p.bot) initBot(p);
  broadcast(r, { t: 'start', seed, size: ROOM_SIZE, matchT: r.S.matchT, scoreWin: r.S.scoreWin, players: players.map((p) => [p.id, p.team, p.slot, p.name, p.bot ? 1 : 0]) });
}

function roomTick(r) {
  if (r.state === 'lobby') {
    if (!r.clients.size) return closeRoom(r);
    r.wait -= 1 / C.TICK;
    if (r.code) { if (r.wait <= 0) closeRoom(r); return; } // private: the host starts it
    if (r.clients.size >= ROOM_SIZE || r.wait <= 0) startMatch(r);
    else if (Math.floor(r.wait * C.TICK) % C.TICK === 0) lobbyInfo(r);
    return;
  }
  if (r.state === 'play') {
    const S = r.S;
    const inputs = {};
    for (const p of S.players) {
      if (p.bot) { inputs[p.id] = botInput(S, p); continue; }
      const c = r.clients.get(p.id);
      if (!c) { inputs[p.id] = {}; continue; }
      // every input is simulated exactly once, in order, so the client's prediction matches. A small buffer absorbs
      // network jitter; a queue that grew after a burst is worked off with one extra movement step per tick.
      if (!c.started) { if (c.queue.length < 2) { inputs[p.id] = { a: p.a }; continue; } c.started = true; }
      if (c.queue.length > 4 && p.st === 0 && !p.fly && !(p.fall > 0)) {
        const x = c.queue.shift(); S.W.mate = SIM.partnerOf(S, p); S.W.t = S.t;
        const wasFall = p.fall > 0; SIM.move(S.map, p, x, C.DT, S.W); p.seq = x.s;
        if (p.fall > 0 && !wasFall) { p.open = null; S.events.push(['fall', p.id]); }
      }
      let inp = c.queue.shift();
      if (!inp) inp = c.last || {}; // starved: keep doing what they were doing
      if (inp.s) p.seq = inp.s;
      c.last = { ...inp, j: 0 }; // a jump is a press, not a hold
      inputs[p.id] = inp;
    }
    SIM.step(S, inputs);
    const ev = S.events.splice(0);
    if (S.tick % SNAP_EVERY === 0 || ev.length) {
      const body = JSON.stringify({ t: 'snap', k: S.tick, p: SIM.encodePlayers(S), s: SIM.encodeShots(S), ...SIM.encodeWorld(S), e: ev }).slice(1);
      for (const c of r.clients.values()) { // one encoding for everyone, with each client's own ack in front
        const p = S.players.find((q) => q.id === c.id);
        if (c.ws.readyState === 1 && c.ws.bufferedAmount < 256 * 1024) c.ws.send('{"ack":' + (p ? p.seq : 0) + ',' + body);
      }
    }
    if (S.over) {
      r.state = 'end'; r.endT = 8;
      broadcast(r, { t: 'end', winner: S.winner, scores: S.score.map(Math.floor), table: S.players.map((p) => [p.id, p.team, p.place, p.kills, Math.round(p.dmg), p.deaths]) });
    }
    if (![...r.clients.values()].length) closeRoom(r);
    return;
  }
  if (r.state === 'end') { r.endT -= 1 / C.TICK; if (r.endT <= 0) closeRoom(r); }
}
function closeRoom(r) { clearTimeout(r.timer); rooms.delete(r); for (const c of r.clients.values()) { c.room = null; send(c.ws, { t: 'closed' }); } }

/* ---------- connections ---------- */
const wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on('connection', (ws) => {
  const c = { id: nextId++, ws, name: 'Người chơi', room: null, queue: [], last: null };
  send(ws, { t: 'hello', id: c.id, tick: C.TICK });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'play') { // mode: quick (default), create (a private room), join (a private room by its code)
      if (c.room) return;
      c.name = String(m.name || 'Người chơi').slice(0, 14).replace(/[<>]/g, '') || 'Người chơi';
      let r;
      if (m.mode === 'join') {
        const code = String(m.code || '').toUpperCase().trim();
        r = [...rooms].find((x) => x.code === code);
        if (!r) return send(ws, { t: 'err', msg: 'Không tìm thấy phòng ' + code });
        if (r.state !== 'lobby') return send(ws, { t: 'err', msg: 'Phòng ' + code + ' đang chơi rồi' });
        if (r.clients.size >= ROOM_SIZE) return send(ws, { t: 'err', msg: 'Phòng ' + code + ' đã đủ người' });
      } else r = openRoom(m.mode === 'create');
      if (r.code && !r.host) r.host = c.id;
      c.room = r; r.clients.set(c.id, c); c.queue = []; c.started = false; c.last = null; lobbyInfo(r);
    } else if (m.t === 'start' && c.room && c.room.code && c.room.host === c.id && c.room.state === 'lobby') startMatch(c.room);
    else if (m.t === 'in' && c.room && c.room.state === 'play') {
      // input: s seq, mx my (-1..1), a angle, f fire (held), j jump (pressed), i interact (held), v the tick on screen
      const inp = { s: m.s | 0, mx: clampN(m.mx), my: clampN(m.my), a: +m.a || 0, f: m.f ? 1 : 0, j: m.j ? 1 : 0, i: m.i ? 1 : 0, v: m.v | 0 };
      c.queue.push(inp); if (c.queue.length > 20) c.queue.shift(); // way behind (a stalled tab): drop the oldest
    } else if (m.t === 'leave') leave(c);
    else if (m.t === 'ping') send(ws, { t: 'pong', c: m.c });
  });
  ws.on('close', () => leave(c));
});
const clampN = (v) => Math.max(-1, Math.min(1, +v || 0));
function leave(c) {
  const r = c.room; if (!r) return;
  r.clients.delete(c.id); c.room = null;
  if (r.state === 'play') { const p = r.S.players.find((q) => q.id === c.id); if (p) { p.bot = true; initBot(p); } } // a bot takes over
  else if (r.state === 'lobby') {
    if (r.host === c.id) r.host = r.clients.size ? r.clients.keys().next().value : 0; // the next in line hosts
    lobbyInfo(r);
  }
}

server.listen(PORT, HOST, () => console.log(`Tiny Tumble: http://localhost:${PORT}  (room size ${ROOM_SIZE})`));
