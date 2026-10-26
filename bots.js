'use strict';
/* ===== Tiny Tumble — bots =====
   On the route a bot works module by module, in the module's own coordinates (u forward, v sideways), and knows
   how each one is done: who holds the button, who braces for the boost, who pulls the lever, who waits on the
   seesaw, when the drawer is out or the train has passed. With a human partner the bot takes the waiting role
   (button, base, seesaw end, the far lever) so the human only has to do the obvious part.
   In the arena it crosses its bridge onto the board and hunts: it gets on the far side of an enemy from the nearest
   drop and shoots them towards it. It opens chests, boosts its partner up a tower for a golden chest, and gets out
   of the way of the marble and crumbling tiles. */
const SIM = require('./shared/sim.js');
const C = SIM.C, MODS = SIM.MODS;

// devices that sit between a module's surfaces, as a part number (grounds are 0, 1, ...)
const DEVPART = { boost: { br: -0.5 }, lids: { m1: -0.5, m2: -0.5 }, drawer: { dr: -0.5 }, seesaw: { br: 0.5 }, twin: { br: 0.5 } };
// how far along: course module k (0 start, 1-4, 5 corner, 6-9, 10 ring, 11 board) and the part inside it
const progOf = (k, part) => k * 10 + (part + 1) * 2;

function placeOf(S, p) {
  if (p.st !== 2 && !p.fly && !(p.fall > 0) && p.vz <= 0) {
    const m = S.map, g = SIM.groundAt(m, S.W, p.x, p.y, p.z + C.STEP);
    if (g && g.mod !== undefined) {
      const k = g.mod, name = k <= 9 ? m.course[k].name : '';
      const part = g.kind ? g.part : (DEVPART[name] && DEVPART[name][g.key]) ?? 0;
      p.place = { k, part, prog: progOf(k, part), g };
    }
  }
  return p.place || { k: 0, part: 0, prog: progOf(0, 0) };
}

// the way to the nearest drop from where a player stands (unit vector)
function dropDir(m, W, e) {
  let best = [0, 1], bd = 1e9;
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    for (let d = 30; d < Math.min(bd, 600); d += 30) if (!SIM.groundAt(m, W, e.x + ca * d, e.y + sa * d, e.z + C.STEP)) { bd = d; best = [ca, sa]; break; }
  }
  return best;
}
function clearShot(m, W, a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 40);
  for (let k = 1; k < n; k++) { const t = k / n; if (SIM.blocked(m, W, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 4, a.z)) return false; }
  return true;
}

function initBot(p) { p.ai = { t: 0, fireT: 0, strafe: Math.random() < 0.5 ? 1 : -1, run: false, trun: false, spot: null, spotT: 0, pull: 0, tw: 0 }; }

