'use strict';
/* ===== Tiny Tumble — client =====
   The server owns the match; this file sends inputs (30 per second), predicts the local player's movement with the
   shared sim (jumps, towers, lids, drawers, trains, fans, bridges and gates included), draws everyone else 120 ms in
   the past from buffered snapshots, and paints the desk with PixiJS. Things that move by the clock (lids, drawers,
   trains, pencils, the marble, crumbling tiles) are drawn from the shared sim at the predicted time. */
const C = SIM.C, $ = (id) => document.getElementById(id);
const store = { get: (k, d) => { try { return localStorage.getItem('dbth.' + k) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem('dbth.' + k, v); } catch (e) { /* private mode */ } } };
const TOUCH = matchMedia('(pointer: coarse)').matches;
if (TOUCH) document.documentElement.classList.add('touchui');
const TEAM_NAMES = ['Cam', 'Ngọc', 'Vàng', 'Tím', 'Lam', 'Hồng', 'Lá', 'Nâu'];
const teamName = (t) => 'Đội ' + TEAM_NAMES[t % 8];
const teamCol = (t) => ART.PAL.team[t % 8];
const KEY_USE = TOUCH ? 'nút Dùng' : 'F', KEY_JUMP = TOUCH ? 'nút Nhảy' : 'Space';
const LIFT = 0.55; // screen pixels per unit of height

const G = {
  app: null, ws: null, myId: 0, state: 'menu', map: null, size: 8, teams: 4, info: new Map(), // id -> { team, slot, name, bot }
  snaps: [], off: null, last: null, pend: [], seq: 0, me: null, prev: null, vis: { x: 0, y: 0, z: 0 }, acc: 0, predT: 0,
  W: { t: 0, on: new Set(), mate: null }, items: [], bt: new Map(), sl: new Map(),
  views: new Map(), drawn: new Map(), shots: new Map(), itemViews: new Map(), cam: { x: 0, y: 0, z: 1 },
  dust: [], rays: [], floats: [], puffs: [],
};
let DELAY = 0.12; // interpolation delay (s): grows with the network's jitter (see onSnap)
const SNAP_GAP = 2 / C.TICK; // the server sends a snapshot every other tick

/* ---------- audio: a few soft synth sounds ---------- */
const SFX = {
  ctx: null,
  init() { if (this.ctx) return; try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.out = this.ctx.createGain(); this.out.gain.value = 0.5; this.out.connect(this.ctx.destination); } catch (e) { /* no audio */ } },
  tone(f0, f1, dur, type = 'sine', vol = 0.2, delay = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, f, vol = 0.2) {
    if (!this.ctx) return; const t = this.ctx.currentTime, n = this.ctx.sampleRate * dur, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource(), fl = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = b; fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = 0.8; g.gain.value = vol; s.connect(fl); fl.connect(g); g.connect(this.out); s.start(t);
  },
  near(x, y) { const d = Math.hypot(x - G.vis.x, y - G.vis.y); return Math.max(0, 1 - d / 1200); },
  shot(x, y, w) { const k = this.near(x, y); if (k < 0.05) return; if (w === 2 || w === 5) this.noise(0.1, w === 5 ? 500 : 1200, 0.14 * k); else if (w === 6) this.tone(300, 120, 0.12, 'square', 0.1 * k); else this.tone(w === 3 ? 900 : 620, w === 3 ? 200 : 260, 0.09, 'triangle', 0.12 * k); },
  pop(x, y) { const k = this.near(x, y); if (k > 0.05) this.noise(0.06, 1800, 0.08 * k); },
  boom(x, y) { const k = this.near(x, y); if (k > 0.05) { this.noise(0.4, 300, 0.35 * k); this.tone(120, 40, 0.4, 'sine', 0.3 * k); } },
  hit(mine) { this.tone(mine ? 180 : 320, mine ? 90 : 160, 0.12, 'sine', mine ? 0.28 : 0.14); },
  thwack(dmg) { this.noise(0.07, 900, 0.22); this.tone(dmg >= 20 ? 160 : 240, 70, 0.12, 'square', 0.09); }, // one of my shots landed
  jump(boost) { this.tone(boost ? 220 : 330, boost ? 880 : 620, boost ? 0.32 : 0.14, 'sine', 0.16); },
  fall() { this.tone(900, 120, 0.8, 'sine', 0.18); },
  launch() { this.tone(160, 900, 0.45, 'triangle', 0.18); this.noise(0.3, 700, 0.12); },
  click() { this.tone(500, 380, 0.06, 'square', 0.08); },
  rumble() { this.noise(0.6, 140, 0.25); },
  warn() { [660, 660].forEach((f, i) => this.tone(f, f, 0.12, 'square', 0.07, i * 0.2)); },
  chest() { [523, 784, 1046].forEach((f, i) => this.tone(f, f, 0.14, 'triangle', 0.14, i * 0.06)); },
  down() { this.tone(440, 110, 0.5, 'triangle', 0.22); },
  rev() { [523, 659, 784].forEach((f, i) => this.tone(f, f, 0.16, 'sine', 0.16, i * 0.08)); },
  heal() { [659, 880].forEach((f, i) => this.tone(f, f * 1.02, 0.12, 'sine', 0.14, i * 0.07)); },
  cap(good) { (good ? [523, 659, 784, 1046] : [392, 330, 262]).forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.16, i * 0.1)); },
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.3, 'triangle', 0.18, i * 0.12)); },
};

/* ---------- network ---------- */
function connect() {
  return new Promise((ok, fail) => {
    if (G.ws && G.ws.readyState === 1) return ok();
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    G.ws = ws;
    ws.onopen = () => ok();
    ws.onerror = () => { fail(new Error('ws')); $('homeStats').classList.add('hidden'); };
    ws.onclose = () => {
      $('homeStats').classList.add('hidden');
      if (G.state !== 'menu') { toMenu(); homeErr('Mất kết nối tới máy chủ. Thử lại nhé.'); }
      setTimeout(() => { if (G.state === 'menu' && (!G.ws || G.ws.readyState > 1)) connect().catch(() => {}); }, 5000); // the server restarted: look again
    };
    ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  });
}
const sendMsg = (m) => { if (G.ws && G.ws.readyState === 1) G.ws.send(JSON.stringify(m)); };

function onMsg(m) {
  if (m.t === 'hello') G.myId = m.id;
  else if (m.t === 'lobby') { G.state = 'lobby'; homeView('lobby'); lobbyView(m); }
  else if (m.t === 'stats') homeStats(m);
  else if (m.t === 'err') { G.state = 'menu'; homeView(G.mode === 'join' ? 'join' : 'main'); homeErr(m.msg); }
  else if (m.t === 'start') startMatch(m);
  else if (m.t === 'snap') onSnap(m);
  else if (m.t === 'end') showEnd(m);
  else if (m.t === 'closed') { if (G.state !== 'end' && G.state !== 'menu') { toMenu(); homeErr('Phòng đã đóng.'); } }
}

/* ---------- match setup ---------- */
function startMatch(m) {
  G.state = 'play'; G.size = m.size; G.scoreWin = m.scoreWin || C.SCORE_WIN;
  G.info.clear();
  for (const [id, team, slot, name, bot] of m.players) G.info.set(id, { team, slot, name: bot ? name + ' 🤖' : name, bot });
  G.teams = Math.max(...m.players.map((p) => p[1])) + 1;
  G.map = SIM.makeMap(m.seed);
  G.snaps = []; G.off = null; G.offW = []; DELAY = 0.12; G.pend = []; G.seq = 0; G.me = null; G.prev = null; G.shots.clear(); G.drawn.clear(); G.shotCd = 0; G.acc = 0; G.items = []; G.bt = new Map(); G.sl = new Map();
  G.W = { t: 0, on: new Set(), mate: null }; G.last = null;
  buildScene();
  if (window.R3D && R3D.on && R3D.menu) R3D.menu(false); // [3D] leave the home backdrop
  if (window.R3D && R3D.on) R3D.build(G.map); // [3D] the desk in three.js (render3d.js)
  $('start').classList.add('hidden'); $('end').classList.add('hidden'); $('hud').classList.remove('hidden');
  const mine = G.info.get(G.myId), mate = mateOf(G.myId);
  const names = { steps: 'khối gỗ', gate: 'cổng nút nhấn', boost: 'khe bật cao', spin: 'bút chì quay', lids: 'nắp lọ', seesaw: 'bập bênh', drawer: 'ngăn kéo', fan: 'quạt thổi', train: 'tàu đồ chơi', twin: 'hai cần gạt' };
  flashMsg('Vượt bàn học, đẩy đội khác té nhào!', `Đồng đội: ${mate ? G.info.get(mate).name : '?'} · ${teamName(mine.team)}`);
  feed('Đường hôm nay: ' + G.map.course.filter((c) => names[c.name]).map((c) => names[c.name]).join(' → '));
}
const mateOf = (id) => { const I = G.info.get(id); if (!I) return 0; for (const [j, J] of G.info) if (j !== id && J.team === I.team) return j; return 0; };
// draw order: things standing on a tower top go in front of the tower
function depth(x, y, z) {
  if (z > 60) for (const T of G.map.towers) if (x > T.x - 8 && x < T.x + T.w + 8 && y > T.y - 8 && y < T.y + T.h + 8) return T.y + T.h + 1 + (y - T.y) * 0.01;
  return y;
}

