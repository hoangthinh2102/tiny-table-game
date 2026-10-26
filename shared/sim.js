'use strict';
/* ===== Tiny Tumble — shared simulation (the server runs it for real, the client runs SIM.move to predict) =====
   Duos start on the four corners of a giant desk and race over the furniture to a board game in the middle.
   - The route is built per match from modules (stepping blocks, a button gate, a boost gap, lids, a seesaw, a
     drawer, a fan, a toy train, twin levers...). Half of them need both partners. The route is the same for every
     duo (turned a quarter for each corner). Falling off on the way costs health and a trip back to the checkpoint.
   - All routes end on a ring around the board. Bridges, boosts and seesaws lead onto the board, which has holes,
     crumbling tiles, four book towers (only a boost gets you up), giant slingshots for two and a rolling marble.
     Falling off the board knocks you out.
   - Points come from knock-offs: an enemy who falls off anything within a few seconds of being hit by your duo scores
     a point for it. The weapons push more than they hurt, and the more hurt you are, the further you fly.
   Moving parts (lids, drawers, trains, pencils, the marble, crumbling tiles) are functions of time and the
   match seed, so the client draws and predicts them without being told. */
(function (root) {
  const SIM = {};
  const TICK = 30;                 // simulation steps per second
  const C = {
    TICK, DT: 1 / TICK,
    R: 18,                         // player radius
    SPEED: 290, BOOST_SPEED: 370, DOWN_SPEED: 80,
    HP: 100, ARMOR: 50, HEAL: 40,
    GRAV: 2400, JUMP_VZ: 780, BOOST_VZ: 1320, BOOST_R: 110, COYOTE: 0.12, STEP: 14,
    FALL_T: 0.9, FALL_DMG: 20,
    BLEED: 12, REVIVE_T: 2.4, REVIVE_R: 72, REVIVE_HP: 40, RESPAWN_T: 6, SPAWN_INV: 1.5,
    CHEST_R: 66, CHEST_SIZE: 28, CHEST_T: 0.9, GOLD_T: 1.4, CHEST_BACK: 45, GOLD_BACK: 35,
    PICK_R: 44, ITEM_LIFE: 40,
    PLATE_R: 44, LEVER_R: 64, BRIDGE_T: 25, TWIN_T: 20, TWIN_WINDOW: 1.2,
    SPIN_DMG: 12, SPIN_PUSH: 470, SPIN_Z: 40,
    FAN_UP: 150, FAN_TOP: 240,
    TRAIN_DMG: 10, TRAIN_PUSH: 760,
    SLING_T: 0.5, SLING_CD: 4, SLING_RANGE: 620, SHOCK_R: 150, SHOCK_DMG: 12, SHOCK_PUSH: 650,
    MARBLE_R: 70, MARBLE_SPEED: 650, MARBLE_DMG: 25, MARBLE_PUSH: 1000, MARBLE_WARN: 3,
    CRUMBLE_WARN: 3, CRUMBLE_T: 18,
    KO_T: 5, KB_HURT: 1.5, KB_DOWN: 2.2, KB_HOP: 460, LAG_MAX: 9, MATCH_T: 360, SCORE_WIN: 15,
    BOARD: 650, TILE: 130, RING_IN: 900, RING_OUT: 1120, TOWER_Z: 140,
    PLAT_PERIOD: 7.6, PLAT_DWELL: 1.3,
  };
  SIM.C = C;

  // toy weapons; 0 is the slingshot everyone keeps, the rest come from chests with limited ammo. kb: push per hit
  const WEAPONS = [
    { name: 'Ná cao su', dmg: 9, kb: 190, cd: 0.36, speed: 950, life: 0.5, n: 1, spread: 0.03, ammo: 0 },
    { name: 'Súng sáp màu', dmg: 6, kb: 70, cd: 0.1, speed: 1150, life: 0.5, n: 1, spread: 0.08, ammo: 70 },
    { name: 'Súng dây chun', dmg: 7, kb: 130, cd: 0.75, speed: 950, life: 0.3, n: 6, spread: 0.34, ammo: 14 },
    { name: 'Súng ghim', dmg: 34, kb: 300, cd: 1.0, speed: 1800, life: 0.62, n: 1, spread: 0, ammo: 10 },
    { name: 'Bom bi ve', dmg: 40, kb: 820, cd: 0.9, speed: 620, life: 0.62, n: 1, spread: 0, ammo: 6, boom: 125, lob: true },
    { name: 'Súng hơi bóng bay', dmg: 3, kb: 320, cd: 0.9, speed: 900, life: 0.24, n: 5, spread: 0.5, ammo: 10 },
    { name: 'Búa đồ chơi', dmg: 7, kb: 470, cd: 0.6, speed: 1000, life: 0.11, n: 3, spread: 1.2, ammo: 20, melee: true },
  ];
  SIM.WEAPONS = WEAPONS;

  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  SIM.rng = rng;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  SIM.clamp = clamp;
  const ease = (k) => k * k * (3 - 2 * k);

  /* ---------- route modules ----------
     Each module is laid out along its own axis: u forward (0 at its start, len at its end), v sideways (-150..150).
     Before u = 0 is the previous module's last surface; every module ends on a surface of at least 200 x 300. */
  const MODS = {
    steps: { len: 900, coop: false, ground: [
      { u: 115, v: -75, w: 150, h: 150, kind: 'block', cp: [190, 0] },
      { u: 380, v: -35, w: 150, h: 150, kind: 'block', cp: [455, 40] },
      { u: 645, v: -150, w: 255, h: 300, kind: 'book', cp: [720, 0] }], dev: [] },
    gate: { len: 450, coop: true, ground: [
      { u: 0, v: -150, w: 225, h: 300, kind: 'book', cp: [60, 0] },
      { u: 225, v: -150, w: 225, h: 300, kind: 'book', cp: [390, 0] }],
    dev: [{ type: 'plate', key: 'p1', u: 100, v: 110, link: 'gate' }, { type: 'plate', key: 'p2', u: 335, v: -110, link: 'gate' }, { type: 'gate', key: 'gate', u: 210, v: -150, w: 30, h: 300 }] },
    boost: { len: 560, coop: true, ground: [{ u: 250, v: -150, w: 310, h: 300, kind: 'velvet', cp: [300, 100] }],
      dev: [{ type: 'bridge', key: 'br', u: -5, v: -45, w: 260, h: 90 }, { type: 'lever', key: 'lv', u: 520, v: 120, link: 'br' }] },
    spin: { len: 520, coop: false, ground: [{ u: 0, v: -150, w: 520, h: 300, kind: 'tin', cp: [40, 110] }], dev: [{ type: 'spin', key: 'sp', u: 170, v: 0, len: 110, speed: 1.35 }] },
    lids: { len: 700, coop: false, ground: [{ u: 450, v: -150, w: 250, h: 300, kind: 'book', cp: [520, 0] }],
      dev: [{ type: 'plat', key: 'm1', w: 120, h: 120, u0: 60, v0: -70, u1: 390, v1: -70, phase: 0 }, { type: 'plat', key: 'm2', w: 120, h: 120, u0: 60, v0: 70, u1: 390, v1: 70, phase: 0.5 }] },
    seesaw: { len: 940, coop: true, ground: [{ u: 0, v: -150, w: 280, h: 300, kind: 'tin', cp: [60, 0] }, { u: 690, v: -150, w: 250, h: 300, kind: 'box2', cp: [740, 0] }],
      dev: [{ type: 'seesaw', key: 'ss', au: 150, av: -80, bu: 150, bv: 80, tu: 760, tv: 0 }, { type: 'bridge', key: 'br', u: 275, v: -45, w: 420, h: 90 }, { type: 'plate', key: 'p3', u: 880, v: 110, link: 'br' }] },
    drawer: { len: 560, coop: false, ground: [{ u: 300, v: -150, w: 260, h: 300, kind: 'book', cp: [360, 0] }],
      dev: [{ type: 'drawer', key: 'dr', u: -5, v: -60, w: 310, h: 120, period: 5, duty: 0.5 }] },
    fan: { len: 600, coop: false, ground: [{ u: 340, v: -150, w: 260, h: 300, kind: 'tin', cp: [400, 0] }], dev: [{ type: 'fan', key: 'fan', u: 0, v: -120, w: 290, h: 240 }] },
    train: { len: 705, coop: false, ground: [
      { u: 0, v: -150, w: 125, h: 300, kind: 'rails', cp: [60, 0] }, { u: 125, v: -150, w: 110, h: 300, kind: 'rails' },
      { u: 235, v: -150, w: 140, h: 300, kind: 'rails', cp: [305, 0] }, { u: 375, v: -150, w: 110, h: 300, kind: 'rails' },
      { u: 485, v: -150, w: 220, h: 300, kind: 'rails', cp: [600, 0] }],
    dev: [{ type: 'train', key: 't1', u: 180, w: 110, h: 70, amp: 330, period: 4.2, phase: 0 }, { type: 'train', key: 't2', u: 430, w: 110, h: 70, amp: 330, period: 4.2, phase: 0.5 }] },
    twin: { len: 960, coop: true, ground: [{ u: 0, v: -270, w: 300, h: 540, kind: 'box2', cp: [60, 0] }, { u: 700, v: -150, w: 260, h: 300, kind: 'book', cp: [760, 0] }],
      dev: [{ type: 'twin', key: 'l1', u: 240, v: -230, link: 'br', pair: 'l2' }, { type: 'twin', key: 'l2', u: 240, v: 230, link: 'br', pair: 'l1' }, { type: 'bridge', key: 'br', u: 295, v: -45, w: 410, h: 90 }] },
  };
  SIM.MODS = MODS;

  // the order of modules for a match: two leg of four, each alternating one on your own and one for two
  SIM.course = function (seed) {
    const R = rng(seed ^ 0xc0ffee);
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const coop = shuffle(Object.keys(MODS).filter((k) => MODS[k].coop)), solo = shuffle(Object.keys(MODS).filter((k) => !MODS[k].coop));
    return [[solo[0], coop[0], solo[1], coop[1]], [solo[2], coop[2], solo[3], coop[3]]];
  };

  // quarter turns around the table centre
  const rot = (x, y, r) => (r === 0 ? [x, y] : r === 1 ? [-y, x] : r === 2 ? [-x, -y] : [y, -x]);
  SIM.rot = rot;
  SIM.toLocal = (m, x, y, r) => rot(x - m.half, y - m.half, (4 - r) % 4);
  SIM.toWorld = (m, x, y, r) => { const [a, b] = rot(x, y, r); return [a + m.half, b + m.half]; };
  const rotRect = (o, r, H) => {
    const [ax, ay] = rot(o.x, o.y, r), [bx, by] = rot(o.x + o.w, o.y + o.h, r);
    return { x: Math.min(ax, bx) + H, y: Math.min(ay, by) + H, w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  };
  // module coordinates <-> the top-left route's coordinates (k: 0 start box, 1-4 first leg, 5 corner, 6-9 second leg)
  function legOf(m, k) { const c = m.course[k]; return c.leg === 1 ? [m.ox1 + c.U, m.oy1, 1] : [m.ox2, m.oy2 + c.U, 2]; }
  SIM.modToLocal = (m, k, u, v) => { const [ox, oy, leg] = legOf(m, k); return leg === 1 ? [ox + u, oy + v] : [ox - v, oy + u]; };
  SIM.localToMod = (m, k, x, y) => { const [ox, oy, leg] = legOf(m, k); return leg === 1 ? [x - ox, y - oy] : [y - oy, ox - x]; };
  SIM.modWorld = (m, r, k, u, v) => { const [x, y] = SIM.modToLocal(m, k, u, v); return SIM.toWorld(m, x, y, r); };
  SIM.modLocal = (m, r, k, x, y) => { const [a, b] = SIM.toLocal(m, x, y, r); return SIM.localToMod(m, k, a, b); };
  SIM.modDir = (m, r, k, dx, dy) => { const [a, b] = rot(dx, dy, (4 - r) % 4); return m.course[k].leg === 1 ? [a, b] : [b, -a]; };
  const modRect = (m, k, o) => { // a module rectangle in the top-left route's coordinates
    const [x0, y0] = SIM.modToLocal(m, k, o.u, o.v), [x1, y1] = SIM.modToLocal(m, k, o.u + o.w, o.v + o.h);
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  };

  /* ---------- the board in the middle (coordinates around the centre) ---------- */
  const HOLES = [[4, 2], [7, 4], [5, 7], [2, 5]];
  const TOWER_TILE = [2, 2];
  const rotTile = (i, j, r) => { for (let k = 0; k < r; k++) [i, j] = [9 - j, i]; return [i, j]; };
  const tileIdx = (i, j) => j * 10 + i;
  SIM.tileRect = (i) => ({ x: -C.BOARD + (i % 10) * C.TILE, y: -C.BOARD + Math.floor(i / 10) * C.TILE, w: C.TILE, h: C.TILE });

  SIM.makeMap = function (seed) {
    const course = SIM.course(seed);
    const m = { seed, ground: [], solids: [], dev: [], chests: [], spawn: [], ringCp: [], tiles: new Array(100).fill(null), course: [] };
    // lay the course out along the two legs of the top-left route
    const L1 = course[0].reduce((s, k) => s + MODS[k].len, 0), L2 = course[1].reduce((s, k) => s + MODS[k].len, 0);
    m.ox2 = -300; m.oy2 = -C.RING_OUT - L2; m.ox1 = m.ox2 - L1 - 160; m.oy1 = m.oy2 - 160;
    m.course.push({ name: 'start', leg: 1, U: 0 });
    let U = 0; for (const k of course[0]) { m.course.push({ name: k, leg: 1, U }); U += MODS[k].len; }
    m.course.push({ name: 'corner', leg: 2, U: 0 });
    U = 0; for (const k of course[1]) { m.course.push({ name: k, leg: 2, U }); U += MODS[k].len; }
    m.L1 = L1; m.L2 = L2;
    // the top-left route, in coordinates around the centre
    const RG = [], RD = [], RC = [];
    RG.push({ ...modRect(m, 0, { u: -400, v: -200, w: 400, h: 400 }), kind: 'box', mod: 0, part: 0, cp: SIM.modToLocal(m, 0, -200, 0) });
    RC.push({ p: SIM.modToLocal(m, 0, -330, -130), tier: 0 });
    for (let k = 1; k <= 9; k++) {
      if (k === 5) { // the corner: a velvet box where the route turns
        RG.push({ ...modRect(m, 5, { u: -320, v: -160, w: 320, h: 320 }), kind: 'velvet', mod: 5, part: 0, cp: SIM.modToLocal(m, 5, -160, 0) });
        RC.push({ p: SIM.modToLocal(m, 5, -230, 100), tier: 0 });
        continue;
      }
      const M = MODS[m.course[k].name];
      M.ground.forEach((g, i) => RG.push({ ...modRect(m, k, g), kind: g.kind, mod: k, part: i, cp: g.cp ? SIM.modToLocal(m, k, g.cp[0], g.cp[1]) : null }));
      for (const d of M.dev) {
        const o = { type: d.type, key: d.key, mod: k, link: d.link, pair: d.pair };
        if (d.w && d.u !== undefined && d.type !== 'train') Object.assign(o, modRect(m, k, d));
        if (d.type === 'plate' || d.type === 'lever' || d.type === 'twin') [o.x, o.y] = SIM.modToLocal(m, k, d.u, d.v);
        else if (d.type === 'spin') { [o.x, o.y] = SIM.modToLocal(m, k, d.u, d.v); o.len = d.len; o.speed = d.speed; }
        else if (d.type === 'plat') { [o.x0, o.y0] = SIM.modToLocal(m, k, d.u0, d.v0); [o.x1, o.y1] = SIM.modToLocal(m, k, d.u1, d.v1); o.w = d.w; o.h = d.h; o.phase = d.phase; }
        else if (d.type === 'seesaw') { [o.ax, o.ay] = SIM.modToLocal(m, k, d.au, d.av); [o.bx, o.by] = SIM.modToLocal(m, k, d.bu, d.bv); [o.tx, o.ty] = SIM.modToLocal(m, k, d.tu, d.tv); }
        else if (d.type === 'drawer') { o.period = d.period; o.duty = d.duty; }
        else if (d.type === 'train') { // moves sideways across the route between -amp and amp
          const a = modRect(m, k, { u: d.u - d.w / 2, v: -d.amp - d.h / 2, w: d.w, h: d.h }), b = modRect(m, k, { u: d.u - d.w / 2, v: d.amp - d.h / 2, w: d.w, h: d.h });
          Object.assign(o, { x0: a.x, y0: a.y, x1: b.x, y1: b.y, w: a.w, h: a.h, period: d.period, phase: d.phase });
        }
        RD.push(o);
      }
    }
    // the arena: ring, bridges onto the board, towers, seesaws at the ring corners, slingshots, chests
    const A = { ground: [], dev: [], chests: [] };
    const RI = C.RING_IN, RO = C.RING_OUT, B = C.BOARD;
    A.ground.push({ x: -RO, y: -RO, w: RO * 2, h: RO - RI, kind: 'ring' }, { x: -RO, y: RI, w: RO * 2, h: RO - RI, kind: 'ring' }, { x: -RO, y: -RI, w: RO - RI, h: RI * 2, kind: 'ring' }, { x: RI, y: -RI, w: RO - RI, h: RI * 2, kind: 'ring' });
    for (const g of A.ground) Object.assign(g, { mod: 10, part: 0, route: -1 });
    // place everything symmetric four times
    const arenaRoute = (r) => {
      A.ground.push({ ...rotRect({ x: -45, y: -RI - 4, w: 90, h: RI - B + 8 }, r, 0), kind: 'ruler', mod: 10, part: 1, route: r });
      const [ti, tj] = rotTile(TOWER_TILE[0], TOWER_TILE[1], r);
      A.ground.push({ ...SIM.tileRect(tileIdx(ti, tj)), z: C.TOWER_Z, kind: 'tower', lethal: true, mod: 11, part: 1, route: r, tower: r });
      const P = (x, y) => rot(x, y, r);
      const [ax, ay] = P(-1050, -960), [bx, by] = P(-960, -1050), [tx, ty] = P(-310, -310);
      A.dev.push({ type: 'seesaw', key: 'rs', mod: 10, route: r, ax, ay, bx, by, tx, ty });
      const [sx, sy] = P(-585, -585), [hx, hy] = P(-585, -455);
      A.dev.push({ type: 'sling', key: 'sl', mod: 11, route: r, x: sx, y: sy, hx, hy });
      A.chests.push({ p: P(-700, -1010), tier: 0 }, { p: P(-585, -195), tier: 0 }, { p: P(-362, -362), tier: 1, z: C.TOWER_Z });
    };
    for (let r = 0; r < 4; r++) arenaRoute(r);
    const holes = new Set(); for (let r = 0; r < 4; r++) { const [i, j] = rotTile(HOLES[0][0], HOLES[0][1], r); holes.add(tileIdx(i, j)); }
    m.holes = holes;
    // how big the desk is: the farthest corner of the route, plus a margin
    let ext = RO;
    for (const g of RG) ext = Math.max(ext, Math.abs(g.x), Math.abs(g.y), Math.abs(g.x + g.w), Math.abs(g.y + g.h));
    m.half = Math.ceil(ext + 250); m.w = m.h = m.half * 2;
    const Hh = m.half;
    // the board's tiles (a grid lookup, holes left out)
    for (let i = 0; i < 100; i++) { if (holes.has(i)) continue; const t = SIM.tileRect(i); m.tiles[i] = { x: t.x + Hh, y: t.y + Hh, w: t.w, h: t.h, kind: 'tile', tile: i, lethal: true, mod: 11, part: 0, route: -1 }; }
    for (const g of A.ground) m.ground.push({ ...g, x: g.x + Hh, y: g.y + Hh });
    for (const d of A.dev) { const o = { ...d }; for (const k of ['x', 'y', 'hx', 'hy', 'ax', 'ay', 'bx', 'by', 'tx', 'ty']) if (o[k] !== undefined) o[k] += Hh; o.id = m.dev.length; m.dev.push(o); }
    // the four routes
    for (let r = 0; r < 4; r++) {
      const Pw = (p) => SIM.toWorld(m, p[0], p[1], r);
      for (const g of RG) m.ground.push({ ...rotRect(g, r, Hh), kind: g.kind, mod: g.mod, part: g.part, route: r, cp: g.cp ? Pw(g.cp) : null });
      const base = m.dev.length, ids = {};
      RD.forEach((d, i) => { ids[d.mod + ':' + d.key] = base + i; });
      for (const d of RD) {
        const o = { type: d.type, key: d.key, mod: d.mod, route: r, id: m.dev.length };
        if (d.link) o.link = ids[d.mod + ':' + d.link];
        if (d.pair) o.pair = ids[d.mod + ':' + d.pair];
        if (d.w !== undefined && d.x !== undefined && d.type !== 'plat' && d.type !== 'train') Object.assign(o, rotRect(d, r, Hh));
        if (d.type === 'plate' || d.type === 'lever' || d.type === 'twin' || d.type === 'spin') { [o.x, o.y] = Pw([d.x, d.y]); }
        if (d.type === 'spin') { o.len = d.len; o.speed = d.speed; }
        if (d.type === 'plat') { [o.x0, o.y0] = Pw([d.x0, d.y0]); [o.x1, o.y1] = Pw([d.x1, d.y1]); o.w = d.w; o.h = d.h; o.phase = d.phase; }
        if (d.type === 'seesaw') { [o.ax, o.ay] = Pw([d.ax, d.ay]); [o.bx, o.by] = Pw([d.bx, d.by]); [o.tx, o.ty] = Pw([d.tx, d.ty]); }
        if (d.type === 'drawer') { o.period = d.period; o.duty = d.duty; }
        if (d.type === 'train') {
          const a = rotRect({ x: d.x0, y: d.y0, w: d.w, h: d.h }, r, Hh), b = rotRect({ x: d.x1, y: d.y1, w: d.w, h: d.h }, r, Hh);
          Object.assign(o, { x0: a.x, y0: a.y, x1: b.x, y1: b.y, w: a.w, h: a.h, period: d.period, phase: d.phase });
        }
        m.dev.push(o);
      }
      for (const c of RC) { const [x, y] = Pw(c.p); m.chests.push({ id: m.chests.length, x, y, z: 0, tier: c.tier, route: r, open: false, back: 0 }); }
      m.spawn.push(Pw(SIM.modToLocal(m, 0, -200, 0)));
      m.ringCp.push(Pw([-300, -1010]));
    }
    for (const c of A.chests) m.chests.push({ id: m.chests.length, x: c.p[0] + Hh, y: c.p[1] + Hh, z: c.z || 0, tier: c.tier, route: -1, open: false, back: 0 });
    m.towers = m.ground.filter((g) => g.kind === 'tower').sort((a, b) => a.tower - b.tower);
    // the schedule: when the marble rolls, which tiles crumble
    const R = rng(seed ^ 0xf1a6);
    m.marbles = []; for (let t2 = 45; t2 < 4000; t2 += 50) m.marbles.push({ t0: t2, axis: R() < 0.5 ? 0 : 1, dir: R() < 0.5 ? 1 : -1, off: [-390, -130, 130, 390][(R() * 4) | 0] });
    const keep = new Set([[4, 2], [2, 2], [4, 4], [4, 0], [0, 4], [0, 0], [0, 1], [0, 3], [1, 4]].map(([i, j]) => tileIdx(i, j)));
    const cand = []; for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (!keep.has(tileIdx(i, j))) cand.push([i, j]);
    m.tileDown = Array.from({ length: 100 }, () => []);
    for (let t2 = 70; t2 < 4000; t2 += 70) {
      const a = (R() * cand.length) | 0; let b = (R() * (cand.length - 1)) | 0; if (b >= a) b++;
      for (const [i0, j0] of [cand[a], cand[b]]) for (let r = 0; r < 4; r++) { const [i, j] = rotTile(i0, j0, r); m.tileDown[tileIdx(i, j)].push(t2); }
    }
    return m;
  };

  /* ---------- things that move by the clock ---------- */
  SIM.platPos = function (d, t) {
    const P = C.PLAT_PERIOD, D = C.PLAT_DWELL, tr = P / 2 - D;
    const u = ((((t / P + d.phase) % 1) + 1) % 1) * P;
    const k = u < D ? 0 : u < D + tr ? ease((u - D) / tr) : u < 2 * D + tr ? 1 : 1 - ease((u - 2 * D - tr) / tr);
    return { x: d.x0 + (d.x1 - d.x0) * k, y: d.y0 + (d.y1 - d.y0) * k, k };
  };
  SIM.platDock = function (d, t, end) { // seconds left docked at this end (0: start, 1: far end), or -1
    const P = C.PLAT_PERIOD, D = C.PLAT_DWELL, tr = P / 2 - D;
    const u = ((((t / P + d.phase) % 1) + 1) % 1) * P;
    if (end === 0) return u < D ? D - u : -1;
    return u >= D + tr && u < 2 * D + tr ? 2 * D + tr - u : -1;
  };
  SIM.spinAng = (d, t) => t * d.speed + d.route * 1.7 + d.mod;
  SIM.drawerOut = (d, t) => { const ph = (((t / d.period) % 1) + 1) % 1; return ph < d.duty ? (d.duty - ph) * d.period : -1; }; // seconds left out, or -1
  SIM.drawerK = (d, t) => { const ph = (((t / d.period) % 1) + 1) % 1, s = 0.35 / d.period; return ph < d.duty ? Math.min(1, ph / s, (d.duty - ph) / s) : 0; }; // how far out it is drawn
  SIM.trainPos = (d, t) => { const ph = (((t / d.period + d.phase) % 1) + 1) % 1, k = ph < 0.5 ? ph * 2 : 2 - ph * 2; return { x: d.x0 + (d.x1 - d.x0) * k, y: d.y0 + (d.y1 - d.y0) * k, dir: ph < 0.5 ? 1 : -1 }; };
  SIM.tileState = function (m, i, t) { // 0 up, 1 shaking (about to fall), 2 gone
    if (!m.tiles[i]) return 2;
    for (const t0 of m.tileDown[i]) { if (t < t0 - C.CRUMBLE_WARN) return 0; if (t < t0) return 1; if (t < t0 + C.CRUMBLE_T) return 2; }
    return 0;
  };
  SIM.marbleAt = function (m, t) { // the rolling marble: null, or { x, y, vx, vy, warn, ev }
    const span = 2200 / C.MARBLE_SPEED;
    for (const e of m.marbles) {
      if (t < e.t0 - C.MARBLE_WARN) return null;
      if (t > e.t0 + span) continue;
      const s = t < e.t0 ? -1100 : -1100 + (t - e.t0) * C.MARBLE_SPEED, a = s * e.dir;
      const [x, y] = e.axis ? [e.off, a] : [a, e.off];
      return { x: x + m.half, y: y + m.half, vx: e.axis ? 0 : e.dir * C.MARBLE_SPEED, vy: e.axis ? e.dir * C.MARBLE_SPEED : 0, warn: t < e.t0, ev: e };
    }
    return null;
  };
  /* ---------- what is underfoot, and what is solid ---------- */
  const inR = (o, x, y, e) => x > o.x - e && x < o.x + o.w + e && y > o.y - e && y < o.y + o.h + e;
  // the highest surface under (x, y) no higher than maxZ (an object with .z for raised ones), or null over the drop
  SIM.groundAt = function (m, W, x, y, maxZ) {
    let best = null, bz = -1;
    for (const g of m.ground) if ((g.z || 0) > bz && (g.z || 0) <= (maxZ ?? 1e9) && inR(g, x, y, 6)) { best = g; bz = g.z || 0; }
    if (bz > 0) return best;
    const lx = x - m.half + C.BOARD, ly = y - m.half + C.BOARD;
    if (!best && lx > -6 && ly > -6 && lx < C.BOARD * 2 + 6 && ly < C.BOARD * 2 + 6) { // the board: a grid lookup, forgiving at the cracks
      for (const ox of [-6, 6]) for (const oy of [-6, 6]) {
        const i = Math.floor((lx + ox) / C.TILE), j = Math.floor((ly + oy) / C.TILE);
        if (i < 0 || j < 0 || i > 9 || j > 9) continue;
        if (SIM.tileState(m, j * 10 + i, W.t) < 2) return m.tiles[j * 10 + i];
      }
    }
    if (best) return best;
    for (const d of m.dev) {
      if (d.type === 'bridge') { if (W.on.has(d.id) && inR(d, x, y, 4)) return d; }
      else if (d.type === 'drawer') { if (inR(d, x, y, 4) && SIM.drawerK(d, W.t) > 0.85) return d; }
      else if (d.type === 'plat') { const c = SIM.platPos(d, W.t); if (Math.abs(x - c.x) < d.w / 2 + 6 && Math.abs(y - c.y) < d.h / 2 + 6) return d; }
    }
    return null;
  };
  SIM.fanAt = (m, x, y) => { for (const d of m.dev) if (d.type === 'fan' && inR(d, x, y, 0)) return d; return null; };
  function pushRect(p, b, r) {
    if (p.x < b.x - r || p.x > b.x + b.w + r || p.y < b.y - r || p.y > b.y + b.h + r) return false;
    const cx = clamp(p.x, b.x, b.x + b.w), cy = clamp(p.y, b.y, b.y + b.h);
    const dx = p.x - cx, dy = p.y - cy, d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return false;
    if (d2 > 1e-6) { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.y = cy + dy / d * r; }
    else { // centre inside: out along the shortest side
      const l = p.x - b.x, rr = b.x + b.w - p.x, t = p.y - b.y, bt = b.y + b.h - p.y, mn = Math.min(l, rr, t, bt);
      if (mn === l) p.x = b.x - r; else if (mn === rr) p.x = b.x + b.w + r; else if (mn === t) p.y = b.y - r; else p.y = b.y + b.h + r;
    }
    return true;
  }
  SIM.collide = function (m, W, p, r) {
    for (const b of m.solids) pushRect(p, b, r);
    for (const d of m.dev) {
      if (d.type === 'gate' && !W.on.has(d.id)) pushRect(p, d, r);
      else if (d.type === 'train' && p.z < 60) { const c = SIM.trainPos(d, W.t); pushRect(p, { x: c.x, y: c.y, w: d.w, h: d.h }, r); }
    }
    for (const c of m.chests) {
      if (Math.abs((p.z || 0) - c.z) > 40) continue;
      const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy), md = C.CHEST_SIZE + r;
      if (d < md && d > 1e-6) { p.x = c.x + dx / d * md; p.y = c.y + dy / d * md; }
    }
    p.x = clamp(p.x, r, m.w - r); p.y = clamp(p.y, r, m.h - r);
  };
  // shots: blocked by solids, closed gates, trains, chests at their height, and surfaces higher than the shot
  SIM.blocked = function (m, W, x, y, r, z) {
    z = z || 0;
    for (const b of m.solids) if (inR(b, x, y, r)) return true;
    for (const d of m.dev) {
      if (d.type === 'gate' && !W.on.has(d.id) && inR(d, x, y, r)) return true;
      if (d.type === 'train') { const c = SIM.trainPos(d, W.t); if (inR({ x: c.x, y: c.y, w: d.w, h: d.h }, x, y, r)) return true; }
    }
    for (const c of m.chests) if (Math.abs(z - c.z) < 40 && Math.hypot(x - c.x, y - c.y) < C.CHEST_SIZE + r) return true;
    for (const g of m.ground) if (g.z && g.z > z + 30 && inR(g, x, y, 0)) return true;
    return x < 0 || y < 0 || x > m.w || y > m.h;
  };

  /* ---------- movement (also run by the client for its own player) ----------
     W: { t (time at the end of this step), on (open gates, lowered bridges), mate (the partner, for boosts) } */
  SIM.move = function (m, p, inp, dt, W) {
    if (p.fly) { // flung by a seesaw or a slingshot: a fixed arc to the landing spot
      const F = p.fly; F.t += dt;
      const k = Math.min(1, F.t / F.T);
      p.x = F.x0 + (F.x1 - F.x0) * k; p.y = F.y0 + (F.y1 - F.y0) * k; p.z = F.z0 * (1 - k) + F.z1 * k + 4 * F.H * k * (1 - k);
      if (k >= 1) { p.fly = null; p.z = F.z1; p.vz = 0; p.vx = p.vy = 0; p.landed = true; p.shock = F.shock; }
      return;
    }
    if (p.fall > 0 || p.st === 2) return;
    let mx = inp.mx || 0, my = inp.my || 0; const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
    const g0 = SIM.groundAt(m, W, p.x, p.y, p.z + C.STEP), f0 = g0 ? g0.z || 0 : null, fan = SIM.fanAt(m, p.x, p.y);
    const ox = p.x, oy = p.y, z0 = p.z;
    const air = p.vz > 0 || p.z > (f0 ?? 0) + 0.5 || (fan && f0 === null);
    const sp = p.st === 1 ? C.DOWN_SPEED : p.brace ? 0 : air && p.boost ? C.BOOST_SPEED : C.SPEED;
    const k = Math.min(1, dt * (air ? 7 : 20)); // snappy on the ground, less control in the air
    if (!(air && p.boost && !mx && !my)) { p.vx += (mx * sp - p.vx) * k; p.vy += (my * sp - p.vy) * k; } // a boost keeps its momentum unless you steer
    // jump; next to a partner who braces (holds the use key on the ground) it becomes a boost, twice as long
    if (inp.j && p.st === 0 && !air && !p.brace && (f0 !== null || p.air < C.COYOTE)) {
      const q = W.mate;
      const boost = !!(q && q.brace && q.st === 0 && Math.abs((q.z || 0) - p.z) < 10 && Math.hypot(q.x - p.x, q.y - p.y) < C.BOOST_R);
      p.vz = boost ? C.BOOST_VZ : C.JUMP_VZ; p.boost = boost; p.jumped = boost ? 2 : 1; p.air = C.COYOTE; // no second jump off thin air
      if (boost) { // full speed the way you run, or the way you aim when standing still
        const v = Math.hypot(p.vx, p.vy), a = inp.a ?? p.a ?? 0;
        if (v > 40) { p.vx = p.vx / v * C.BOOST_SPEED; p.vy = p.vy / v * C.BOOST_SPEED; } else { p.vx = Math.cos(a) * C.BOOST_SPEED; p.vy = Math.sin(a) * C.BOOST_SPEED; }
      }
    }
    if (fan && p.vz <= C.FAN_UP + 1 && !(f0 !== null && p.z <= f0 && p.vz <= 0)) { // the fan's updraft carries you
      const want = p.z < C.FAN_TOP ? C.FAN_UP : -60; p.vz += (want - p.vz) * Math.min(1, dt * 5); p.z = Math.max(0, p.z + p.vz * dt);
    } else if (air || p.vz > 0) { p.vz -= C.GRAV * dt; p.z += p.vz * dt; }
    if (p.kx || p.ky) { p.x += p.kx * dt; p.y += p.ky * dt; const f = Math.pow(0.02, dt); p.kx *= f; p.ky *= f; if (Math.abs(p.kx) + Math.abs(p.ky) < 4) p.kx = p.ky = 0; }
    // riding a lid: carried along with it
    if (!air && g0 && g0.type === 'plat') { const a = SIM.platPos(g0, W.t - dt), b = SIM.platPos(g0, W.t); p.x += b.x - a.x; p.y += b.y - a.y; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    SIM.collide(m, W, p, C.R);
    // the side of a tower is a wall, unless you are above it: slide along it, or stay put
    const top = Math.max(z0, p.z) + C.STEP; // a surface this step dropped past on the way down still catches you
    const wall = () => { const h = SIM.groundAt(m, W, p.x, p.y); return h && (h.z || 0) > top; };
    if (wall()) {
      const nx = p.x, ny = p.y;
      p.y = oy; if (wall()) { p.x = ox; p.y = ny; if (wall()) { p.x = ox; p.y = oy; } }
      if (wall()) { p.kx = p.ky = 0; }
    }
    const g = SIM.groundAt(m, W, p.x, p.y, top), fl = g ? g.z || 0 : null;
    if (fl !== null) {
      if (p.z <= fl && p.vz <= 0) { if (air) p.landed = true; p.z = fl; p.vz = 0; p.boost = false; p.air = 0; p.lastG = g; }
    } else if (p.z <= 0 && p.vz <= 0 && !SIM.fanAt(m, p.x, p.y)) { // over the drop: a moment to jump back (coyote time), then the fall
      p.z = 0; p.vz = 0; p.air += dt;
      if (p.air >= C.COYOTE) { p.fall = C.FALL_T; p.vx *= 0.4; p.vy *= 0.4; }
    }
  };

  /* ---------- match state ---------- */
  SIM.newPlayer = function (id, team, slot, name, bot) {
    return { id, team, slot, name, bot: !!bot, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, kx: 0, ky: 0, a: 0,
      hp: C.HP, armor: 0, st: 0, // st: 0 up, 1 downed, 2 waiting to respawn
      w: 0, ammo: 0, shotCd: 0, bleed: 0, rev: 0, respawn: 0, fall: 0, fly: null, air: 0, boost: false, brace: false, inv: 0, lastG: null,
      cpx: 0, cpy: 0, open: null, iPrev: 0, spinCd: 0, lastBy: 0, lastT: -9, seq: 0, kills: 0, deaths: 0, dmg: 0, place: 0 };
  };
  SIM.routeOf = (team) => team % 4;
  SIM.basePos = function (m, team, slot) {
    const k = Math.floor(team / 4) * 80;
    return SIM.modWorld(m, SIM.routeOf(team), 0, -200 + k, (slot ? 34 : -34) + k);
  };
  SIM.newMatch = function (seed, players, opts) {
    const m = SIM.makeMap(seed), o = opts || {};
    const teams = Math.max(...players.map((p) => p.team)) + 1;
    const S = { seed, map: m, t: 0, tick: 0, players, shots: [], nextShot: 1, items: [], nextItem: 1, events: [], over: false, winner: -1,
      matchT: o.matchT || C.MATCH_T, scoreWin: o.scoreWin || C.SCORE_WIN, teams, score: new Array(teams).fill(0),
      W: { t: 0, on: new Set(), mate: null }, bridgeT: {}, leverT: {}, sling: {} };
    for (const p of players) spawn(S, p, ...SIM.basePos(m, p.team, p.slot));
    return S;
  };

  const partnerOf = (S, p) => S.players.find((q) => q.team === p.team && q !== p);
  SIM.partnerOf = partnerOf;
  const ev = (S, e) => S.events.push(e);
  const steady = (S, q) => q && q.st === 0 && !q.fly && !(q.fall > 0) && SIM.groundAt(S.map, S.W, q.x, q.y) && q.z <= (SIM.groundAt(S.map, S.W, q.x, q.y).z || 0) + 1;
  const crossed = (S, at) => S.t - C.DT < at && S.t >= at;

  function spawn(S, p, x, y, z) {
    Object.assign(p, { x, y, z: z || 0, vx: 0, vy: 0, vz: 0, kx: 0, ky: 0, hp: C.HP, armor: 0, st: 0, w: 0, ammo: 0, bleed: 0, rev: 0, respawn: 0,
      fall: 0, fly: null, air: 0, boost: false, brace: false, inv: C.SPAWN_INV, cpx: x, cpy: y, open: null, lastG: null });
  }

  function hurt(S, p, dmg, from, kind) {
    if (p.st === 2 || S.over || (p.inv > 0 && kind !== 'fall')) return;
    if (from && from.team === p.team) return;
    if (from) { p.lastBy = from.id; p.lastT = S.t; }
    if (p.st === 1) { p.bleed -= dmg * 0.3; if (p.bleed <= 0) die(S, p, from); return; }
    let d = dmg;
    if (p.armor > 0 && kind !== 'fall') { const a = Math.min(p.armor, d); p.armor -= a; d -= a; }
    p.hp -= d;
    if (from) from.dmg += dmg;
    ev(S, ['hit', p.id, Math.round(dmg), kind || 'shot', from ? from.id : 0]);
    if (p.hp <= 0) {
      p.hp = 0;
      const q = partnerOf(S, p);
      if (q && q.st === 0 && !(p.fall > 0)) { p.st = 1; p.bleed = C.BLEED; p.rev = 0; p.open = null; ev(S, ['down', p.id, from ? from.id : 0]); }
      else die(S, p, from);
    }
  }
  function push(p, x, y) { // the more hurt you are, the further you fly; downed, you fly furthest
    if (p.inv > 0 || p.st === 2) return;
    const k = p.st === 1 ? C.KB_DOWN : 1 + C.KB_HURT * (1 - p.hp / C.HP);
    p.kx += x * k; p.ky += y * k;
    const f = Math.hypot(x, y) * k; // a hard hit lifts you off your feet, so it reads as a hit and not a slide
    if (f > 160 && !p.fly && p.vz <= 0) { p.vz = Math.min(C.KB_HOP, f * 0.5); p.air = C.COYOTE; }
  }
  SIM.kbMul = (hp, st) => (st === 1 ? C.KB_DOWN : 1 + C.KB_HURT * (1 - hp / C.HP));
  function ko(S, p, by) { // knocked off by an enemy: a point for their duo
    S.score[by.team]++; by.kills++;
    ev(S, ['ko', p.id, by.id]);
  }
  function die(S, p, from) {
    const killer = from || (S.t - p.lastT < C.KO_T ? S.players.find((q) => q.id === p.lastBy) : null);
    if (p.w && !(p.fall > 0)) dropItem(S, 'w' + p.w, p.x, p.y, p.ammo, p.z); // the toy weapon stays behind for someone else
    Object.assign(p, { st: 2, hp: 0, armor: 0, w: 0, ammo: 0, respawn: C.RESPAWN_T, fall: 0, fly: null, z: 0, vz: 0, open: null });
    p.deaths++;
    ev(S, ['out', p.id, killer && killer.team !== p.team ? killer.id : 0]);
    const q = partnerOf(S, p);
    if (q && q.st === 1) die(S, q, null); // nobody left to pick the partner up
  }
  function fallEnd(S, p) {
    let by = S.t - p.lastT < C.KO_T ? S.players.find((q) => q.id === p.lastBy) : null;
    if (by && by.team === p.team) by = null;
    if (by && !S.over) ko(S, p, by);
    p.lastT = -9; // credit given once
    if (p.lastG && p.lastG.lethal) { p.fall = 0; die(S, p, by); return; } // off the board: out
    const cp = p.lastG && p.lastG.mod === 10 ? S.map.ringCp[SIM.routeOf(p.team)] : [p.cpx, p.cpy];
    Object.assign(p, { fall: 0, z: 0, vz: 0, vx: 0, vy: 0, kx: 0, ky: 0, air: 0, x: cp[0], y: cp[1] });
    hurt(S, p, C.FALL_DMG, null, 'fall');
  }

  /* ---------- loot ---------- */
  function dropItem(S, k, x, y, ammo, z) {
    const it = { id: S.nextItem++, k, x, y, z: z || 0, ammo: ammo || 0, life: C.ITEM_LIFE, block: 0, blockT: 0 };
    if (k[0] === 'w' && !ammo) it.ammo = WEAPONS[+k[1]].ammo;
    S.items.push(it); return it;
  }
  function openChest(S, c, p) {
    c.open = true; c.back = c.tier ? C.GOLD_BACK : C.CHEST_BACK;
    const R = Math.random;
    const loot = c.tier
      ? [R() < 0.5 ? 'w3' : 'w4', 'armor', 'heal']
      : [['w1', 'w2', 'w5', 'w6'][(R() * 4) | 0], R() < 0.5 ? 'heal' : 'armor'];
    const base = Math.atan2(p.y - c.y, p.x - c.x);
    loot.forEach((k, i) => {
      const a = base + (i - (loot.length - 1) / 2) * 0.75;
      let x = c.x + Math.cos(a) * (c.z ? 46 : 64), y = c.y + Math.sin(a) * (c.z ? 46 : 64);
      const g = SIM.groundAt(S.map, S.W, x, y);
      if (!g || (g.z || 0) !== c.z) { x = p.x; y = p.y; }
      dropItem(S, k, x, y, 0, c.z);
    });
    ev(S, ['chest', c.id, p.id]);
  }
  function pickups(S, p) {
    for (let i = S.items.length - 1; i >= 0; i--) {
      const it = S.items[i];
      if (Math.abs(it.z - p.z) > 30 || Math.hypot(it.x - p.x, it.y - p.y) > C.PICK_R || (it.block === p.id && it.blockT > 0)) continue;
      if (it.k === 'heal' && p.hp < C.HP) { p.hp = Math.min(C.HP, p.hp + C.HEAL); ev(S, ['heal', p.id]); }
      else if (it.k === 'armor' && p.armor < C.ARMOR) { p.armor = C.ARMOR; ev(S, ['armor', p.id]); }
      else if (it.k[0] === 'w' && p.w === 0) { p.w = +it.k[1]; p.ammo = it.ammo; ev(S, ['pick', p.id, p.w]); }
      else continue;
      S.items.splice(i, 1);
    }
  }
  // holding the use key with nothing to use nearby: brace, so the partner can boost off you
  SIM.canBrace = function (m, items, p) {
    if (p.st !== 0 || p.fall > 0 || p.fly || p.vz > 0) return false;
    for (const c of m.chests) if (!c.open && Math.abs(c.z - p.z) < 30 && Math.hypot(c.x - p.x, c.y - p.y) < C.CHEST_R) return false;
    for (const d of m.dev) {
      if ((d.type === 'lever' || d.type === 'twin') && Math.hypot(d.x - p.x, d.y - p.y) < C.LEVER_R) return false;
      if (d.type === 'sling' && Math.hypot(d.hx - p.x, d.hy - p.y) < 50) return false;
    }
    if (p.w) for (const it of items) if (it.k[0] === 'w' && Math.hypot(it.x - p.x, it.y - p.y) < C.PICK_R) return false;
    return true;
  };
  function interact(S, p, inp) {
    const edge = inp.i && !p.iPrev; p.iPrev = inp.i ? 1 : 0;
    if (p.st !== 0 || p.vz > 0 || p.fall > 0 || p.fly) { p.open = null; return; }
    const m = S.map;
    if (edge) {
      for (const d of m.dev) {
        if (Math.hypot((d.x || 0) - p.x, (d.y || 0) - p.y) > C.LEVER_R) continue;
        if (d.type === 'lever') { S.bridgeT[d.link] = C.BRIDGE_T; ev(S, ['lever', d.id, p.id]); return; }
        if (d.type === 'twin') { // both levers within a moment of each other
          S.leverT[d.id] = S.t;
          if (S.t - (S.leverT[d.pair] ?? -9) <= C.TWIN_WINDOW) { S.bridgeT[d.link] = C.TWIN_T; ev(S, ['lever', d.id, p.id]); }
          else ev(S, ['half', d.id, p.id]);
          return;
        }
      }
      if (p.w) { // swap the weapon in hand for one on the floor
        let best = null, bd = C.PICK_R;
        for (const it of S.items) { const d = Math.hypot(it.x - p.x, it.y - p.y); if (it.k[0] === 'w' && d < bd && Math.abs(it.z - p.z) < 30) { bd = d; best = it; } }
        if (best) {
          const old = dropItem(S, 'w' + p.w, p.x, p.y, p.ammo, p.z); old.block = p.id; old.blockT = 1.5;
          p.w = +best.k[1]; p.ammo = best.ammo; S.items.splice(S.items.indexOf(best), 1); ev(S, ['pick', p.id, p.w]); return;
        }
      }
    }
    if (!inp.i) { p.open = null; return; }
    let best = null, bd = C.CHEST_R;
    for (const c of m.chests) { const d = Math.hypot(c.x - p.x, c.y - p.y); if (!c.open && d < bd && Math.abs(c.z - p.z) < 30) { bd = d; best = c; } }
    if (!best) { p.open = null; return; }
    if (!p.open || p.open.id !== best.id) p.open = { id: best.id, t: 0, T: best.tier ? C.GOLD_T : C.CHEST_T };
    p.open.t += C.DT;
    if (p.open.t >= p.open.T) { openChest(S, best, p); p.open = null; }
  }

  function fire(S, p) {
    const W = WEAPONS[p.w];
    p.shotCd = W.cd;
    for (let k = 0; k < W.n; k++) {
      const a = p.a + (W.n > 1 ? (k / (W.n - 1) - 0.5) * W.spread : (Math.random() - 0.5) * W.spread);
      const ca = Math.cos(a), sa = Math.sin(a), off = W.melee ? 4 : C.R + 6;
      S.shots.push({ id: S.nextShot++, o: p.id, lag: p.lag || 0, team: p.team, w: p.w, x: p.x + ca * off, y: p.y + sa * off, z: p.z, vx: ca * W.speed, vy: sa * W.speed, life: W.life * (W.melee ? 1 : 0.9 + Math.random() * 0.2), hit: W.n > 1 ? [] : null });
    }
    if (p.w) { p.ammo--; if (p.ammo <= 0) { p.w = 0; p.ammo = 0; } }
    ev(S, ['shot', p.id, p.w]);
  }
  function boom(S, s) {
    const W = WEAPONS[s.w], from = S.players.find((o) => o.id === s.o);
    for (const p of S.players) {
      if (p.team === s.team || p.st === 2) continue;
      const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy);
      if (d > W.boom) continue;
      const k = 1 - d / W.boom;
      hurt(S, p, W.dmg * (0.5 + 0.5 * k), from, 'boom');
      if (d > 1) push(p, dx / d * W.kb * k, dy / d * W.kb * k);
    }
    ev(S, ['boom', Math.round(s.x), Math.round(s.y)]);
  }
  function shock(S, p) { // landing from a slingshot: everyone close is thrown back
    for (const e of S.players) {
      if (e.team === p.team || e.st === 2) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
      if (d > C.SHOCK_R || d < 1) continue;
      hurt(S, e, C.SHOCK_DMG, p, 'shock'); push(e, dx / d * C.SHOCK_PUSH, dy / d * C.SHOCK_PUSH);
    }
    ev(S, ['shock', p.id]);
  }
  function launch(S, o, x1, y1, T, H, shockOn) {
    const g = SIM.groundAt(S.map, S.W, x1, y1);
    o.fly = { x0: o.x, y0: o.y, z0: o.z, x1, y1, z1: g ? g.z || 0 : 0, t: 0, T, H, shock: shockOn };
    o.vx = o.vy = o.kx = o.ky = 0; o.open = null; o.brace = false;
  }

  /* ---------- one step; inputs: id -> { mx, my, a, f (fire held), j (jump pressed), i (use held) } ---------- */
  SIM.step = function (S, inputs) {
    const dt = C.DT, m = S.map, W = S.W;
    S.t += dt; S.tick++; W.t = S.t;
    // buttons hold their gates open and their bridges down; levers lower a bridge for a while
    W.on = new Set();
    for (const d of m.dev) if (d.type === 'plate') for (const p of S.players) if (p.st !== 2 && !p.fly && !(p.fall > 0) && p.vz <= 0 && Math.hypot(p.x - d.x, p.y - d.y) < C.PLATE_R) { W.on.add(d.link); break; }
    for (const id in S.bridgeT) { S.bridgeT[id] -= dt; if (S.bridgeT[id] > 0) W.on.add(+id); else delete S.bridgeT[id]; }
    for (const p of S.players) p.brace = !!(inputs[p.id] && inputs[p.id].i) && SIM.canBrace(m, S.items, p);

    for (const p of S.players) {
      const q = partnerOf(S, p);
      if (p.st === 2) { // waiting: come back next to the partner, or both at the start box once the whole duo is down
        p.respawn = Math.max(0, p.respawn - dt);
        if (p.respawn > 0) continue;
        if (steady(S, q)) {
          let at = [q.x, q.y, q.z];
          for (let k = 0; k < 8; k++) {
            const a = k * Math.PI / 4, x = q.x + Math.cos(a) * 44, y = q.y + Math.sin(a) * 44, g = SIM.groundAt(m, W, x, y);
            if (g && (g.z || 0) === q.z && !SIM.blocked(m, W, x, y, C.R, q.z) && !(g.tile !== undefined && SIM.tileState(m, g.tile, S.t + 2) > 0)) { at = [x, y, q.z]; break; }
          }
          spawn(S, p, at[0], at[1], at[2]); ev(S, ['spawn', p.id]);
        } else if (!q || (q.st === 2 && q.respawn <= 0)) {
          for (const x of q ? [p, q] : [p]) { spawn(S, x, ...SIM.basePos(m, x.team, x.slot)); ev(S, ['spawn', x.id]); }
        }
        continue;
      }
      const inp = inputs[p.id] || {};
      // lag compensation: the tick this player's screen showed the others at (sent with each input; bots see now)
      p.lag = inp.v ? clamp(S.tick - inp.v, 0, C.LAG_MAX) : 0;
      p.a = inp.a ?? p.a;
      p.shotCd = Math.max(0, p.shotCd - dt); p.spinCd = Math.max(0, p.spinCd - dt); p.inv = Math.max(0, p.inv - dt);
      W.mate = q;
      const wasFall = p.fall > 0;
      p.landed = false; p.jumped = 0; p.shock = false;
      SIM.move(m, p, p.st === 1 ? { mx: inp.mx, my: inp.my } : inp, dt, W);
      if (p.jumped) ev(S, ['jump', p.id, p.jumped]);
      if (p.fall > 0 && !wasFall) { p.open = null; ev(S, ['fall', p.id]); }
      if (p.fall > 0) { p.fall -= dt; if (p.fall <= 0) fallEnd(S, p); continue; }
      if (p.shock) shock(S, p);
      // landing on the far end of a seesaw flings whoever stands on the near end
      if (p.landed && !p.fly) for (const d of m.dev) {
        if (d.type !== 'seesaw' || Math.hypot(p.x - d.bx, p.y - d.by) > 46) continue;
        const o = S.players.find((x) => x !== p && x.st === 0 && !x.fly && x.vz <= 0 && Math.hypot(x.x - d.ax, x.y - d.ay) < 42);
        if (o) { launch(S, o, d.tx + (Math.random() - 0.5) * 40, d.ty + (Math.random() - 0.5) * 40, d.mod === 10 ? 1.4 : 1.15, 300); ev(S, ['launch', o.id, d.id]); }
      }
      if (p.fly) continue;
      // checkpoints: the last route surface stood on
      if (p.st === 0 && p.lastG && p.lastG.cp && p.vz <= 0) { p.cpx = p.lastG.cp[0]; p.cpy = p.lastG.cp[1]; }
      // spinning pencils and toy trains: jump over the pencils, keep out of the way of the trains
      if (p.spinCd <= 0) for (const d of m.dev) {
        if (d.type === 'spin' && p.z < C.SPIN_Z) {
          const a = SIM.spinAng(d, S.t), ca = Math.cos(a), sa = Math.sin(a);
          const rx = p.x - d.x, ry = p.y - d.y, along = clamp(rx * ca + ry * sa, -d.len, d.len);
          if (Math.hypot(rx - ca * along, ry - sa * along) < C.R + 9) {
            const rl = Math.hypot(rx, ry) || 1, s = Math.sign(d.speed); // swept along the way the pencil turns, and a little outwards
            push(p, (-ry / rl * s * 0.8 + rx / rl * 0.6) * C.SPIN_PUSH, (rx / rl * s * 0.8 + ry / rl * 0.6) * C.SPIN_PUSH);
            p.spinCd = 0.7; hurt(S, p, C.SPIN_DMG, null, 'spin'); ev(S, ['spin', p.id]);
          }
        } else if (d.type === 'train' && p.z < 60) {
          const c = SIM.trainPos(d, S.t);
          if (inR({ x: c.x, y: c.y, w: d.w, h: d.h }, p.x, p.y, C.R + 3)) {
            const dx = d.x1 - d.x0, dy = d.y1 - d.y0, l = Math.hypot(dx, dy) || 1;
            push(p, dx / l * c.dir * C.TRAIN_PUSH, dy / l * c.dir * C.TRAIN_PUSH);
            p.spinCd = 0.7; hurt(S, p, C.TRAIN_DMG, null, 'train'); ev(S, ['train', p.id]);
          }
        }
      }
      interact(S, p, inp);
      if (inp.f && p.st === 0 && p.shotCd <= 0) fire(S, p);
      // downed: bleeding out, the partner picks you up by standing close
      if (p.st === 1) {
        p.bleed -= dt;
        if (q && q.st === 0 && Math.abs(q.z - p.z) < 20 && Math.hypot(q.x - p.x, q.y - p.y) < C.REVIVE_R) { p.rev += dt; if (p.rev >= C.REVIVE_T) { p.st = 0; p.hp = C.REVIVE_HP; p.rev = 0; ev(S, ['rev', p.id]); } }
        else p.rev = Math.max(0, p.rev - dt * 2);
        if (p.bleed <= 0 && p.st === 1) die(S, p, null);
      }
      if (p.st === 0) pickups(S, p);
    }
    // giant slingshots: one partner in the pouch, the other holds the use key at the handle and aims
    for (const d of m.dev) {
      if (d.type !== 'sling') continue;
      const cd = (S.sling[d.id] = S.sling[d.id] || { t: 0, cd: 0 }); cd.cd = Math.max(0, cd.cd - dt);
      const h = S.players.find((p) => p.st === 0 && !p.fly && p.vz <= 0 && inputs[p.id] && inputs[p.id].i && Math.hypot(p.x - d.hx, p.y - d.hy) < 46);
      const o = h && S.players.find((p) => p.team === h.team && p !== h && p.st === 0 && !p.fly && p.vz <= 0 && Math.hypot(p.x - d.x, p.y - d.y) < 40);
      if (!o || cd.cd > 0) { cd.t = 0; continue; }
      cd.t += dt;
      if (cd.t >= C.SLING_T) {
        const B = C.BOARD - 30, cx = m.half, cy = m.half;
        const x1 = clamp(d.x + Math.cos(h.a) * C.SLING_RANGE, cx - B, cx + B), y1 = clamp(d.y + Math.sin(h.a) * C.SLING_RANGE, cy - B, cy + B);
        launch(S, o, x1, y1, 1.0, 220, true); cd.t = 0; cd.cd = C.SLING_CD; ev(S, ['sling', o.id, d.id]);
      }
    }
    // the rolling marble
    const mb = SIM.marbleAt(m, S.t);
    if (mb && !mb.warn) for (const p of S.players) {
      if (p.st === 2 || p.fly || p.z > 100 || p.spinCd > 0 || Math.hypot(p.x - mb.x, p.y - mb.y) > C.MARBLE_R + C.R) continue;
      const side = mb.ev.axis ? Math.sign(p.x - mb.x) || 1 : Math.sign(p.y - mb.y) || 1;
      push(p, (mb.vx ? Math.sign(mb.vx) * C.MARBLE_PUSH : side * 420), (mb.vy ? Math.sign(mb.vy) * C.MARBLE_PUSH : side * 420));
      p.spinCd = 0.8; hurt(S, p, C.MARBLE_DMG, null, 'marble'); ev(S, ['marble', p.id]);
    }
    for (const e of m.marbles) { if (e.t0 - C.MARBLE_WARN > S.t) break; if (crossed(S, e.t0 - C.MARBLE_WARN)) ev(S, ['marbleWarn']); }
    for (let t2 = 70; t2 < S.t + 5; t2 += 70) if (crossed(S, t2 - C.CRUMBLE_WARN)) ev(S, ['crumbleWarn']);
    for (let i = S.items.length - 1; i >= 0; i--) { const it = S.items[i]; it.life -= dt; it.blockT -= dt; if (it.life <= 0) S.items.splice(i, 1); }
    for (const c of m.chests) if (c.open) { c.back -= dt; if (c.back <= 0) { c.open = false; ev(S, ['chestBack', c.id]); } }

    // where everyone stood, tick by tick, for the last half second (shots test against what their shooter saw)
    const H = S.hist || (S.hist = []), now = new Map();
    for (const p of S.players) now.set(p.id, [p.x, p.y]);
    H[S.tick % 16] = { tick: S.tick, at: now };
    const seen = (p, lag) => { const h = lag > 0 && H[(S.tick - lag) % 16]; const a = h && h.tick === S.tick - lag && h.at.get(p.id); return a || [p.x, p.y]; };
    // shots
    for (let i = S.shots.length - 1; i >= 0; i--) {
      const s = S.shots[i], n = 3, Wp = WEAPONS[s.w]; let gone = false;
      for (let k = 0; k < n && !gone; k++) {
        s.x += s.vx * dt / n; s.y += s.vy * dt / n;
        if (!Wp.lob && SIM.blocked(m, W, s.x, s.y, 5, s.z)) { gone = true; ev(S, ['pop', Math.round(s.x), Math.round(s.y)]); break; }
        for (const p of S.players) {
          if (p.team === s.team || p.st === 2 || p.fall > 0 || (s.hit && s.hit.includes(p.id))) continue;
          const [px, py] = seen(p, s.lag);
          if (Math.hypot(px - s.x, py - s.y) < C.R + (Wp.melee ? 14 : 6)) {
            if (Wp.boom) { boom(S, s); gone = true; break; }
            const sp = Math.hypot(s.vx, s.vy) || 1;
            hurt(S, p, Wp.dmg, S.players.find((o) => o.id === s.o), 'shot'); push(p, s.vx / sp * Wp.kb, s.vy / sp * Wp.kb);
            if (s.hit) s.hit.push(p.id);
            gone = !Wp.melee; break;
          }
        }
      }
      s.life -= dt;
      if (!gone && s.life <= 0 && Wp.boom) { boom(S, s); gone = true; }
      if (gone || s.life <= 0) S.shots.splice(i, 1);
    }

    if (!S.over && (S.t >= S.matchT || Math.max(...S.score) >= S.scoreWin)) {
      S.over = true;
      const order = S.score.map((s, t) => [Math.floor(s), t]).sort((a, b) => b[0] - a[0]);
      S.winner = order.length > 1 && order[0][0] === order[1][0] ? -1 : order[0][1]; // a shared top score is a draw
      for (const p of S.players) p.place = 1 + order.filter(([s]) => s > Math.floor(S.score[p.team])).length;
      ev(S, ['win', S.winner]);
    }
  };

  /* ---------- snapshot encoding (server → client) ----------
     player: [id, x, y, a*100, hp, st, z, bleed, rev*10, armor, vx, vy, kx, ky, kills, w, ammo, fall*10, fly, open 0..10,
              respawn, vz, boost, air*100, inv, deaths, brace] */
  SIM.encodePlayers = (S) => S.players.map((p) => [p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.a * 100), Math.ceil(p.hp), p.st,
    Math.round(p.z), Math.ceil(p.bleed), Math.round(p.rev * 10), Math.ceil(p.armor), Math.round(p.vx), Math.round(p.vy), Math.round(p.kx), Math.round(p.ky), p.kills,
    p.w, p.w ? p.ammo : -1, Math.round(p.fall * 10), p.fly ? 1 : 0, p.open ? Math.min(10, Math.round(p.open.t / p.open.T * 10)) : 0,
    Math.ceil(p.respawn), Math.round(p.vz), p.boost ? 1 : 0, Math.round(p.air * 100), p.inv > 0 ? 1 : 0, p.deaths, p.brace ? 1 : 0]);
  SIM.encodeShots = (S) => S.shots.map((s) => [s.id, Math.round(s.x), Math.round(s.y), Math.round(s.vx), Math.round(s.vy), s.team, s.w, Math.round(s.z), s.o]);
  SIM.encodeWorld = (S) => ({
    d: [...S.W.on], c: S.map.chests.filter((c) => c.open).map((c) => c.id),
    it: S.items.map((i) => [i.id, i.k, Math.round(i.x), Math.round(i.y), Math.round(i.z)]),
    sc: S.score.map(Math.floor), tl: Math.max(0, Math.ceil(S.matchT - S.t)),
    bt: Object.entries(S.bridgeT).map(([id, t]) => [+id, Math.ceil(t)]),
    sl: Object.entries(S.sling).filter(([, s]) => s.t > 0).map(([id, s]) => [+id, Math.round(s.t / C.SLING_T * 10)]),
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = SIM; else root.SIM = SIM;
})(typeof self !== 'undefined' ? self : this);