/* ---------- the route, module by module ----------
   c: the module's view of the world (see runModule); stage: 'enter' (standing on the previous module's last
   surface), a part number, or 'exit' (on this module's last surface: anything left to do for the partner?).
   A script returns true when it has set a target. */
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const SCRIPTS = {
  steps(c, st) {
    const hops = [[0, [190, 0]], [265, [455, 40]], [530, [740, 0]]];
    const i = st === 'enter' ? 0 : st === 'exit' ? -1 : st + 1;
    if (i < 0 || i > 2) return false;
    return c.hop(hops[i][0], hops[i][1]);
  },
  gate(c, st) {
    const p1 = [100, 110], p2 = [335, -110], open = c.on('gate'), onP1 = dist(c.me, p1) < 30;
    if (st === 'enter') return c.go(60, 0);
    if (st === 'exit') return c.qUp && c.qBefore(1) ? c.go(p2[0], p2[1], 4) : false;
    if (open && !onP1) return c.go(300, 0);
    if (onP1) return c.qUp && c.qBefore(1) && !(c.qIn(0) && dist(c.qme, p1) < 30) ? c.go(p1[0], p1[1], 4) : c.go(180, 0);
    if (c.qPast(0)) return c.go(180, 0);
    if (c.q && c.qUp && c.qIn(0) && (c.q.bot ? c.p.slot === 1 : dist(c.qme, p1) < 90)) return c.go(180, 0); // the partner has the button
    return c.go(p1[0], p1[1], 4);
  },
  boost(c, st) {
    const BASE = [-50, 55], RUN = [-160, 0];
    if (st === -0.5) return c.go(330, 0, 6, true);
    if (st === 'exit') { // pull the lever for a partner still on the other side
      if (c.on('br') || !c.qUp || !c.qBefore(0)) return false;
      const lv = c.dev('lv'); c.go(lv[0], lv[1], 30);
      if (dist(c.me, lv) < 40 && c.Q.prog >= progOf(c.k - 1, 0)) c.pulse();
      return true;
    }
    if (st !== 'enter') return false;
    if (c.on('br')) return Math.abs(c.v) > 25 && c.u < -10 ? c.go(-30, 0) : c.go(330, 0, 6, true);
    if (c.qUp && c.Q.prog === c.P.prog) {
      const base = c.q.bot ? c.p.slot === 1 : true;
      if (base) { c.go(BASE[0], BASE[1], 12); if (dist(c.me, BASE) < 14) c.out.i = 1; return true; }
      if (dist(c.qme, BASE) < 30 && c.q.brace) {
        if (!c.A.run) { c.go(RUN[0], RUN[1], 10); if (dist(c.me, RUN) < 22) c.A.run = true; return true; }
        c.go(330, 0, 6, true); if (c.grounded && c.u > -14) c.out.j = 1; return true;
      }
      c.A.run = false; return c.go(RUN[0], RUN[1]);
    }
    if (c.qUp && c.Q.prog > c.P.prog) return c.go(-40, 0);
    return c.go(BASE[0], BASE[1]);
  },
  spin(c, st) { return st === 'enter' ? c.go(40, 0) : false; },
  lids(c, st) {
    if (st === 'exit') return false;
    if (st === -0.5) {
      const g = c.P.g, pos = c.local(SIM.platPos(g, c.t)), far = SIM.platDock(g, c.t, 1) > 0;
      return far ? c.go(520, pos[1], 6, true) : c.go(pos[0], pos[1], 6, true);
    }
    if (st !== 'enter') return false;
    for (const key of ['m1', 'm2']) {
      const d = c.devObj(key), pos = c.local(SIM.platPos(d, c.t));
      if (SIM.platDock(d, c.t, 0) > 0.55 && dist(c.me, pos) < 200) return c.go(pos[0], pos[1], 6, true);
    }
    return c.go(-40, 0);
  },
  seesaw(c, st) {
    const A = [150, -80], B = [150, 80];
    if (st === 'enter') return c.go(60, 0);
    if (st === 0.5) return c.go(760, 0, 6, true);
    if (st === 'exit') return c.qUp && c.Q.prog >= progOf(c.k, 0) && c.Q.prog <= progOf(c.k, 0.5) ? c.go(880, 110, 4) : false; // hold the bridge until the partner is over
    if (st !== 0) return false;
    if (c.on('br')) return Math.abs(c.v) > 25 && c.u < 240 ? c.go(240, 0) : c.go(760, 0, 6, true);
    if (c.qPast(0)) return c.go(250, 0);
    if (c.qUp && c.qIn(0)) {
      const jumper = c.q.bot ? c.p.slot === 1 : dist(c.qme, A) < 42;
      if (!jumper) return c.go(A[0], A[1], 4);
      c.go(B[0], B[1], 4);
      if (dist(c.me, B) < 16 && c.grounded && (!c.q.bot || (dist(c.qme, A) < 30 && Math.hypot(c.q.vx, c.q.vy) < 40))) c.out.j = 1;
      return true;
    }
    return c.go(A[0], A[1], 4);
  },
  drawer(c, st) {
    if (st === -0.5) return c.go(360, 0, 6, true);
    if (st !== 'enter') return false;
    const d = c.devObj('dr');
    return SIM.drawerOut(d, c.t) > 1.5 && SIM.drawerK(d, c.t) > 0.9 ? c.go(360, 0, 6, true) : c.go(-40, 0);
  },
  fan(c, st) { return st === 'enter' ? c.go(470, 0, 6, true) : false; },
  train(c, st) {
    if (st === 'enter') return c.go(60, 0);
    if (st === 'exit') return false;
    if (st === 1) return c.go(305, 0);
    if (st === 3) return c.go(550, 0);
    const d = c.devObj(st === 0 ? 't1' : 't2'), edge = st === 0 ? 125 : 375, next = st === 0 ? [305, 0] : [550, 0];
    for (let tau = 0; tau <= 1.0; tau += 0.2) { // is the train in the way of the crossing in the next second?
      const p = SIM.trainPos(d, c.t + tau), mid = c.local({ x: p.x + d.w / 2, y: p.y + d.h / 2 });
      if (Math.abs(mid[1]) < 35 + C.R + 30) return c.go(edge - 40, 0);
    }
    return c.go(next[0], next[1]);
  },
  twin(c, st) {
    const L1 = [240, -230], L2 = [240, 230];
    if (st === 'enter') return c.go(60, 0);
    if (st === 0.5) return c.go(800, 0, 6, true);
    if (st !== 0) return false;
    if (c.on('br')) return Math.abs(c.v) > 25 && c.u < 280 ? c.go(280, 0) : c.go(800, 0, 6, true);
    if (c.qPast(0)) return c.go(280, 0);
    if (c.qUp && c.qIn(0)) {
      const mine = c.q.bot ? (c.p.slot === 0 ? L1 : L2) : dist(c.qme, L1) < dist(c.qme, L2) ? L2 : L1;
      const other = mine === L1 ? 'l2' : 'l1';
      c.go(mine[0], mine[1], 20);
      if (dist(c.me, mine) < 40) {
        const otherPulled = c.S.t - (c.S.leverT[c.devObj(other).id] ?? -9) < 0.8;
        c.A.tw -= C.DT;
        if (c.q.bot ? dist(c.qme, mine === L1 ? L2 : L1) < 40 : (otherPulled || c.A.tw <= 0)) { c.pulse(); if (c.A.tw <= 0) c.A.tw = 1.4; }
      }
      return true;
    }
    return c.go(L1[0], L1[1], 20);
  },
};