/* ---------- scene ---------- */
const L = {};
function buildScene() {
  const app = G.app, M = G.map;
  app.stage.removeChildren();
  G.views.clear(); G.itemViews.clear();
  L.world = new PIXI.Container(); app.stage.addChild(L.world);
  // the floor far below, with the desk's shadows on it (moves a little slower than the desk: depth)
  const V = ART.void(M); L.void = new PIXI.Sprite(V.tex); L.void.x = V.x; L.void.y = V.y; L.void.width = V.w; L.void.height = V.h; L.world.addChild(L.void); L.voidBase = V;
  const Sh = ART.shadows(M); L.shadow = new PIXI.Sprite(Sh.tex); L.shadow.x = Sh.x; L.shadow.y = Sh.y; L.shadow.width = Sh.w; L.shadow.height = Sh.h; L.world.addChild(L.shadow);
  L.below = new PIXI.Container(); L.world.addChild(L.below); // lid shadows, fans
  L.under = new PIXI.Container(); L.under.sortableChildren = true; L.world.addChild(L.under); // falling players, behind the furniture
  L.ground = new PIXI.Container(); L.ground.sortableChildren = true; L.world.addChild(L.ground);
  L.deco = new PIXI.Container(); L.world.addChild(L.deco);
  L.objects = new PIXI.Container(); L.objects.sortableChildren = true; L.world.addChild(L.objects);
  L.fx = new PIXI.Container(); L.fx.blendMode = 'add'; L.world.addChild(L.fx);
  L.top = new PIXI.Container(); L.world.addChild(L.top);
  L.marks = new PIXI.Graphics(); L.world.addChild(L.marks); // overview markers
  M.ground.forEach((g, i) => {
    if (g.kind === 'tower') { // books stacked up from the board
      const T = ART.tower(g.w, g.h, g.z * LIFT, i); const s = new PIXI.Sprite(T.tex); s.x = g.x - 4; s.y = g.y - g.z * LIFT - 4; s.zIndex = g.y + g.h; L.objects.addChild(s);
      return;
    }
    const S = ART.surface(g, i, teamCol(g.route < 0 ? 0 : g.route));
    const s = new PIXI.Sprite(S.tex); s.x = S.x; s.y = S.y; s.zIndex = g.y + g.h; L.ground.addChild(s);
  });
  // the board: one painting cut into tiles, so tiles can shake and drop
  const board = PIXI.Texture.from(ART.board()), tf = ART.tileFront(), h = M.half;
  G.tiles = [];
  for (let i = 0; i < 100; i++) {
    const t = M.tiles[i]; if (!t) { G.tiles.push(null); continue; }
    const fx = t.x - h + C.BOARD, fy = t.y - h + C.BOARD;
    const top = new PIXI.Sprite(new PIXI.Texture({ source: board.source, frame: new PIXI.Rectangle(fx, fy, C.TILE, C.TILE) })); top.x = t.x; top.y = t.y;
    const fr = new PIXI.Sprite(tf); fr.x = t.x; fr.y = t.y + C.TILE - 4;
    const c = new PIXI.Container(); c.addChild(fr, top); c.zIndex = t.y + C.TILE; L.ground.addChild(c);
    G.tiles.push({ c, top, fr, t, st: 0, k: 1 });
  }
  // devices
  G.dev = [];
  const threads = new PIXI.Graphics(); L.deco.addChild(threads);
  const plateUp = {}, plateDown = {};
  const leverView = (d, link) => {
    const v = {};
    v.base = new PIXI.Sprite(G.tex.leverBase.tex); v.base.anchor.set(0.5, 0.75); v.base.width = 70; v.base.height = 50; v.base.x = d.x; v.base.y = d.y;
    v.stick = new PIXI.Sprite(G.tex.leverStick.tex); v.stick.anchor.set(0.5, 0.95); v.stick.width = 20; v.stick.height = 60; v.stick.x = d.x; v.stick.y = d.y - 18;
    v.c = new PIXI.Container(); v.c.addChild(v.base, v.stick); v.c.zIndex = d.y; L.objects.addChild(v.c);
    v.ring = new PIXI.Graphics(); L.top.addChild(v.ring);
    const t = M.dev.find((o) => o.id === link); threadLine(threads, d.x, d.y, t.x + t.w / 2, t.y + t.h / 2, 0xffe08a);
    return v;
  };
  for (const d of M.dev) {
    let v = { d };
    if (d.type === 'gate') {
      const A = ART.gate(d.w, d.h); v.s = new PIXI.Sprite(A.tex); v.s.anchor.set(A.ox / (d.w + 8), 1 - 4 / (d.h + A.up + 8));
      v.s.x = d.x; v.s.y = d.y + d.h; v.s.zIndex = d.y + d.h; v.k = 1; L.objects.addChild(v.s);
    } else if (d.type === 'bridge' || d.type === 'drawer') {
      const A = d.type === 'bridge' ? ART.ruler(d.w, d.h) : ART.drawer(d.w, d.h); v.s = new PIXI.Sprite(A.tex); v.horiz = d.w >= d.h; v.s.zIndex = d.y + d.h + 1; L.ground.addChild(v.s);
      // a bridge unrolls from whatever controls it; a drawer slides out of the cabinet on the far side
      let from;
      if (d.type === 'bridge') { const ctl = M.dev.find((o) => (o.type === 'lever' || o.type === 'plate' || o.type === 'twin') && o.link === d.id); from = v.horiz ? (ctl.x > d.x + d.w / 2 ? 1 : 0) : (ctl.y > d.y + d.h / 2 ? 1 : 0); }
      else { const a = SIM.modLocal(M, d.route, d.mod, d.x, d.y)[0], b = SIM.modLocal(M, d.route, d.mod, d.x + d.w, d.y + d.h)[0]; from = (b > a) ? 1 : 0; }
      v.from = from;
      v.s.anchor.set(v.horiz ? from : 0, v.horiz ? 0 : from);
      if (v.horiz) { v.s.x = from ? d.x + d.w + 4 : d.x - 4; v.s.y = d.y - 4; } else { v.s.x = d.x - 4; v.s.y = from ? d.y + d.h + (d.type === 'bridge' ? 16 : 30) : d.y - 4; }
      v.k = 0; v.ghost = new PIXI.Graphics(); dashedRect(v.ghost, d.x + 6, d.y + 6, d.w - 12, d.h - 12, 0xfff3d6); L.deco.addChild(v.ghost);
    } else if (d.type === 'plat') {
      const A = ART.lid(d.w, d.h, d.key === 'm1' ? '#e8553f' : '#3a7bd5'); v.s = new PIXI.Sprite(A.tex); L.ground.addChild(v.s);
      v.sh = new PIXI.Sprite(G.tex.shadow); v.sh.anchor.set(0.5); v.sh.width = d.w * 1.3; v.sh.height = d.h * 1.1; v.sh.alpha = 0.9; L.below.addChild(v.sh);
    } else if (d.type === 'plate') {
      const col = teamCol(d.route);
      plateUp[col] = plateUp[col] || ART.plate(col, false); plateDown[col] = plateDown[col] || ART.plate(col, true);
      v.up = plateUp[col]; v.dn = plateDown[col];
      v.s = new PIXI.Sprite(v.up.tex); v.s.anchor.set(0.5, v.up.ay); v.s.width = v.up.w; v.s.height = v.up.h; v.s.x = d.x; v.s.y = d.y; L.deco.addChild(v.s);
      const t = M.dev.find((o) => o.id === d.link); threadLine(threads, d.x, d.y, t.x + t.w / 2, t.y + t.h / 2, col);
    } else if (d.type === 'lever' || d.type === 'twin') {
      v = { d, ...leverView(d, d.link) };
      if (d.type === 'twin') { const lab = new PIXI.Text({ text: '×2', style: { fontFamily: 'Baloo 2', fontWeight: '800', fontSize: 22, fill: '#ffe08a', stroke: { color: '#2a1f3d', width: 5 } } }); lab.anchor.set(0.5); lab.x = d.x; lab.y = d.y - 92; L.deco.addChild(lab); }
    } else if (d.type === 'spin') {
      v.c = new PIXI.Container(); v.c.x = d.x; v.c.y = d.y; v.c.zIndex = d.y;
      v.shadow = new PIXI.Sprite(G.tex.pencil.tex); v.shadow.anchor.set(0.5); v.shadow.width = G.tex.pencil.w; v.shadow.height = 30; v.shadow.tint = 0x2a1230; v.shadow.alpha = 0.3; v.shadow.y = 16;
      v.s = new PIXI.Sprite(G.tex.pencil.tex); v.s.anchor.set(0.5); v.s.width = G.tex.pencil.w; v.s.height = 30; v.s.y = -14;
      const pin = new PIXI.Sprite(G.tex.pin.tex); pin.anchor.set(0.5); pin.width = pin.height = 36; pin.y = -18;
      v.c.addChild(v.shadow, v.s, pin); L.objects.addChild(v.c);
      const ring = new PIXI.Graphics(); ring.circle(d.x, d.y, d.len + 6).stroke({ width: 3, color: 0xffffff, alpha: 0.18 }); L.deco.addChild(ring);
    } else if (d.type === 'seesaw') {
      const A = ART.seesaw(Math.hypot(d.bx - d.ax, d.by - d.ay));
      v.s = new PIXI.Sprite(A.tex); v.s.anchor.set(0.5, 0.45); v.s.width = A.w; v.s.height = 70;
      v.s.x = (d.ax + d.bx) / 2; v.s.y = (d.ay + d.by) / 2; v.s.rotation = Math.atan2(d.by - d.ay, d.bx - d.ax); v.s.zIndex = v.s.y - 30; L.objects.addChild(v.s);
      v.ring = new PIXI.Graphics();
      v.ring.circle(d.ax, d.ay, 34).fill({ color: 0x7fdc5a, alpha: 0.25 }).circle(d.ax, d.ay, 34).stroke({ width: 4, color: 0x7fdc5a, alpha: 0.85 });
      v.ring.circle(d.bx, d.by, 34).fill({ color: 0xff9a4a, alpha: 0.25 }).circle(d.bx, d.by, 34).stroke({ width: 4, color: 0xff9a4a, alpha: 0.85 });
      threadLine(v.ring, d.ax, d.ay, d.tx, d.ty, 0x7fdc5a, 0.25);
      L.deco.addChild(v.ring);
      const lab = (x, y, t, c) => { const s = new PIXI.Text({ text: t, style: { fontFamily: 'Nunito', fontWeight: '900', fontSize: 13, fill: c, stroke: { color: '#2a1f3d', width: 4 } } }); s.anchor.set(0.5); s.x = x; s.y = y + 48; L.deco.addChild(s); };
      lab(d.ax, d.ay, 'ĐỨNG', '#bff7a8'); lab(d.bx, d.by, 'NHẢY', '#ffd2a8');
      v.tilt = 0;
    } else if (d.type === 'fan') {
      const r = Math.min(d.w, d.h) * 0.45;
      v.base = new PIXI.Sprite(G.tex.fanBase(r)); v.base.anchor.set(0.5); v.base.x = d.x + d.w / 2; v.base.y = d.y + d.h / 2 + 60;
      v.blades = new PIXI.Sprite(G.tex.fanBlades(r)); v.blades.anchor.set(0.5); v.blades.x = v.base.x; v.blades.y = v.base.y;
      v.wind = new PIXI.Graphics(); v.wind.blendMode = 'add';
      L.below.addChild(v.base, v.blades); L.deco.addChild(v.wind);
    } else if (d.type === 'train') {
      const vert = Math.abs(d.y1 - d.y0) > Math.abs(d.x1 - d.x0), A = ART.train(d.w, d.h);
      v.s = new PIXI.Sprite(A.tex); v.up = A.up; L.objects.addChild(v.s);
      const rails = new PIXI.Graphics(); // the track it runs on, past both edges of the plank
      if (vert) { const x = d.x0 + d.w / 2; for (const o of [-22, 22]) rails.moveTo(x + o, d.y0).lineTo(x + o, d.y1 + d.h); rails.stroke({ width: 5, color: 0x7a5a48 }); for (let y = d.y0; y < d.y1 + d.h; y += 26) rails.rect(x - 34, y, 68, 8).fill({ color: 0x8a5432 }); }
      else { const y = d.y0 + d.h / 2; for (const o of [-22, 22]) rails.moveTo(d.x0, y + o).lineTo(d.x1 + d.w, y + o); rails.stroke({ width: 5, color: 0x7a5a48 }); for (let x = d.x0; x < d.x1 + d.w; x += 26) rails.rect(x, y - 34, 8, 68).fill({ color: 0x8a5432 }); }
      L.deco.addChildAt(rails, 0);
    } else if (d.type === 'sling') {
      v.s = new PIXI.Sprite(G.tex.sling.tex); v.s.anchor.set(0.5, 0.92); v.s.width = 90; v.s.height = 120; v.s.x = d.hx; v.s.y = d.hy; v.s.zIndex = d.hy; L.objects.addChild(v.s);
      v.band = new PIXI.Graphics(); L.deco.addChild(v.band);
      const ring = new PIXI.Graphics();
      ring.circle(d.x, d.y, 36).fill({ color: 0x8a5432, alpha: 0.35 }).circle(d.x, d.y, 36).stroke({ width: 4, color: 0xffe08a, alpha: 0.8 });
      ring.circle(d.hx, d.hy, 30).stroke({ width: 3, color: 0xffffff, alpha: 0.35 });
      L.deco.addChild(ring);
      v.ring = new PIXI.Graphics(); L.top.addChild(v.ring);
    }
    G.dev.push(v);
  }
  // chests (golden ones on the tower tops)
  G.chestViews = M.chests.map((c) => {
    const s = new PIXI.Sprite(G.tex.chest[c.tier][0].tex); s.anchor.set(0.5, 0.86); s.width = 70; s.height = 76; s.x = c.x; s.y = c.y + 14 - c.z * LIFT; s.zIndex = depth(c.x, c.y, c.z);
    L.objects.addChild(s);
    const ring = new PIXI.Graphics(); L.top.addChild(ring);
    return { c, s, ring, open: false };
  });
  // the marble and its lane
  L.lane = new PIXI.Graphics(); L.deco.addChild(L.lane);
  L.marble = new PIXI.Container(); const ms = new PIXI.Sprite(G.tex.marble.tex); ms.anchor.set(0.5); ms.width = ms.height = G.tex.marble.w; L.marbleSpr = ms;
  const msh = new PIXI.Sprite(G.tex.shadow); msh.anchor.set(0.5); msh.width = 170; msh.height = 70; msh.y = 50; L.marble.addChild(msh, ms); L.marble.visible = false; L.objects.addChild(L.marble);
  // screen-space light: god rays, dust, vignette
  L.screen = new PIXI.Container(); app.stage.addChild(L.screen);
  L.rays = new PIXI.Container(); L.rays.blendMode = 'add'; L.screen.addChild(L.rays);
  G.rays = [];
  for (let i = 0; i < 5; i++) { const r = new PIXI.Sprite(G.tex.ray); r.anchor.set(0.5, 0); r.tint = 0xffc277; r.alpha = 0.1; r.rotation = -0.38; G.rays.push({ s: r, ph: Math.random() * 6, x: 0.1 + i * 0.22 + Math.random() * 0.05 }); L.rays.addChild(r); }
  L.dust = new PIXI.Container(); L.dust.blendMode = 'add'; L.screen.addChild(L.dust);
  G.dust = [];
  for (let i = 0; i < (TOUCH ? 22 : 40); i++) { const d = new PIXI.Sprite(G.tex.mote); d.anchor.set(0.5); const s = 0.15 + Math.random() * 0.45; d.scale.set(s); d.alpha = 0.2 + Math.random() * 0.4; G.dust.push({ s: d, x: Math.random(), y: Math.random(), vx: (Math.random() - 0.3) * 0.006, vy: (Math.random() - 0.6) * 0.004, ph: Math.random() * 6, depth: s }); L.dust.addChild(d); }
  L.vig = new PIXI.Sprite(); L.screen.addChild(L.vig); G.vigSize = '';
}
function dashedRect(g, x, y, w, h, color) {
  const seg = (ax, ay, bx, by) => { const l = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.floor(l / 26)); for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 0.55) / n; g.moveTo(ax + (bx - ax) * t0, ay + (by - ay) * t0).lineTo(ax + (bx - ax) * t1, ay + (by - ay) * t1); } };
  seg(x, y, x + w, y); seg(x + w, y, x + w, y + h); seg(x + w, y + h, x, y + h); seg(x, y + h, x, y);
  g.stroke({ width: 4, color, alpha: 0.55, cap: 'round' });
}
function threadLine(g, ax, ay, bx, by, color, alpha) { // a loose thread showing what a button or lever works
  const col = typeof color === 'string' ? parseInt(color.slice(1), 16) : color;
  const mx = (ax + bx) / 2, my = (ay + by) / 2 + 40, n = Math.max(6, Math.round(Math.hypot(bx - ax, by - ay) / 22));
  for (let i = 0; i < n; i += 2) {
    const p = (t) => { const u = 1 - t; return [u * u * ax + 2 * u * t * mx + t * t * bx, u * u * ay + 2 * u * t * my + t * t * by]; };
    const [x0, y0] = p(i / n), [x1, y1] = p(Math.min(1, (i + 1) / n));
    g.moveTo(x0, y0).lineTo(x1, y1);
  }
  g.stroke({ width: 3, color: col, alpha: alpha ?? 0.45, cap: 'round' });
}

function playerView(id) {
  let v = G.views.get(id); if (v) return v;
  const I = G.info.get(id) || { team: 0, slot: 0, name: '?' };
  const key = I.team + '|' + I.slot;
  G.dolls = G.dolls || {};
  const D = G.dolls[key] || (G.dolls[key] = ART.doll(I.team, I.slot));
  const root = new PIXI.Container(); root.sortableChildren = true;
  const sh = new PIXI.Sprite(G.tex.shadow); sh.anchor.set(0.5); sh.width = 52; sh.height = 22; sh.y = 2;
  const lsh = new PIXI.Sprite(G.tex.shadow); lsh.anchor.set(0.5, 0); lsh.width = 34; lsh.height = 60; lsh.alpha = 0.55; lsh.skew.x = -0.25;
  const body = new PIXI.Container();
  const doll = new PIXI.Sprite(D.tex); doll.anchor.set(0.5, 1); doll.width = D.w; doll.height = D.h; doll.y = 4;
  body.addChild(doll);
  const gun = new PIXI.Sprite(gunTex(I.team, 0)); gun.anchor.set(0.12, 0.5); gun.width = 46; gun.height = 22;
  const ring = new PIXI.Graphics(); ring.ellipse(0, 2, 22, 9).stroke({ width: 3, color: teamCol(I.team), alpha: 0.9 });
  const bz = new PIXI.Graphics(); bz.circle(0, 0, C.BOOST_R).fill({ color: 0xbff7a8, alpha: 0.16 }).stroke({ width: 4, color: 0xbff7a8, alpha: 0.9 }); bz.visible = false; // where a jump becomes a boost
  const brace = new PIXI.Text({ text: '⇧', style: { fontFamily: 'Nunito', fontWeight: '900', fontSize: 26, fill: '#bff7a8', stroke: { color: '#2a1f3d', width: 5 } } }); brace.anchor.set(0.5, 1); brace.y = -78; brace.visible = false;
  root.addChild(bz, lsh, sh, ring, body, gun, brace);
  L.objects.addChild(root);
  const tag = new PIXI.Container();
  const mine = id === G.myId, ally = G.info.get(G.myId) && I.team === G.info.get(G.myId).team;
  const name = new PIXI.Text({ text: I.name, style: { fontFamily: 'Nunito', fontWeight: '900', fontSize: 13, fill: mine ? '#ffe08a' : ally ? '#bff7ec' : '#ffffff', stroke: { color: '#2a1f3d', width: 4 } } });
  name.anchor.set(0.5, 1); name.y = -86;
  const bar = new PIXI.Graphics();
  tag.addChild(bar, name);
  L.top.addChild(tag);
  v = { root, body, doll, gun, ring, bz, sh, lsh, tag, bar, name, brace, ally, team: I.team, walk: 0, w: 0, face: 1, layer: 'obj', fallT: 0 };
  G.views.set(id, v);
  return v;
}
function gunTex(team, w) { G.guns = G.guns || {}; const k = team + '|' + w; return (G.guns[k] || (G.guns[k] = ART.gun(team, w))).tex; }

/* ---------- snapshots ---------- */
function onSnap(m) {
  const now = performance.now() / 1000, st = m.k / C.TICK;
  // clock: the server's time is our time plus an offset. Over the last 4 s the fastest arrival gives the offset, and
  // the spread of arrivals (jitter) sets how far in the past we draw, so the next snapshot is nearly always there.
  const o = st - now, W4 = G.offW || (G.offW = []);
  W4.push([now, o]); while (W4.length && now - W4[0][0] > 4) W4.shift();
  let hi = -1e9; for (const w of W4) if (w[1] > hi) hi = w[1];
  const lows = W4.map((w) => w[1]).sort((a, b) => a - b), lo = lows[Math.floor(lows.length * 0.05)];
  if (G.off === null || W4.length < 3) G.off = hi; else G.off += (hi - G.off) * 0.1;
  const want = SIM.clamp(SNAP_GAP + (hi - lo) + 0.02, 0.09, 0.3);
  DELAY += (want - DELAY) * (want > DELAY ? 0.3 : 0.03); // widen quickly, narrow slowly
  const pl = new Map(); for (const a of m.p) pl.set(a[0], a);
  G.snaps.push({ t: st, p: pl }); if (G.snaps.length > 40) G.snaps.shift();
  G.last = m;
  // the world: open gates and lowered bridges, opened chests, things on the floor
  G.W.on = new Set(m.d);
  const opened = new Set(m.c); for (const c of G.map.chests) c.open = opened.has(c.id);
  G.items = m.it.map(([id, k, x, y, z]) => ({ id, k, x, y, z }));
  G.bt = new Map(m.bt); G.sl = new Map(m.sl);
  // shots: positions at this snapshot's time
  const live = new Set();
  for (const [id, x, y, vx, vy, team, w, z, o] of m.s) {
    if (o === G.myId) continue; // mine are drawn the moment I fire (fireLocal)
    live.add(id); let s = G.shots.get(id); if (!s) { s = { id, team, w, v: shotView(team, w) }; G.shots.set(id, s); } Object.assign(s, { x, y, z, vx, vy, t: st });
  }
  for (const [id, s] of G.shots) if (!live.has(id) && !s.local) { s.v.destroy(); G.shots.delete(id); }
  for (const e of m.e) { if (e[0] === 'shot' && e[1] === G.myId) continue; onEvent(e); if (window.R3D && R3D.on) R3D.event(e); } // [3D] effects; my shots were shown already
  // reconcile the local player: start from the server, replay the inputs it has not seen yet
  const a = pl.get(G.myId), mt = pl.get(mateOf(G.myId));
  G.W.mate = mt ? { x: mt[1], y: mt[2], z: mt[6], st: mt[5], brace: !!mt[26] } : null;
  if (a) {
    const base = { x: a[1], y: a[2], vx: a[10], vy: a[11], kx: a[12], ky: a[13], st: a[5], z: a[6], vz: a[21], boost: !!a[22], air: a[23] / 100, fall: a[17] / 10, fly: a[18] ? {} : null, brace: false };
    G.pend = G.pend.filter((i) => i.s > m.ack);
    G.predT = st;
    if (base.fly || base.fall > 0 || base.st === 2) G.pend = []; // flung, falling or out: just follow the server
    for (const i of G.pend) { G.predT += C.DT; predict(base, i); }
    const was = G.me;
    if (was && !base.fly && !(base.fall > 0) && Math.hypot(was.x - base.x, was.y - base.y) < 160) { G.vis.ex = (G.vis.ex || 0) + was.x - base.x; G.vis.ey = (G.vis.ey || 0) + was.y - base.y; } // hide the correction, then let it melt away
    else { G.vis.ex = G.vis.ey = 0; G.prev = null; } // a teleport (checkpoint, respawn): no sweep across the map
    G.me = base; G.meRaw = a;
    if (!G.prev) G.prev = { x: base.x, y: base.y, z: base.z };
  }
}
/* my own shots: shown the instant I fire, flying on my screen; the server's copies are not drawn */
let lshotN = 0;
function fireLocal(me, inp) {
  const a = G.meRaw, I = G.info.get(G.myId); if (!a || !I) return;
  const w = a[15], W = SIM.WEAPONS[w];
  if (w && a[16] <= 0) return;
  G.shotCd = W.cd;
  for (let k = 0; k < W.n; k++) {
    const ang = inp.a + (W.n > 1 ? (k / (W.n - 1) - 0.5) * W.spread : (Math.random() - 0.5) * W.spread), ca = Math.cos(ang), sa = Math.sin(ang), off = W.melee ? 4 : C.R + 6;
    const id = 'L' + ++lshotN;
    G.shots.set(id, { id, local: true, team: I.team, w, x: me.x + ca * off, y: me.y + sa * off, z: me.z, vx: ca * W.speed, vy: sa * W.speed, life: W.life, t: 0, v: shotView(I.team, w) });
  }
  SFX.shot(me.x, me.y, w);
  if (window.R3D && R3D.on) R3D.event(['shot', G.myId, w]); // [3D] recoil and muzzle puff
}
function flyLocalShots(dt) {
  for (const [id, s] of G.shots) {
    if (!s.local) continue;
    const W = SIM.WEAPONS[s.w]; let gone = false;
    s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt;
    if (!W.lob && SIM.blocked(G.map, G.W, s.x, s.y, 5, s.z)) { gone = true; puff(s.x, s.y - 26, 0xffe2b0, 4); }
    else if (!W.lob) for (const [pid, d] of G.drawn) { // stops on whoever it reaches on my screen; the server decides the hit
      const I = G.info.get(pid); if (!I || I.team === s.team || d[2]) continue;
      if (Math.hypot(d[0] - s.x, d[1] - s.y) < C.R + (W.melee ? 14 : 6)) { if (!W.melee) gone = true; break; }
    }
    if (s.life <= 0) gone = true;
    if (gone) { s.v.destroy(); G.shots.delete(id); continue; }
    s.t = G.rt + DELAY * 0.5; // the renderers then draw it right where it is
  }
}
function hitMark(big) { // a quick ✕ at the cursor when one of my shots lands
  const el = $('hitmark'); if (!el || TOUCH) return;
  el.style.left = IN.mx + 'px'; el.style.top = IN.my + 'px'; el.classList.remove('on', 'big'); void el.offsetWidth; el.classList.add('on'); if (big) el.classList.add('big');
}
function predict(p, inp) {
  G.W.t = G.predT;
  p.brace = !!inp.i && SIM.canBrace(G.map, G.items, p);
  p.landed = false; p.jumped = 0;
  SIM.move(G.map, p, inp, C.DT, G.W);
}
function shotView(team, w) {
  const c = new PIXI.Container();
  const gl = new PIXI.Sprite(G.tex.glowWarm); gl.anchor.set(0.5); gl.width = gl.height = w === 4 ? 70 : 46; gl.tint = teamCol(team); gl.blendMode = 'add';
  const core = new PIXI.Graphics();
  if (w === 4) core.circle(0, 0, 10).fill({ color: 0x8e5bd6 }).circle(-3, -3, 4).fill({ color: 0xffffff, alpha: 0.8 });
  else if (w === 3) core.rect(-8, -2, 16, 4).fill({ color: 0xd8dde8 });
  else if (w === 5) core.circle(0, 0, 9).fill({ color: 0xffd0e0, alpha: 0.7 });
  else if (w === 6) core.circle(0, 0, 12).stroke({ width: 4, color: 0xffffff, alpha: 0.6 });
  else core.circle(0, 0, w === 2 ? 4 : 6).fill({ color: 0xfff4dc }).circle(0, 0, w === 2 ? 4 : 6).stroke({ width: 2.5, color: teamCol(team) });
  c.addChild(gl, core); L.fx.addChild(c);
  return c;
}