function botInput(S, p) {
  if (!p.ai) initBot(p);
  const out = { mx: 0, my: 0, a: p.a, f: 0, j: 0, i: 0 };
  if (p.st === 2 || p.fly || p.fall > 0) return out;
  const A = p.ai, m = S.map, W = S.W, r = SIM.routeOf(p.team), q = SIM.partnerOf(S, p);
  A.t -= C.DT; A.fireT -= C.DT;
  const P = placeOf(S, p), Q = q && q.st !== 2 ? placeOf(S, q) : null, qUp = !!(q && q.st === 0);
  const under = SIM.groundAt(m, W, p.x, p.y, p.z + C.STEP);
  const grounded = p.vz <= 0 && (!under || p.z <= (under.z || 0) + 1);
  let target = null, leap = false, stop = 6;
  const goW = (x, y, s, l) => { target = [x, y]; stop = s ?? 6; leap = !!l; return true; };
  const closedChest = (maxD, f) => { let best = null, bd = maxD; for (const c of m.chests) { if (c.open || Math.abs(c.z - p.z) > 30 || (f && !f(c))) continue; const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = c; } } return best; };
  const openChest = (c) => { goW(c.x, c.y, 44); if (Math.hypot(c.x - p.x, c.y - p.y) < C.CHEST_R - 8) out.i = 1; return true; };

  // enemies in sight
  let foe = null, fd = 680;
  for (const e of S.players) {
    if (e.team === p.team || e.st === 2 || e.fall > 0) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < fd && clearShot(m, W, p, e)) { fd = d; foe = e; }
  }

  // a module's script, run in that module's coordinates
  const runModule = (k, st) => {
    const name = m.course[k].name, ctx = {
      S, p, q, qUp, P, Q: Q || { prog: -1 }, A, out, k, t: W.t, grounded,
      devObj: (key) => m.dev.find((d) => d.route === r && d.mod === k && d.key === key),
      dev: (key) => { const d = ctx.devObj(key); return SIM.modLocal(m, r, k, d.x, d.y); },
      on: (key) => W.on.has(ctx.devObj(key).id),
      local: (pt) => SIM.modLocal(m, r, k, pt.x, pt.y),
      go: (u, v, s, l) => { const [x, y] = SIM.modWorld(m, r, k, u, v); return goW(x, y, s, l); },
      hop: (edge, land) => { ctx.go(land[0], land[1], 6, true); if (grounded && ctx.u > edge - 16 && SIM.modDir(m, r, k, p.vx, p.vy)[0] > 220) out.j = 1; return true; },
      pulse: () => { A.pull = (A.pull + 1) % 4; out.i = A.pull < 2 ? 1 : 0; },
      qBefore: (part) => !!Q && Q.prog < progOf(k, part), qIn: (part) => !!Q && Q.prog === progOf(k, part), qPast: (part) => !!Q && Q.prog > progOf(k, part),
    };
    [ctx.u, ctx.v] = SIM.modLocal(m, r, k, p.x, p.y); ctx.me = [ctx.u, ctx.v];
    ctx.qme = q ? SIM.modLocal(m, r, k, q.x, q.y) : [1e9, 1e9];
    return SCRIPTS[name](ctx, st);
  };

  function arena() {
    const [lx, ly] = SIM.toLocal(m, p.x, p.y, r);
    const W2 = (x, y) => SIM.toWorld(m, x, y, r);
    if (P.k === 10) { // the ring: a chest if empty-handed, then over this side's bridge
      const c = p.w === 0 && !foe && closedChest(380, (c) => c.route === -1);
      if (c) return openChest(c);
      if (ly < -C.RING_IN + 10) return Math.abs(lx) > 30 ? goW(...W2(0, -1010)) : goW(...W2(0, -560));
      return goW(...W2(0, -560)); // on the bridge already: keep going in
    }
    // on the board
    const onTop = grounded && !!under && under.kind === 'tower', mid = m.half;
    let item = null, id = 260;
    for (const it of S.items) { if (Math.abs(it.z - p.z) > 30) continue; const d = Math.hypot(it.x - p.x, it.y - p.y); const want = (it.k[0] === 'w' && p.w === 0) || (it.k === 'heal' && p.hp < 70) || (it.k === 'armor' && p.armor < 20); if (want && d < id) { id = d; item = it; } }
    const chest = p.w === 0 && !foe && closedChest(onTop ? 120 : 420);
    if (onTop) { // up a tower: the golden chest, a few shots from up high, then back down into the fight
      if (chest) return openChest(chest);
      A.topT = (A.topT || 0) + C.DT; if (A.topT < 3 && foe) return goW(p.x, p.y);
      return goW(mid, mid, 6, true);
    }
    A.topT = 0;
    if (item) return goW(item.x, item.y);
    if (chest && Math.hypot(chest.x - p.x, chest.y - p.y) < 300) return openChest(chest);
    // a golden chest still shut on a tower nearby, and nobody close: one braces, the other runs up and jumps
    let gold = A.gold != null ? m.towers[A.gold] : null;
    if (gold && m.chests.some((c) => c.tier && !c.open && Math.abs(c.x - gold.x - C.TILE / 2) < 60 && Math.abs(c.y - gold.y - C.TILE / 2) < 60) === false) { A.gold = null; gold = null; }
    if (!gold && p.w === 0 && qUp && !foe && Math.hypot(q.x - p.x, q.y - p.y) < 400) {
      let bd = 520;
      m.towers.forEach((T, i) => { const d = Math.hypot(T.x + C.TILE / 2 - p.x, T.y + C.TILE / 2 - p.y); if (d < bd && m.chests.some((c) => c.tier && !c.open && Math.abs(c.x - T.x - C.TILE / 2) < 60 && Math.abs(c.y - T.y - C.TILE / 2) < 60)) { bd = d; A.gold = i; } });
      gold = A.gold != null ? m.towers[A.gold] : null; A.goldT = 14;
    }
    if (gold && q && q.bot && q.ai && q.ai.gold == null) q.ai.gold = A.gold, q.ai.goldT = 14; // tell the partner bot
    if (gold) A.goldT -= C.DT;
    if (gold && (A.goldT <= 0 || !qUp || (foe && fd < 260))) { A.gold = null; gold = null; A.trun = false; } // give up: a fight, or too long
    if (gold) {
      const c = [gold.x + C.TILE / 2, gold.y + C.TILE / 2];
      const dx = mid - c[0], dy = mid - c[1], dl = Math.hypot(dx, dy), ux = dx / dl, uy = dy / dl, px = -uy, py = ux;
      const base = [c[0] + ux * 112 + px * 44, c[1] + uy * 112 + py * 44], run = [c[0] + ux * 290, c[1] + uy * 290];
      if (!grounded && A.trun) return goW(c[0], c[1], 4, true); // boosted: keep heading for the top
      if (q.bot ? p.slot === 1 : true) { goW(base[0], base[1], 10); if (Math.hypot(p.x - base[0], p.y - base[1]) < 14) out.i = 1; return true; }
      if (q.brace && Math.hypot(q.x - base[0], q.y - base[1]) < 30) {
        if (!A.trun) { goW(run[0], run[1], 10); if (Math.hypot(p.x - run[0], p.y - run[1]) < 24) A.trun = true; return true; }
        goW(c[0], c[1], 4, true); if (grounded && Math.hypot(p.x - c[0], p.y - c[1]) < 128) out.j = 1; return true;
      }
      A.trun = false; return goW(run[0], run[1]);
    }
    // hunt: get on the far side of the nearest enemy from its nearest drop, at shooting range, and push it over
    let prey = null, pd = 1000;
    for (const e of S.players) {
      if (e.team === p.team || e.st === 2 || e.fall > 0 || e.fly || e.z > 60) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < pd) { pd = d; prey = e; }
    }
    if (prey) {
      if (A.preyId !== prey.id || (A.edgeT -= C.DT) <= 0) { A.preyId = prey.id; A.edgeT = 0.4; A.edge = dropDir(m, W, prey); }
      const Wp = SIM.WEAPONS[p.w], range = Wp.melee ? 50 : SIM.clamp(Wp.speed * Wp.life * 0.45, 130, 300);
      const [ex, ey] = A.edge;
      return goW(prey.x - ex * range, prey.y - ey * range, 20);
    }
    if (!A.spot || A.spotT <= 0) { const a = Math.random() * 6.28, d = Math.random() * 200; A.spot = [mid + Math.cos(a) * d, mid + Math.sin(a) * d]; A.spotT = 2 + Math.random() * 2; }
    A.spotT -= C.DT; return goW(A.spot[0], A.spot[1]);
  }

  if (p.st === 1) { if (q && q.st === 0) goW(q.x, q.y); }
  else if (q && q.st === 1 && Math.hypot(q.x - p.x, q.y - p.y) < 420 && Math.abs(q.z - p.z) < 20 && Q && Math.abs(Q.prog - P.prog) <= 2) goW(q.x, q.y); // pick the partner up
  else if (P.k <= 9) {
    const name = m.course[P.k].name, last = P.k === 0 || P.k === 5 || P.part === MODS[name].ground.length - 1;
    if (last) {
      const c = (P.k === 0 || P.k === 5) && p.w === 0 && closedChest(320, (c) => c.route === r);
      if (c) openChest(c);
      else if (!(P.k !== 0 && P.k !== 5 && runModule(P.k, 'exit'))) {
        if (P.k === 9) { const [x, y] = SIM.toWorld(m, -300, -1010, r); goW(x, y); } // onto the ring
        else if (P.k === 4) { const [x, y] = SIM.modWorld(m, r, 5, -160, 0); goW(x, y); } // into the corner
        else runModule(P.k + 1, 'enter');
      }
    } else runModule(P.k, P.part);
  } else arena();

  // out of the marble's way
  const mb = SIM.marbleAt(m, W.t);
  if (mb && P.k === 11 && p.z < 100) {
    const lat = mb.ev.axis ? p.x - mb.x : p.y - mb.y, ahead = mb.ev.axis ? (p.y - mb.y) * Math.sign(mb.vy) : (p.x - mb.x) * Math.sign(mb.vx);
    if (Math.abs(lat) < C.MARBLE_R + 70 && ahead > -40) { const s = Math.sign(lat) || 1; target = mb.ev.axis ? [mb.x + s * 260, p.y] : [p.x, mb.y + s * 260]; leap = false; stop = 6; }
  }

  // steer
  const tl = target ? Math.hypot(target[0] - p.x, target[1] - p.y) : 0;
  if (target && tl > stop) {
    const dx = target[0] - p.x, dy = target[1] - p.y, s = tl < 40 ? Math.max(0.25, tl / 40) : 1;
    out.mx = dx / tl * s; out.my = dy / tl * s;
  }
  // stay on the furniture: never walk off an edge (or onto a tile about to crumble) unless leaping on purpose
  const safe = (x, y) => { const g = SIM.groundAt(m, W, x, y, p.z + C.STEP); return g && !(g.tile !== undefined && SIM.tileState(m, g.tile, W.t + 1.6) > 0); };
  if (!leap && grounded && (out.mx || out.my)) {
    const l = Math.hypot(out.mx, out.my), ux = out.mx / l, uy = out.my / l;
    if (!safe(p.x + ux * 34, p.y + uy * 34)) {
      let ok = false;
      for (const a of [0.6, -0.6, 1.2, -1.2, 1.57, -1.57, 2.2, -2.2]) {
        const ca = Math.cos(a), sa = Math.sin(a), vx = ux * ca - uy * sa, vy = ux * sa + uy * ca;
        if (safe(p.x + vx * 34, p.y + vy * 34)) { out.mx = vx * l * 0.7; out.my = vy * l * 0.7; ok = true; break; }
      }
      if (!ok) out.mx = out.my = 0;
    }
  }
  // feel the way round blocks, closed gates and tower walls
  if ((out.mx || out.my) && tl > 80) {
    const ax = p.x + out.mx * 36, ay = p.y + out.my * 36, g = SIM.groundAt(m, W, ax, ay);
    if (SIM.blocked(m, W, ax, ay, C.R, p.z) || (g && (g.z || 0) > p.z + C.STEP)) { const s = A.strafe; const mx = out.mx; out.mx = -out.my * s; out.my = mx * s; }
  }
  // jump the spinning pencils
  if (grounded) for (const d of m.dev) {
    if (d.type !== 'spin' || d.route !== r) continue;
    const a = SIM.spinAng(d, W.t + 0.12), ca = Math.cos(a), sa = Math.sin(a), rx = p.x - d.x, ry = p.y - d.y;
    const along = SIM.clamp(rx * ca + ry * sa, -d.len, d.len);
    if (Math.hypot(rx - ca * along, ry - sa * along) < C.R + 30) out.j = 1;
  }
  // shoot
  if (foe && p.st === 0 && !p.brace) {
    const Wp = SIM.WEAPONS[p.w], lead = fd / Wp.speed;
    out.a = Math.atan2(foe.y + foe.vy * lead - p.y, foe.x + foe.vx * lead - p.x) + (Math.random() - 0.5) * 0.2;
    if (fd < Wp.speed * Wp.life * 0.95 && A.fireT <= 0) { out.f = 1; if (Math.random() < 0.06) A.fireT = 0.5; }
  } else if (out.mx || out.my) out.a = Math.atan2(out.my, out.mx);
  return out;
}

module.exports = { botInput, initBot, placeOf };