function onEvent(e) {
  const t = e[0], I = (id) => G.info.get(id) || { name: '?' };
  const pos = (id) => { const v = G.views.get(id); return v ? { x: v.root.x, y: v.root.y } : null; };
  const mine = G.info.get(G.myId) || { team: -1 };
  if (t === 'hit') {
    const p = pos(e[1]);
    if (p) { floatText(p.x, p.y - 70, '-' + e[2], e[1] === G.myId ? '#ff6b6b' : e[4] === G.myId ? '#ffd27a' : '#ffffff'); puff(p.x, p.y - 40, 0xfff4d0, 6); }
    if (e[1] === G.myId) { SFX.hit(true); G.shake = Math.max(G.shake || 0, 7); }
    else if (e[4] === G.myId) { SFX.thwack(e[2]); G.shake = Math.max(G.shake || 0, 2.5); hitMark(e[2] >= 20); }
    else SFX.hit(false);
  }
  else if (t === 'shot') { const p = pos(e[1]); if (p) SFX.shot(p.x, p.y, e[2]); }
  else if (t === 'pop') { puff(e[1], e[2], 0xffe2b0, 6); SFX.pop(e[1], e[2]); }
  else if (t === 'boom') { puff(e[1], e[2], 0xffc070, 26); puff(e[1], e[2], 0xb48cff, 12); SFX.boom(e[1], e[2]); if (Math.hypot(e[1] - G.vis.x, e[2] - G.vis.y) < 500) G.shake = 10; }
  else if (t === 'jump') { if (e[1] !== G.myId) { const p = pos(e[1]); if (p && SFX.near(p.x, p.y) > 0.3) SFX.jump(e[2] === 2); } if (e[2] === 2) { const p = pos(e[1]); if (p) puff(p.x, p.y, 0xbff7a8, 12); } }
  else if (t === 'fall') { if (e[1] === G.myId) SFX.fall(); feedIf(e[1], `${I(e[1]).name} trượt chân rơi xuống!`); }
  else if (t === 'launch' || t === 'sling') { SFX.launch(); const v = G.dev.find((x) => x.d.id === e[2]); if (v) v.tilt = 1; if (e[1] === G.myId) flashMsg('Bay nào!', ''); }
  else if (t === 'shock') { const p = pos(e[1]); if (p) { puff(p.x, p.y, 0xffe08a, 24); G.shake = Math.max(G.shake || 0, SFX.near(p.x, p.y) * 10); } SFX.boom(p ? p.x : 0, p ? p.y : 0); }
  else if (t === 'lever') { SFX.click(); if (I(e[2]).team === mine.team) feed(`${I(e[2]).name} đã hạ cầu thước kẻ`); }
  else if (t === 'half') { SFX.click(); if (e[2] === G.myId) flashMsg('Mới gạt một cần', 'Hai cần phải gạt cùng lúc!'); }
  else if (t === 'spin' || t === 'train') { const p = pos(e[1]); if (p) puff(p.x, p.y - 30, 0xfff1a0, 8); }
  else if (t === 'marble') { const p = pos(e[1]); if (p) puff(p.x, p.y - 30, 0x9fd8ff, 14); SFX.rumble(); }
  else if (t === 'marbleWarn') { SFX.warn(); flashMsg('Bi khổng lồ sắp lăn qua!', 'Tránh khỏi vệt đỏ trên bàn cờ'); }
  else if (t === 'crumbleWarn') { SFX.warn(); feed('Vài ô bàn cờ sắp sụp: tránh các ô đang rung!'); }
  else if (t === 'ko') { // knocked off: a point for the pusher's duo
    const by = I(e[2]), good = by.team === mine.team;
    feed(`${by.name} đẩy ${I(e[1]).name} rơi · +1 ${good ? 'đội bạn' : teamName(by.team)}`);
    if (e[2] === G.myId) { SFX.cap(true); G.shake = Math.max(G.shake || 0, 8); flashMsg('+1 điểm!', `Bạn đẩy ${I(e[1]).name} rơi`); }
    else if (e[1] === G.myId) { SFX.cap(false); flashMsg('Bạn bị đẩy rơi!', `+1 cho ${teamName(by.team)}`); }
    else if (good) SFX.cap(true);
  }
  else if (t === 'chest') { const c = G.map.chests[e[1]]; SFX.chest(); if (c) puff(c.x, c.y - 30 - c.z * LIFT, 0xffe08a, 18); }
  else if (t === 'pick') { if (e[1] === G.myId) { SFX.heal(); flashMsg(SIM.WEAPONS[e[2]].name, `${SIM.WEAPONS[e[2]].ammo} lượt`); } }
  else if (t === 'down') { feed(`${I(e[1]).name} bị hạ gục${e[2] ? ' bởi ' + I(e[2]).name : ''}`); if (e[1] === G.myId) { SFX.down(); flashMsg('Bạn bị hạ gục!', 'Đồng đội đứng cạnh để kéo dậy'); } }
  else if (t === 'out') { feed(`${I(e[1]).name} bị loại${e[2] ? ' bởi ' + I(e[2]).name : ''}`); if (e[1] === G.myId) flashMsg('Bạn bị loại', 'Sẽ hồi sinh cạnh đồng đội'); }
  else if (t === 'rev') { feed(`${I(e[1]).name} đã được kéo dậy`); SFX.rev(); const p = pos(e[1]); if (p) puff(p.x, p.y - 30, 0x9dffb0, 16); }
  else if (t === 'spawn') { const p = pos(e[1]); if (p) puff(p.x, p.y - 30, 0xffffff, 10); }
  else if (t === 'heal' || t === 'armor') { if (e[1] === G.myId) SFX.heal(); const p = pos(e[1]); if (p) puff(p.x, p.y - 30, t === 'heal' ? 0xff8080 : 0x80b0ff, 10); }
  else if (t === 'win') { if (mine.team === e[1]) { SFX.win(); flashMsg('Đôi bạn chiến thắng!', ''); } }
}
function feedIf(id, text) { const I = G.info.get(id), M = G.info.get(G.myId); if (I && M && I.team === M.team) feed(text); }

/* ---------- input ---------- */
const IN = { keys: {}, mx: 0, my: 0, fire: false, jump: false, use: false, useTouch: false, aim: 0, touch: { L: null, R: null }, look: false, peek: null };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { if (!e.repeat) IN.jump = true; e.preventDefault(); }
  if (e.code === 'Tab') e.preventDefault(); // Tab is the overview, not focus switching
  if (e.code === 'Escape') { pauseMenu($('pause').classList.contains('hidden')); return; }
  if (!$('pause').classList.contains('hidden')) return; // paused: no input
  IN.keys[e.code] = true;
});
addEventListener('keyup', (e) => { IN.keys[e.code] = false; });
addEventListener('mousemove', (e) => { IN.mx = e.clientX; IN.my = e.clientY; });
addEventListener('mousedown', (e) => { if (e.button === 0 && G.state === 'play' && !e.target.closest('button,.card')) IN.fire = true; SFX.init(); });
addEventListener('mouseup', (e) => { if (e.button === 0) IN.fire = false; });
addEventListener('blur', () => { IN.keys = {}; IN.fire = false; IN.useTouch = false; });
$('jumpBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); IN.jump = true; SFX.init(); });
$('useBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); IN.useTouch = true; SFX.init(); });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('useBtn').addEventListener(ev, () => { IN.useTouch = false; });
$('lookBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); IN.look = !IN.look; $('lookBtn').classList.toggle('on', IN.look); });
// press and drag on the minimap: the camera looks there until you let go
const peekAt = (e) => { const r = $('miniCv').getBoundingClientRect(); IN.peek = [SIM.clamp((e.clientX - r.left) / r.width, 0, 1) * G.map.w, SIM.clamp((e.clientY - r.top) / r.height, 0, 1) * G.map.h]; };
$('mini').addEventListener('pointerdown', (e) => { if (!G.map) return; e.preventDefault(); $('mini').setPointerCapture(e.pointerId); peekAt(e); });
$('mini').addEventListener('pointermove', (e) => { if (IN.peek) peekAt(e); });
for (const ev of ['pointerup', 'pointercancel']) $('mini').addEventListener(ev, () => { IN.peek = null; });
// touch: left half moves, right half aims and fires
const stickEl = { L: $('stickL'), R: $('stickR') };
addEventListener('touchstart', (e) => {
  SFX.init();
  if (G.state !== 'play' || !$('pause').classList.contains('hidden')) return;
  for (const t of e.changedTouches) {
    if (t.target.closest && t.target.closest('button,#mini')) continue;
    const side = t.clientX < innerWidth / 2 ? 'L' : 'R';
    if (IN.touch[side]) continue;
    IN.touch[side] = { id: t.identifier, x0: t.clientX, y0: t.clientY, dx: 0, dy: 0 };
    const el = stickEl[side]; el.style.left = (t.clientX - 65) + 'px'; el.style.top = (t.clientY - 65) + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
  }
}, { passive: true });
addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) for (const side of ['L', 'R']) {
    const T = IN.touch[side]; if (!T || T.id !== t.identifier) continue;
    let dx = t.clientX - T.x0, dy = t.clientY - T.y0; const l = Math.hypot(dx, dy); if (l > 55) { dx *= 55 / l; dy *= 55 / l; }
    T.dx = dx / 55; T.dy = dy / 55; stickEl[side].firstElementChild.style.transform = `translate(${dx}px,${dy}px)`;
  }
}, { passive: true });
addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) for (const side of ['L', 'R']) {
    const T = IN.touch[side]; if (!T || T.id !== t.identifier) continue;
    IN.touch[side] = null; stickEl[side].firstElementChild.style.transform = ''; stickEl[side].removeAttribute('style');
  }
}, { passive: true });

function readInput() {
  let mx = 0, my = 0;
  const k = IN.keys;
  if (k.KeyA || k.ArrowLeft) mx -= 1; if (k.KeyD || k.ArrowRight) mx += 1; if (k.KeyW || k.ArrowUp) my -= 1; if (k.KeyS || k.ArrowDown) my += 1;
  let fire = IN.fire, a = IN.aim;
  if (IN.touch.L) { mx = IN.touch.L.dx; my = IN.touch.L.dy; }
  if (IN.touch.R) { const T = IN.touch.R; if (Math.hypot(T.dx, T.dy) > 0.25) { a = Math.atan2(T.dy, T.dx); fire = Math.hypot(T.dx, T.dy) > 0.45; } }
  else if (!TOUCH && G.me && window.R3D && R3D.on) { // [3D] mouse: the cursor's ray onto the plane at gun height
    const w = R3D.screenToWorld(IN.mx, IN.my, G.vis.z + 30); a = Math.atan2(w.y - G.vis.y, w.x - G.vis.x);
  } else if (!TOUCH && G.me) { // mouse: aim at the cursor in the world
    const z = G.cam.z, wx = (IN.mx - innerWidth / 2) / z + G.cam.x, wy = (IN.my - innerHeight / 2) / z + G.cam.y;
    a = Math.atan2(wy - (G.vis.y - 26 - G.vis.z * LIFT), wx - G.vis.x);
  } else if (TOUCH && (mx || my) && !IN.touch.R) a = Math.atan2(my, mx);
  IN.aim = a;
  const use = !!(k.KeyF || k.KeyE || IN.useTouch);
  const inp = { s: ++G.seq, mx, my, a: Math.round(a * 1000) / 1000, f: fire ? 1 : 0, j: IN.jump ? 1 : 0, i: use ? 1 : 0, v: Math.round((G.rt || 0) * C.TICK) }; // v: the tick the others are drawn at
  IN.jump = false;
  return inp;
}

/* ---------- frame ---------- */
function frame(ticker) {
  const dt = Math.min(0.05, ticker.deltaMS / 1000), now = performance.now() / 1000;
  if (G.state !== 'play' && G.state !== 'end') return;
  // fixed-rate input + prediction
  G.acc += dt;
  while (G.acc >= C.DT) {
    G.acc -= C.DT;
    if (G.state !== 'play') break;
    const inp = readInput();
    sendMsg({ t: 'in', ...inp });
    G.predT += C.DT;
    const me = G.me;
    if (me && me.st !== 2 && !me.fly && !(me.fall > 0)) {
      G.prev = { x: me.x, y: me.y, z: me.z }; G.pend.push(inp); predict(me, inp);
      if (me.jumped) SFX.jump(me.jumped === 2);
      G.shotCd = Math.max(0, (G.shotCd || 0) - C.DT);
      if (inp.f && me.st === 0 && G.shotCd <= 0) fireLocal(me, inp);
    }
  }
  const drawT = G.predT + G.acc;
  const rt = now + (G.off || 0) - DELAY; G.rt = rt;
  // where everyone is: interpolate between the two snapshots around rt
  let A = null, B = null;
  for (let i = G.snaps.length - 1; i >= 0; i--) if (G.snaps[i].t <= rt) { A = G.snaps[i]; B = G.snaps[i + 1] || A; break; }
  if (!A && G.snaps.length) A = B = G.snaps[0];
  if (!A) return;
  const f = B.t > A.t ? SIM.clamp((rt - A.t) / (B.t - A.t), 0, 1) : 0;
  const ex = A === B ? SIM.clamp(rt - A.t, 0, 0.1) : 0; // past the newest snapshot: carry on for a moment instead of freezing
  // my drawn position: prediction, smoothed between steps, with corrections melting away
  const me = G.me, predicting = me && me.st !== 2 && !me.fly && !(me.fall > 0);
  if (predicting) {
    const al = G.acc / C.DT, P = G.prev || me;
    const k = Math.pow(0.004, dt); G.vis.ex = (G.vis.ex || 0) * k; G.vis.ey = (G.vis.ey || 0) * k;
    G.vis.x = P.x + (me.x - P.x) * al + G.vis.ex; G.vis.y = P.y + (me.y - P.y) * al + G.vis.ey; G.vis.z = P.z + (me.z - P.z) * al;
  }
  const latest = G.snaps[G.snaps.length - 1];
  for (const [id] of G.info) {
    const a = A.p.get(id), b = B.p.get(id) || a, L2 = latest.p.get(id); if (!a || !L2) continue;
    const v = playerView(id);
    let x = a[1] + (b[1] - a[1]) * f + (a[17] ? 0 : a[10] * ex), y = a[2] + (b[2] - a[2]) * f + (a[17] ? 0 : a[11] * ex), z = a[6] + (b[6] - a[6]) * f;
    const mine = id === G.myId;
    const held = mine && G.me && L2[5] !== 2 && !G.me.fly && (predicting || G.me.fall > 0); // predicted, or frozen where it slipped off
    if (held) { x = G.vis.x; y = G.vis.y; z = G.vis.z; }
    else if (mine && L2[5] !== 2) { G.vis.x = x; G.vis.y = y; G.vis.z = z; }
    G.drawn.set(id, [x, y, L2[5] === 2 || L2[17] > 0 ? 1 : 0]);
    const ang = mine ? IN.aim : (a[3] + angDiff(a[3], b[3]) * f) / 100;
    drawPlayer(v, id, x, y, z, ang, L2, dt, now, mine);
    if (R3D.on) R3D.player(id, x, y, z, ang, L2, dt, now, mine); // [3D]
  }
  // shots: straight lines from their snapshot positions
  flyLocalShots(dt);
  for (const s of G.shots.values()) { const t = SIM.clamp(rt - s.t + DELAY * 0.5, -0.1, 0.4); s.v.x = s.x + s.vx * t; s.v.y = s.y + s.vy * t - 26 - (s.z || 0) * LIFT; }
  if (!R3D.on) drawWorld(dt, now, drawT, latest); // [3D] the Pixi world is not drawn in 3D
  updateFx(dt);
  camera(dt, now);
  if (R3D.on) R3D.frame(dt, now, drawT, latest, rt); else screenFx(dt, now); // [3D] after camera(): it follows G.cam
  hud(latest, now, drawT);
}
const angDiff = (a, b) => { let d = (b - a) % 628; if (d > 314) d -= 628; if (d < -314) d += 628; return d; };

function drawPlayer(v, id, x, y, z, ang, a, dt, now, mine) {
  const st = a[5], falling = a[17] > 0 || !!(mine && G.me && G.me.fall > 0);
  v.root.visible = st !== 2; v.tag.visible = st !== 2 && !falling;
  if (st === 2) { v.fallT = 0; return; }
  // falling off the furniture: behind it if it fell off the far side, shrinking away into the room below
  if (falling) {
    if (!v.fallT) { const g = SIM.groundAt(G.map, G.W, x, y - 40); setLayer(v, g ? 'obj' : 'under'); v.fx0 = x; v.fy0 = y - z * LIFT; }
    v.fallT += dt;
    const k = Math.min(1, v.fallT / C.FALL_T);
    v.root.x = v.fx0; v.root.y = v.fy0 + k * k * 220; v.root.zIndex = v.fy0 + 2000;
    v.root.scale.set(1 - k * 0.6); v.root.alpha = 1 - k * 0.9; v.sh.visible = v.lsh.visible = false;
    return;
  }
  if (v.fallT) { v.fallT = 0; setLayer(v, 'obj'); v.root.scale.set(1); v.root.alpha = 1; v.sh.visible = v.lsh.visible = true; }
  // the floor under the player (a tower top is drawn lifted): the shadow sits on it, the body rises above it
  const g = SIM.groundAt(G.map, G.W, x, y, z + C.STEP), fl = g ? g.z || 0 : 0, h = Math.max(0, z - fl);
  v.root.x = x; v.root.y = y - fl * LIFT; v.root.zIndex = depth(x, y, z);
  const moved = Math.hypot(x - (v.px ?? x), y - (v.py ?? y)) / Math.max(dt, 1e-3); v.px = x; v.py = y;
  const air = h > 1;
  v.walk += dt * (moved > 30 && !air ? 14 : 0);
  const face = Math.cos(ang) < 0 ? -1 : 1; v.face += (face - v.face) * Math.min(1, dt * 18);
  const bob = moved > 30 && !air ? Math.abs(Math.sin(v.walk)) * 4 : Math.sin(now * 2.4 + id) * 1;
  const lift = h * LIFT;
  const brace = !!a[26];
  let squash = 1 + (moved > 30 ? Math.sin(v.walk * 2) * 0.04 : Math.sin(now * 2.4 + id) * 0.015);
  if (air) squash = 1.06; if (brace) squash = 0.8;
  if (st === 1) { // downed: lying down
    v.body.rotation = -1.3 * Math.sign(v.face || 1); v.body.y = -6; v.body.scale.set(0.95, 0.95); v.gun.visible = false;
  } else {
    v.body.rotation = moved > 30 && !air ? Math.sin(v.walk) * 0.08 : 0; v.body.y = -bob - lift;
    v.body.scale.set(Math.abs(v.face) < 0.15 ? 0.15 * Math.sign(v.face || 1) : v.face * (2 - squash), squash);
    v.gun.visible = !brace;
    if (v.w !== a[15]) { v.w = a[15]; v.gun.texture = gunTex(v.team, v.w); }
    v.gun.x = Math.cos(ang) * 8; v.gun.y = -30 - bob - lift + Math.sin(ang) * 4; v.gun.rotation = ang; v.gun.scale.y = Math.cos(ang) < 0 ? -Math.abs(v.gun.scale.y) : Math.abs(v.gun.scale.y);
    v.gun.zIndex = Math.sin(ang) < 0 ? -1 : 1;
  }
  v.brace.visible = brace; v.brace.y = -78 - Math.abs(Math.sin(now * 6)) * 6;
  v.doll.tint = st === 0 && a[4] < 40 && Math.sin(now * (a[4] < 20 ? 14 : 8)) > 0 ? 0xff9a9a : 0xffffff; // badly hurt: flies far, blinks red
  v.bz.visible = brace && v.ally && !mine;
  if (v.bz.visible) { const inside = Math.hypot(G.vis.x - x, G.vis.y - y) < C.BOOST_R && Math.abs(G.vis.z - z) < 10; v.bz.alpha = inside ? 1 : 0.45 + 0.25 * Math.sin(now * 5); v.bz.scale.set(inside ? 1.04 : 1); }
  const shk = Math.max(0.35, 1 - h / 420); v.sh.scale.set(shk * 52 / 64, shk * 22 / 32); v.sh.alpha = shk;
  v.lsh.alpha = st === 1 ? 0.3 : 0.5 * shk; v.ring.alpha = air ? 0.4 : 1;
  v.root.alpha = a[24] ? 0.55 + 0.45 * Math.sin(now * 20) : 1; // just respawned: blinking, can't be hurt
  // hp + armour bar over the head; downed: bleed-out bar and revive ring; opening a chest: a progress ring
  const hp = a[4], key = hp + '|' + st + '|' + a[7] + '|' + a[8] + '|' + a[9]; // a chest's progress ring sits over the chest
  if (key !== v.key) {
    v.key = key;
    const b = v.bar; b.clear();
    if (st === 0) {
      b.roundRect(-24, -80, 48, 8, 4).fill({ color: 0x2a1f3d, alpha: 0.7 }); b.roundRect(-23, -79, 46 * hp / C.HP, 6, 3).fill({ color: hp > 50 ? 0x7fdc5a : hp > 25 ? 0xffc04a : 0xff5a4a });
      if (a[9] > 0) b.roundRect(-23, -85, 46 * a[9] / C.ARMOR, 4, 2).fill({ color: 0x8ab8ff });
    } else { b.roundRect(-24, -80, 48, 8, 4).fill({ color: 0x2a1f3d, alpha: 0.7 }); b.roundRect(-23, -79, 46 * a[7] / C.BLEED, 6, 3).fill({ color: 0xff7a6a }); if (a[8]) ring(b, 0, -30, 26, a[8] / 10 / C.REVIVE_T).stroke({ width: 5, color: 0x9dffb0 }); }
  }
  v.tag.x = x; v.tag.y = y - fl * LIFT - (st === 1 ? -20 : bob + lift);
}
// a progress arc from 12 o'clock (its own path, so it does not join the previous shape)
function ring(g, x, y, r, k) { const a0 = -Math.PI / 2; g.moveTo(x, y - r).arc(x, y, r, a0, a0 + Math.PI * 2 * Math.min(1, k)); return g; }
function setLayer(v, layer) { if (v.layer === layer) return; v.layer = layer; (layer === 'under' ? L.under : L.objects).addChild(v.root); }

/* ---------- the world's moving parts ---------- */
function drawWorld(dt, now, drawT, S) {
  const k = 1 - Math.pow(0.0001, dt), M = G.map;
  const near = []; // players standing near buttons, as drawn
  for (const v of G.views.values()) if (v.root.visible && !v.fallT) near.push(v.root);
  for (const v of G.dev) {
    const d = v.d;
    if (d.type === 'gate') { const want = G.W.on.has(d.id) ? 0.12 : 1; v.k += (want - v.k) * k; v.s.scale.y = v.k; v.s.alpha = 0.5 + v.k * 0.5; }
    else if (d.type === 'bridge') {
      const want = G.W.on.has(d.id) ? 1 : 0; v.k += (want - v.k) * Math.min(1, dt * 7);
      if (v.horiz) v.s.scale.x = Math.max(0.001, v.k); else v.s.scale.y = Math.max(0.001, v.k);
      v.s.visible = v.k > 0.01; v.ghost.visible = v.k < 0.5; v.ghost.alpha = 0.5 + 0.3 * Math.sin(now * 3);
    } else if (d.type === 'drawer') {
      const kk = SIM.drawerK(d, drawT); if (v.horiz) v.s.scale.x = Math.max(0.001, kk); else v.s.scale.y = Math.max(0.001, kk);
      v.s.visible = kk > 0.01; v.ghost.visible = kk < 0.5; v.ghost.alpha = 0.35;
    } else if (d.type === 'plat') {
      const p = SIM.platPos(d, drawT); v.s.x = p.x - d.w / 2 - 4; v.s.y = p.y - d.h / 2 - 4; v.s.zIndex = p.y + d.h / 2;
      v.sh.x = p.x + 40; v.sh.y = p.y + 120;
    } else if (d.type === 'train') {
      const p = SIM.trainPos(d, drawT); v.s.x = p.x - 4; v.s.y = p.y - v.up - 4; v.s.zIndex = p.y + d.h;
    } else if (d.type === 'plate') {
      const down = near.some((r) => Math.hypot(r.x - d.x, r.y - d.y) < C.PLATE_R);
      if (down !== v.down) { v.down = down; v.s.texture = (down ? v.dn : v.up).tex; }
    } else if (d.type === 'lever' || d.type === 'twin') {
      const on = G.W.on.has(d.link);
      v.stick.rotation += ((on ? 0.7 : -0.7) - v.stick.rotation) * Math.min(1, dt * 10);
      v.ring.clear(); const t = G.bt.get(d.link);
      if (t) ring(v.ring, d.x, d.y - 70, 16, t / (d.type === 'twin' ? C.TWIN_T : C.BRIDGE_T)).stroke({ width: 5, color: 0xffe08a, alpha: 0.9 });
    } else if (d.type === 'spin') { const a = SIM.spinAng(d, drawT); v.s.rotation = a; v.shadow.rotation = a; }
    else if (d.type === 'seesaw') { v.tilt = Math.max(0, v.tilt - dt * 2.5); v.s.scale.y = (70 / v.s.texture.height) * (1 + v.tilt * 0.25); }
    else if (d.type === 'fan') {
      v.blades.rotation += dt * 14;
      v.wind.clear(); // streaks rising through the updraft
      for (let i = 0; i < 9; i++) { const ph = (now * 0.9 + i / 9) % 1, x = d.x + 20 + ((i * 37) % (d.w - 40)), y = d.y + d.h - ph * d.h; v.wind.moveTo(x, y).lineTo(x, y - 34); }
      v.wind.stroke({ width: 4, color: 0xbfe4ff, alpha: 0.35, cap: 'round' });
    } else if (d.type === 'sling') {
      v.tilt = Math.max(0, (v.tilt || 0) - dt * 3);
      const pull = (G.sl.get(d.id) || 0) / 10;
      v.band.clear(); v.band.moveTo(d.hx - 26, d.hy - 104).lineTo(d.x, d.y - 10).lineTo(d.hx + 26, d.hy - 104).stroke({ width: 5, color: 0x6cc24a, alpha: 0.9 });
      v.ring.clear(); if (pull) ring(v.ring, d.x, d.y - 60, 18, pull).stroke({ width: 6, color: 0xffe08a });
    }
  }
  // the board's tiles: shaking before they drop, gone for a while, back again
  for (let i = 0; i < 100; i++) {
    const T = G.tiles[i]; if (!T) continue;
    const st = SIM.tileState(M, i, drawT);
    if (st === 1) { T.c.x = (Math.random() - 0.5) * 6; T.c.y = (Math.random() - 0.5) * 4; T.top.tint = 0xffd0c0; }
    else { T.c.x = T.c.y = 0; T.top.tint = 0xffffff; }
    T.k += ((st === 2 ? 0 : 1) - T.k) * Math.min(1, dt * (st === 2 ? 4 : 8));
    T.c.visible = T.k > 0.02; T.c.alpha = T.k; T.c.y += (1 - T.k) * 160;
    // a front face shows where nothing is in front of the tile
    const s = i + 10 < 100 ? i + 10 : -1, open = s < 0 || !G.tiles[s] || SIM.tileState(M, s, drawT) === 2;
    T.fr.visible = open;
  }
  // chests: open or shut; a ring while someone is opening one
  for (const cv of G.chestViews) {
    const c = cv.c;
    if (c.open !== cv.open) { cv.open = c.open; cv.s.texture = G.tex.chest[c.tier][c.open ? 1 : 0].tex; }
    cv.ring.clear();
    if (!c.open) for (const a of S.p.values()) if (a[19] && Math.abs(a[6] - c.z) < 30 && Math.hypot(a[1] - c.x, a[2] - c.y) < C.CHEST_R + 10) { ring(cv.ring, c.x, c.y - 70 - c.z * LIFT, 18, a[19] / 10).stroke({ width: 6, color: 0xffe08a }); break; }
  }
  // things on the floor
  const seen = new Set();
  for (const it of G.items) {
    seen.add(it.id);
    let v = G.itemViews.get(it.id);
    if (!v) {
      G.itemTex = G.itemTex || {};
      const t = G.itemTex[it.k] || (G.itemTex[it.k] = ART.item(it.k));
      v = new PIXI.Container(); const gl = new PIXI.Sprite(G.tex.glowWarm); gl.anchor.set(0.5); gl.width = gl.height = 90; gl.alpha = 0.45; gl.blendMode = 'add';
      const s = new PIXI.Sprite(t); s.anchor.set(0.5); s.width = s.height = 56; v.addChild(gl, s); v.icon = s;
      v.x = it.x; v.y = it.y - it.z * LIFT; v.zIndex = depth(it.x, it.y, it.z); L.objects.addChild(v); G.itemViews.set(it.id, v);
    }
    v.icon.y = -18 + Math.sin(now * 3 + it.id) * 4;
  }
  for (const [id, v] of G.itemViews) if (!seen.has(id)) { v.destroy({ children: true }); G.itemViews.delete(id); }
  // the marble: its lane glows red before it comes
  const mb = SIM.marbleAt(M, drawT);
  L.lane.clear(); L.marble.visible = !!(mb && !mb.warn);
  if (mb) {
    const h = M.half, e = mb.ev, w = C.MARBLE_R * 2 + 20, a = 0.18 + 0.12 * Math.sin(now * 12);
    if (e.axis) L.lane.rect(h + e.off - w / 2, h - C.RING_OUT, w, C.RING_OUT * 2).fill({ color: 0xff5a4a, alpha: a });
    else L.lane.rect(h - C.RING_OUT, h + e.off - w / 2, C.RING_OUT * 2, w).fill({ color: 0xff5a4a, alpha: a });
    if (!mb.warn) { L.marble.x = mb.x; L.marble.y = mb.y - C.MARBLE_R * 0.6; L.marble.zIndex = mb.y + C.MARBLE_R; L.marbleSpr.rotation += dt * (mb.vx + mb.vy) / C.MARBLE_R; }
  }
}

/* ---------- effects ---------- */
function floatText(x, y, text, color) {
  const t = new PIXI.Text({ text, style: { fontFamily: 'Baloo 2', fontWeight: '800', fontSize: 22, fill: color, stroke: { color: '#2a1f3d', width: 5 } } });
  t.anchor.set(0.5); t.x = x + (Math.random() - 0.5) * 20; t.y = y; L.top.addChild(t);
  G.floats.push({ t, life: 0.9 });
}
function puff(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const s = new PIXI.Sprite(G.tex.glowWarm); s.anchor.set(0.5); s.tint = color; s.width = s.height = 16 + Math.random() * 16; s.x = x; s.y = y; s.blendMode = 'add';
    L.fx.addChild(s); const a = Math.random() * 6.28, sp = 60 + Math.random() * 120;
    G.puffs.push({ s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.5 + Math.random() * 0.3 });
  }
}
function updateFx(dt) {
  for (let i = G.floats.length - 1; i >= 0; i--) { const f = G.floats[i]; f.life -= dt; f.t.y -= 40 * dt; f.t.alpha = Math.min(1, f.life * 2); if (f.life <= 0) { f.t.destroy(); G.floats.splice(i, 1); } }
  for (let i = G.puffs.length - 1; i >= 0; i--) { const p = G.puffs[i]; p.life -= dt; p.s.x += p.vx * dt; p.s.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.s.alpha = Math.min(1, p.life * 2); if (p.life <= 0) { p.s.destroy(); G.puffs.splice(i, 1); } }
}
function camera(dt, now) {
  const W = innerWidth, H = innerHeight, M = G.map;
  const z0 = Math.max(W / (TOUCH ? 1300 : 1600), H / (H > W ? 1650 : 950)); // upright phones see further up and down
  const look = IN.look || IN.keys.KeyQ || IN.keys.Tab, peek = IN.peek;
  const zw = look ? Math.min(W / (M.w - 300), H / (M.h - 300)) : peek ? z0 * 0.6 : z0; // the whole desk, or a wider look around
  G.cam.zs = G.cam.zs || z0; G.cam.zs *= Math.pow(zw / G.cam.zs, 1 - Math.pow(0.002, dt));
  const z = G.cam.zs; G.cam.z = z; G.cam.far = z < z0 * 0.8;
  let tx = G.vis.x, ty = G.vis.y - 30 - G.vis.z * LIFT;
  if (look) { tx = M.w / 2; ty = M.h / 2; }
  else if (peek) { tx = peek[0]; ty = peek[1]; }
  else if (!TOUCH) { tx += (IN.mx - W / 2) / z * 0.18; ty += (IN.my - H / 2) / z * 0.18; }
  const meA = G.last && G.last.p.find((p) => p[0] === G.myId);
  if (meA && meA[5] === 2 && !look && !peek) { // waiting to respawn: watch the partner
    const v = G.views.get(mateOf(G.myId)); if (v && v.root.visible) { tx = v.root.x; ty = v.root.y - 30; }
  }
  const k = 1 - Math.pow(look || peek ? 0.00002 : 0.0008, dt);
  G.cam.x += (tx - G.cam.x) * k; G.cam.y += (ty - G.cam.y) * k;
  // zoomed out: big team-coloured markers, so everyone can be found at a glance
  const mk = L.marks; mk.clear();
  if (G.cam.far) {
    const r = 12 / z, mine = G.info.get(G.myId);
    for (const [id, v] of G.views) {
      if (!v.root.visible) continue; const I = G.info.get(id); if (!I) continue;
      const me = id === G.myId;
      mk.circle(v.root.x, v.root.y - 20, me ? r * 1.4 : r).fill({ color: me ? 0xffe08a : teamCol(I.team) }).stroke({ width: 3 / z, color: mine && I.team === mine.team ? 0xffffff : 0x2a1f3d });
    }
  }
  let sx = 0, sy = 0; if (G.shake > 0) { sx = (Math.random() - 0.5) * G.shake; sy = (Math.random() - 0.5) * G.shake; G.shake *= Math.pow(0.001, dt); if (G.shake < 0.3) G.shake = 0; }
  L.world.scale.set(z); L.world.x = W / 2 - G.cam.x * z + sx; L.world.y = H / 2 - G.cam.y * z + sy;
  // the floor below drifts slower than the desk: it is far away
  const V = L.voidBase; L.void.x = V.x + (G.cam.x - G.map.w / 2) * 0.22; L.void.y = V.y + (G.cam.y - G.map.h / 2) * 0.22;
}
function screenFx(dt, now) {
  const W = innerWidth, H = innerHeight;
  const key = W + 'x' + H; if (G.vigSize !== key) { G.vigSize = key; if (L.vig.texture && L.vig.texture !== PIXI.Texture.EMPTY) L.vig.texture.destroy(true); L.vig.texture = ART.vignette(Math.ceil(W / 2), Math.ceil(H / 2)); L.vig.width = W; L.vig.height = H; }
  for (const r of G.rays) { r.s.x = (r.x - G.cam.x / G.map.w * 0.25) * W * 1.3; r.s.y = -H * 0.1; r.s.width = W * (0.08 + 0.04 * Math.sin(now * 0.3 + r.ph)); r.s.height = H * 1.5; r.s.alpha = 0.06 + 0.04 * Math.sin(now * 0.5 + r.ph); }
  for (const d of G.dust) {
    d.x += d.vx * dt + Math.sin(now * 0.7 + d.ph) * 0.0006; d.y += d.vy * dt; if (d.y < -0.05) d.y = 1.05; if (d.x > 1.05) d.x = -0.05; if (d.x < -0.05) d.x = 1.05;
    d.s.x = ((d.x - G.cam.x / G.map.w * 0.3 * d.depth) % 1 + 1) % 1 * W; d.s.y = ((d.y - G.cam.y / G.map.h * 0.3 * d.depth) % 1 + 1) % 1 * H; d.s.alpha = Math.max(0, (0.15 + 0.3 * Math.sin(now * 1.3 + d.ph))) * Math.min(1, d.depth * 2);
  }
}

/* ---------- HUD ---------- */
let hudKey = '', hintKey = '';
function hud(S, now, drawT) {
  const mineI = G.info.get(G.myId); if (!mineI || !G.last) return;
  const W = G.last, me = S.p.get(G.myId);
  // the duo
  const mates = [...G.info.entries()].filter(([, I]) => I.team === mineI.team).sort((a) => (a[0] === G.myId ? -1 : 1));
  let duo = '';
  for (const [id, I] of mates) {
    const a = S.p.get(id); if (!a) continue;
    const st = a[5], w = st === 0 ? a[4] / C.HP * 100 : st === 1 ? a[7] / C.BLEED * 100 : 0;
    const tag = st === 1 ? ' · <span style="color:#e5484d">gục</span>' : st === 2 ? ` · hồi sinh ${a[20]}s` : a[17] > 0 ? ' · đang rơi' : '';
    duo += `<div class="mate${st === 1 ? ' down' : st === 2 ? ' out' : ''}"><i style="background:${teamCol(I.team)}"></i><div>${esc(I.name)}${id === G.myId ? ' (bạn)' : ''}${tag}<div class="bar"><b style="width:${w}%"></b>${a[9] > 0 ? `<s style="width:${a[9] / C.ARMOR * 100}%"></s>` : ''}</div></div></div>`;
  }
  // scores and time; the leading duo wears a crown
  const top = Math.max(...W.sc), zn = top > 0 && W.sc.filter((x) => x === top).length === 1 ? W.sc.indexOf(top) : -1;
  let chips = `<span class="time">${Math.floor(W.tl / 60)}:${String(W.tl % 60).padStart(2, '0')}</span>`;
  for (let t = 0; t < G.teams; t++) chips += `<span class="chip${t === mineI.team ? ' me' : ''}${t === zn ? ' own' : ''}"><i style="background:${teamCol(t)}"></i>${W.sc[t] || 0}${t === zn ? ' ♛' : ''}</span>`;
  const win = G.scoreWin || C.SCORE_WIN, lead = zn < 0 ? (top > 0 ? 'Đang hoà điểm' : 'Chưa ai ghi điểm') : zn === mineI.team ? '<b>Đội bạn</b> đang dẫn' : `${teamName(zn)} đang dẫn`;
  const status = `Đẩy địch rơi = +1 điểm · ${lead} · ${win} điểm là thắng`;
  const wpn = me ? SIM.WEAPONS[me[15]] : SIM.WEAPONS[0];
  const weapon = `${wpn.name}<b>${me && me[15] ? me[16] : '∞'}</b>`;
  const info = `Đẩy rơi <b>${me ? me[14] : 0}</b> · Bị loại ${me ? me[25] : 0}`;
  const key = duo + chips + status + weapon + info;
  if (key !== hudKey) {
    hudKey = key;
    $('duo').innerHTML = duo; $('score').innerHTML = chips; $('status').innerHTML = status; $('weapon').innerHTML = weapon; $('info').innerHTML = info;
    $('status').classList.toggle('warn', zn >= 0 && zn !== mineI.team && top >= win - 3);
  }
  const h = hint(me, S, drawT);
  if (h !== hintKey) { hintKey = h; $('hint').innerHTML = h; $('hint').classList.toggle('hidden', !h); }
  if (now - (G.miniT || 0) > 0.2) { G.miniT = now; minimap(S); }
}
// what to do right here, in plain words
function hint(a, S, drawT) {
  if (!a) return '';
  const M = G.map, x = G.vis.x, y = G.vis.y, z = G.vis.z, mate = mateOf(G.myId), q = S.p.get(mate);
  const d2 = (px, py) => Math.hypot(px - x, py - y);
  const mine = G.info.get(G.myId), r = SIM.routeOf(mine.team);
  if (a[5] === 2) return q && q[5] === 0 ? `Hồi sinh sau ${a[20]}s, cạnh đồng đội` : `Cả đội bị hạ: về lại hộp xuất phát sau ${a[20]}s`;
  if (a[5] === 1) return 'Bạn bị gục: chờ đồng đội tới kéo dậy';
  if (a[17] > 0 || a[18]) return '';
  if (q && q[5] === 1 && Math.hypot(q[1] - x, q[2] - y) < 600) return 'Đồng đội bị gục: tới đứng cạnh để kéo dậy!';
  for (const d of M.dev) if (d.type === 'lever' && d2(d.x, d.y) < C.LEVER_R + 30 && !G.W.on.has(d.link)) return `Nhấn <kbd>${KEY_USE}</kbd> gạt cần: hạ cầu thước kẻ cho đồng đội`;
  for (const d of M.dev) if (d.type === 'twin' && d2(d.x, d.y) < C.LEVER_R + 30 && !G.W.on.has(d.link)) return `Hai cần gạt phải gạt <b>cùng lúc</b>: mỗi người đứng một cần, đếm 1-2-3 rồi nhấn <kbd>${KEY_USE}</kbd>`;
  for (const d of M.dev) if (d.type === 'sling') {
    if (d2(d.hx, d.hy) < 50) return `Ná khổng lồ: giữ <kbd>${KEY_USE}</kbd> và ngắm hướng bắn, đồng đội đứng vào túi ná (vòng vàng)`;
    if (d2(d.x, d.y) < 40) return `Bạn đang đứng trong túi ná: đồng đội giữ <kbd>${KEY_USE}</kbd> ở tay cầm để bắn bạn bay đi`;
  }
  if (a[15]) for (const it of G.items) if (it.k[0] === 'w' && Math.abs(it.z - z) < 30 && d2(it.x, it.y) < C.PICK_R + 10) return `Nhấn <kbd>${KEY_USE}</kbd> đổi sang ${SIM.WEAPONS[+it.k[1]].name}`;
  for (const c of M.chests) if (!c.open && Math.abs(c.z - z) < 30 && d2(c.x, c.y) < C.CHEST_R + 20) return `Giữ <kbd>${KEY_USE}</kbd> để mở rương`;
  for (const d of M.dev) if (d.type === 'plate' && d2(d.x, d.y) < C.PLATE_R) return 'Bạn đang giữ nút: đường đang mở cho đồng đội';
  if (a[26]) return `Bạn đang làm bệ đỡ: đồng đội chạy tới nhảy cạnh bạn để bật cao`;
  const mb = SIM.marbleAt(M, drawT);
  if (mb && mb.warn) return 'Bi khổng lồ sắp lăn: tránh khỏi vệt đỏ!';
  for (const d of M.dev) {
    if (d.route !== r && d.mod < 10) continue;
    if (d.type === 'gate' && !G.W.on.has(d.id) && d2(d.x + d.w / 2, d.y + d.h / 2) < 200) return 'Cổng bút chì đóng: một người đứng lên nút tròn để mở cho bạn kia';
    if (d.type === 'bridge' && M.course[d.mod] && M.course[d.mod].name === 'boost' && !G.W.on.has(d.id) && d2(d.x + d.w / 2, d.y + d.h / 2) < 230) {
      const side = (px, py) => SIM.modLocal(M, d.route, d.mod, px, py)[0] > 120; // past the gap or not
      if (q && q[5] !== 2 && side(x, y) && !side(q[1], q[2])) return `Đồng đội còn kẹt bên kia: tới cần gạt gần đây, nhấn <kbd>${KEY_USE}</kbd> để hạ cầu`;
      if (q && q[26] && Math.hypot(q[1] - x, q[2] - y) < 260) return Math.hypot(q[1] - x, q[2] - y) < C.BOOST_R ? `Nhảy <kbd>${KEY_JUMP}</kbd> ngay: bạn sẽ bật về hướng đang chạy (hoặc hướng ngắm)` : `Đồng đội đang làm bệ: vào vòng xanh quanh bạn ấy rồi nhảy <kbd>${KEY_JUMP}</kbd>`;
      return `Khe quá rộng: một người giữ <kbd>${KEY_USE}</kbd> làm bệ đỡ, người kia nhảy cạnh để bật cao`;
    }
    if (d.type === 'seesaw' && d2((d.ax + d.bx) / 2, (d.ay + d.by) / 2) < 220) return d.mod === 10 ? 'Bập bênh hất thẳng lên tháp sách: một người đứng ô xanh, người kia nhảy lên ô cam' : 'Bập bênh: một người đứng ô xanh, người kia nhảy lên ô cam để hất bạn bay qua';
    if (d.type === 'bridge' && M.course[d.mod] && M.course[d.mod].name === 'seesaw' && !G.W.on.has(d.id) && d2(d.x + d.w / 2, d.y + d.h / 2) < 260) return 'Đứng nút tròn để giữ cầu cho đồng đội qua';
    if (d.type === 'drawer' && d2(d.x + d.w / 2, d.y + d.h / 2) < 260) return 'Ngăn kéo thò ra thụt vào: chờ nó thò ra hết rồi chạy qua thật nhanh';
    if (d.type === 'fan' && d2(d.x + d.w / 2, d.y + d.h / 2) < 300) return 'Cứ chạy thẳng ra luồng gió của quạt: gió sẽ nâng bạn bay qua';
    if (d.type === 'train' && d2(d.x0 + d.w / 2, (d.y0 + d.y1) / 2) < 260) return 'Tàu đồ chơi chạy ngang: canh lúc tàu chạy qua rồi băng qua đường ray';
    if (d.type === 'spin' && d2(d.x, d.y) < 220) return `Bút chì quay: nhảy <kbd>${KEY_JUMP}</kbd> qua khi nó quét tới`;
    if (d.type === 'plat' && d2(d.x0, d.y0) < 200) return 'Đợi nắp lọ cập bờ rồi bước lên';
  }
  const lx = x - M.half, ly = y - M.half, onBoard = Math.abs(lx) < C.BOARD && Math.abs(ly) < C.BOARD, onRing = !onBoard && Math.abs(lx) < C.RING_OUT && Math.abs(ly) < C.RING_OUT;
  if (onRing) return `Vào bàn cờ: đi cầu thước ở giữa cạnh, hoặc giữ <kbd>${KEY_USE}</kbd> làm bệ cho bạn nhảy qua khe. Rơi khỏi bàn cờ là bị loại!`;
  if (q && q[26] && Math.hypot(q[1] - x, q[2] - y) < 260) return `Đồng đội đang làm bệ: vào vòng xanh quanh bạn ấy, hướng về phía muốn bay rồi nhảy <kbd>${KEY_JUMP}</kbd>`;
  if (onBoard && z < 60) for (const T of M.towers) {
    if (Math.hypot(T.x + T.w / 2 - x, T.y + T.h / 2 - y) > 260) continue;
    if (M.chests.some((c) => c.tier && c.z && !G.last.c.includes(c.id) && Math.abs(c.x - T.x - T.w / 2) < 60 && Math.abs(c.y - T.y - T.h / 2) < 60)) return `Rương vàng trên tháp: một người giữ <kbd>${KEY_USE}</kbd> làm bệ sát chân tháp, người kia nhảy từ vòng xanh để lên`;
  }
  if (onBoard && a[4] < 40) return 'Bạn đang yếu: trúng đòn sẽ văng rất xa, lùi vào giữa bàn hoặc nhặt băng dán';
  if (onBoard) return 'Bắn đẩy địch về phía mép bàn: rơi xuống là +1 điểm. Càng mất máu càng văng xa!';
  return '';
}
function minimap(S) {
  const c = $('miniCv'), g = c.getContext('2d'), M = G.map, k = c.width / M.w;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#4a2a3e'; g.fillRect(0, 0, c.width, c.height);
  for (const o of M.ground) { g.fillStyle = o.kind === 'box' ? teamCol(o.route) : o.kind === 'tower' ? '#8e5bd6' : o.kind === 'ring' ? '#b0743f' : '#d79a5c'; g.fillRect(o.x * k, o.y * k, Math.max(1, o.w * k), Math.max(1, o.h * k)); }
  g.fillStyle = '#f4e7c9'; for (const t of M.tiles) if (t && SIM.tileState(M, t.tile, G.predT) < 2) g.fillRect(t.x * k, t.y * k, t.w * k + 0.5, t.h * k + 0.5);
  g.fillStyle = '#ffe08a'; for (const d of M.dev) if (d.type === 'bridge' && G.W.on.has(d.id)) g.fillRect(d.x * k, d.y * k, Math.max(1, d.w * k), Math.max(1, d.h * k));
  g.strokeStyle = '#2a1f3d';
  const mine = G.info.get(G.myId);
  for (const [id, a] of S.p) {
    const I = G.info.get(id); if (!I || a[5] === 2) continue;
    const x = id === G.myId ? G.vis.x : a[1], y = id === G.myId ? G.vis.y : a[2], ally = I.team === mine.team;
    g.fillStyle = id === G.myId ? '#ffe08a' : teamCol(I.team); g.lineWidth = ally ? 2 : 1.5;
    g.beginPath(); g.arc(x * k, y * k, id === G.myId ? 5.5 : ally ? 4.5 : 3.5, 0, 7); g.fill(); g.stroke();
  }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function feed(text) { const d = document.createElement('div'); d.textContent = text; $('feed').prepend(d); setTimeout(() => d.remove(), 4100); while ($('feed').children.length > 5) $('feed').lastChild.remove(); }
let msgT = 0;
function flashMsg(a, b) { $('msg').innerHTML = esc(a) + (b ? `<small>${esc(b)}</small>` : ''); clearTimeout(msgT); msgT = setTimeout(() => { $('msg').innerHTML = ''; }, 2600); }

/* ---------- end / menu ---------- */
function showEnd(m) {
  G.state = 'end';
  const mine = G.info.get(G.myId), myRow = m.table.find((r) => r[0] === G.myId);
  const teams = [];
  for (let t = 0; t < m.scores.length; t++) {
    const rows = m.table.filter((r) => r[1] === t);
    teams.push({ t, score: m.scores[t], place: rows.length ? rows[0][2] : 99, names: rows.map((r) => (G.info.get(r[0]) || { name: '?' }).name), kills: rows.reduce((s, r) => s + r[3], 0) });
  }
  teams.sort((a, b) => a.place - b.place);
  setTimeout(() => {
    $('endTitle').textContent = mine && m.winner === mine.team ? 'Đôi bạn chiến thắng!' : m.winner < 0 ? 'Hoà điểm!' : `${teamName(m.winner)} thắng`;
    $('endRank').textContent = '#' + (myRow ? myRow[2] : '?');
    $('endTable').innerHTML = '<tr><td><b>Hạng</b></td><td><b>Đội</b></td><td><b>Điểm</b></td><td><b>Đẩy rơi</b></td></tr>' + teams.map((T) => `<tr class="${mine && T.t === mine.team ? 'me' : ''}"><td>#${T.place}</td><td><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${teamCol(T.t)}"></i> ${esc(T.names.join(' & '))}</td><td>${T.score}</td><td>${T.kills}</td></tr>`).join('');
    $('end').classList.remove('hidden');
  }, 1600);
}
// pause card: the match goes on (it is online); leaving hands your doll to a bot
function pauseMenu(on) { if (G.state !== 'play') on = false; $('pause').classList.toggle('hidden', !on); if (on) { IN.keys = {}; IN.fire = false; } }
function quitMatch() { sendMsg({ t: 'leave' }); pauseMenu(false); G.snaps = []; G.pend = []; toMenu(); }
function toMenu() {
  G.state = 'menu';
  $('hud').classList.add('hidden'); $('end').classList.add('hidden'); $('pause').classList.add('hidden'); $('start').classList.remove('hidden');
  homeView('main');
  if (window.R3D && R3D.on && R3D.menu) R3D.menu(true); // [3D] the live desk behind the home card
}

/* ---------- home: quick play, private rooms (create / join by code), the lobby ---------- */
function homeView(v) { // main | join | lobby
  $('homeMain').classList.toggle('hidden', v !== 'main'); $('homeJoin').classList.toggle('hidden', v !== 'join');
  $('lobby').classList.toggle('hidden', v !== 'lobby'); $('nameIn').classList.toggle('hidden', v === 'lobby'); homeErr('');
  if (v === 'join') setTimeout(() => $('codeIn').focus(), 0);
}
function homeStats(m) { // who is around, so a quick match is more likely to find real people
  const el = $('homeStats'), others = Math.max(0, m.on - 1);
  el.classList.remove('hidden');
  el.innerHTML = others ? `<i></i><b>${m.on}</b> người đang online · <b>${m.wait}</b> đang tìm trận · <b>${m.play}</b> đang chơi${m.wait ? '<small>Bấm Chơi nhanh ngay để vào cùng trận!</small>' : ''}`
    : `<i></i>Chỉ có bạn đang online<small>Chơi nhanh cùng bot, hoặc Tạo phòng rồi gửi link cho bạn bè</small>`;
}
function homeErr(t) { $('homeErr').textContent = t; $('homeErr').classList.toggle('hidden', !t); }
function lobbyText(t) { homeView('lobby'); $('lobby').textContent = t; }
function lobbyView(m) {
  const L = $('lobby');
  if (!m.code) { // quick play: a countdown, then bots fill the room
    L.innerHTML = `Đang ghép trận ${m.n}/${m.size} · bắt đầu sau <b>${m.wait}s</b><br><small>chỗ trống sẽ có bot vào cùng</small><div class="dots">${Array.from({ length: m.size }, (_, i) => `<i class="dot${i < m.n ? ' on' : ''}"></i>`).join('')}</div><button class="btn ghost" data-act="leave">Huỷ</button>`;
    return;
  }
  // a private room: the code to share, the duos in join order, and the host's start button
  let duos = '';
  for (let t = 0; t < m.size / 2; t++) {
    const a = m.names[t * 2], b = m.names[t * 2 + 1], who = (x) => x ? esc(x[1]) + (x[0] === m.host ? ' ★' : '') + (x[0] === G.myId ? ' (bạn)' : '') : '<span class="bot">bot</span>';
    duos += `<div><i style="background:${teamCol(t)}"></i>${who(a)} &amp; ${who(b)}</div>`;
  }
  const host = m.host === G.myId;
  L.innerHTML = `<div class="room"><div class="small">Mã phòng</div><div class="code">${m.code}</div><button class="share" data-act="share">Sao chép link mời</button>
    <div class="duos">${duos}</div><div class="small">Vào theo thứ tự, cứ hai người là một đội. Chỗ trống sẽ là bot.</div>
    ${host ? '<button class="btn" data-act="start">Bắt đầu</button>' : '<div class="small" style="margin-top:12px">Chờ chủ phòng (★) bắt đầu…</div>'}
    <button class="btn ghost" data-act="leave">Rời phòng</button></div>`;
  G.roomCode = m.code;
}
async function play(mode, code) {
  SFX.init();
  const name = $('nameIn').value.trim() || 'Người chơi'; store.set('name', name);
  G.mode = mode || 'quick';
  $('end').classList.add('hidden'); $('start').classList.remove('hidden');
  lobbyText('Đang kết nối…');
  try { await connect(); } catch (e) { G.state = 'menu'; homeView(G.mode === 'join' ? 'join' : 'main'); homeErr('Không kết nối được máy chủ. Thử lại nhé.'); return; }
  sendMsg({ t: 'play', name, mode: G.mode, code });
}
function joinByCode() { const c = $('codeIn').value.trim().toUpperCase(); if (c.length !== 4) return homeErr('Mã phòng có 4 chữ cái'); play('join', c); }

/* ---------- boot ---------- */
(async function boot() {
  $('nameIn').value = store.get('name', '');
  try { await document.fonts.ready; } catch (e) { /* fonts are optional */ }
  // [3D] three.js by default; ?2d, no WebGL or no three.js: the PixiJS scene
  if (!new URLSearchParams(location.search).has('2d')) await R3D.load($('app'));
  const app = new PIXI.Application();
  if (R3D.on) await app.init({ width: 2, height: 2, background: '#2a1f3d', resolution: 1 }); // only its ticker is used
  else await app.init({ resizeTo: window, antialias: true, background: '#2a1f3d', resolution: Math.min(devicePixelRatio || 1, TOUCH ? 1.5 : 2), autoDensity: true });
  if (R3D.on) app.stage.visible = false; else $('app').appendChild(app.canvas);
  G.app = app;
  const fanCache = {};
  G.tex = { shadow: ART.shadowBlob(), glowWarm: ART.glow(128, '255,220,170', 1), mote: ART.glow(32, '255,236,200', 1), ray: ART.ray(),
    leverBase: ART.leverBase(), leverStick: ART.leverStick(), pencil: ART.pencil(110), pin: ART.pin(), sling: ART.sling(), marble: ART.marble(C.MARBLE_R),
    fanBase: (r) => fanCache['b' + r] || (fanCache['b' + r] = ART.fanBase(r)), fanBlades: (r) => fanCache['f' + r] || (fanCache['f' + r] = ART.fanBlades(r)),
    chest: [[ART.chest(0, false), ART.chest(0, true)], [ART.chest(1, false), ART.chest(1, true)]] };
  app.ticker.add(frame);
  $('playBtn').onclick = () => play('quick'); $('againBtn').onclick = () => (G.mode === 'quick' ? play('quick') : toMenu());
  $('createBtn').onclick = () => play('create'); $('joinBtn').onclick = () => homeView('join');
  $('joinGo').onclick = joinByCode; $('joinBack').onclick = () => homeView('main');
  $('codeIn').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(); });
  $('lobby').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
    if (act === 'start') sendMsg({ t: 'start' });
    else if (act === 'leave') { sendMsg({ t: 'leave' }); G.state = 'menu'; homeView('main'); }
    else if (act === 'share') {
      const url = location.origin + location.pathname + '?room=' + G.roomCode;
      const done = () => { e.target.textContent = 'Đã sao chép!'; setTimeout(() => { e.target.textContent = 'Sao chép link mời'; }, 1600); };
      if (navigator.share && TOUCH) navigator.share({ title: 'Tiny Tumble', text: 'Vào phòng ' + G.roomCode + ' chơi Tiny Tumble với mình nhé!', url }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Link mời', url)); else prompt('Link mời', url);
    }
  });
  const invite = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (invite) { $('codeIn').value = invite; homeView('join'); }
  document.documentElement.classList.toggle('r3d', !!R3D.on);
  if (R3D.on && R3D.menu) R3D.menu(true); // [3D] the live desk behind the home card
  connect().catch(() => {}); // early: the home screen shows who is online (and a sleeping server starts waking up)
  $('menuBtn').onclick = () => pauseMenu(true); $('resumeBtn').onclick = () => pauseMenu(false); $('quitBtn').onclick = quitMatch;
  $('nameIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') play('quick'); });
})();
