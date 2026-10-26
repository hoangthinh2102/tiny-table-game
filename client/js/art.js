'use strict';
/* ===== Tiny Tumble — procedural art (until the painted sprites arrive) =====
   Everything is drawn once on 2D canvases and turned into textures. Look: a child's desk at golden hour, seen from
   above at a slight tilt. Each surface (cardboard box, toy blocks, books, a velvet box, a cookie tin, the board game)
   shows its top and a front face, and casts a soft shadow onto the room floor far below. Warm light comes from the
   window at the top, so shadows fall towards the bottom of the screen. */
const ART = {};
ART.PAL = {
  wood: ['#c98a4f', '#d79a5c', '#bf7f45', '#e2a967'], woodLine: 'rgba(90,45,20,.28)',
  toy: ['#e8553f', '#f39c32', '#f6c844', '#2bb3a3', '#3a7bd5', '#8e5bd6'],
  team: ['#ff6b4a', '#2bb3a3', '#ffb347', '#8e5bd6', '#3a7bd5', '#e84f8a', '#6cc24a', '#c0773a'],
  shadow: 'rgba(52,22,40,', ink: '#2a1f3d',
};
ART.FRONT = 44; // height of a surface's front face
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
const mix = (hex, hex2, t) => { const a = parseInt(hex.slice(1), 16), b = parseInt(hex2.slice(1), 16); const c = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t); return `rgb(${c(16)},${c(8)},${c(0)})`; };
ART.shade = shade; ART.mix = mix;
const tex = (c) => PIXI.Texture.from(c);
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); }
const LETTERS = 'ABCDEGHIKLMNOPQRSTUVXY';

/* ---------- the room floor far below the desk: dark, soft, a little out of focus ---------- */
ART.void = function (map) {
  const k = 0.2, pad = 1800, W = (map.w + pad * 2) * k, H = (map.h + pad * 2) * k;
  const c = canvas(W, H), g = c.getContext('2d'), R = SIM.rng(map.seed ^ 0xbeef);
  const pw = 170 * k;
  for (let x = 0; x < W; x += pw) {
    let y = -R() * 300 * k;
    while (y < H) { const len = (500 + R() * 800) * k; g.fillStyle = ['#7a4a33', '#865238', '#6e4230', '#8d5a3c'][(R() * 4) | 0]; g.fillRect(x, y, pw, len); g.fillStyle = 'rgba(40,18,10,.35)'; g.fillRect(x, y + len - 2, pw, 2); y += len; }
    g.fillStyle = 'rgba(30,12,8,.4)'; g.fillRect(x, 0, 1.5, H);
  }
  // a huge rug, and toys lying about far below
  g.save(); g.translate(W * 0.5, H * 0.55); g.rotate(0.06);
  g.fillStyle = '#2b5e63'; rr(g, -W * 0.36, -H * 0.3, W * 0.72, H * 0.6, 30); g.fill();
  g.strokeStyle = '#b98d5e'; g.lineWidth = 14; rr(g, -W * 0.33, -H * 0.27, W * 0.66, H * 0.54, 20); g.stroke();
  g.restore();
  for (let i = 0; i < 26; i++) {
    const x = R() * W, y = R() * H, s = (60 + R() * 160) * k * 2.2, col = ART.PAL.toy[(R() * 6) | 0];
    g.fillStyle = 'rgba(20,8,20,.22)'; g.beginPath(); g.ellipse(x + s * 0.2, y + s * 0.5, s * 0.6, s * 0.3, 0, 0, 7); g.fill();
    g.fillStyle = col;
    if (R() < 0.5) { rr(g, x - s / 2, y - s / 2, s, s, s * 0.15); g.fill(); } else { g.beginPath(); g.arc(x, y, s / 2, 0, 7); g.fill(); }
  }
  // out of focus and in the shade of the desk
  const c2 = canvas(W, H), g2 = c2.getContext('2d');
  g2.filter = 'blur(3px)'; g2.drawImage(c, 0, 0); g2.filter = 'none';
  g2.fillStyle = 'rgba(46,20,40,.34)'; g2.fillRect(0, 0, W, H);
  const vg = g2.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
  vg.addColorStop(0, 'rgba(255,180,100,.14)'); vg.addColorStop(1, 'rgba(24,8,28,.4)');
  g2.fillStyle = vg; g2.fillRect(0, 0, W, H);
  return { tex: tex(c2), x: -pad, y: -pad, w: map.w + pad * 2, h: map.h + pad * 2 };
};

/* ---------- the shadows the desk things cast onto the floor below (one blurred canvas for the whole map) ---------- */
ART.shadows = function (map) {
  const k = 0.1, W = map.w * k + 40, H = map.h * k + 40, c = canvas(W, H), g = c.getContext('2d');
  g.filter = 'blur(4px)'; g.fillStyle = 'rgba(18,6,20,.62)';
  for (const o of map.ground.concat(map.tiles.filter(Boolean))) { rr(g, (o.x + 40) * k + 20, (o.y + 110) * k + 20, o.w * k, (o.h + ART.FRONT) * k, 3); g.fill(); }
  return { tex: tex(c), x: -200, y: -200, w: W / k, h: H / k };
};

/* ---------- surfaces: top + front face ---------- */
function front(g, x, y, w, h, col, r) {
  const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, shade(col, 0.78)); gr.addColorStop(1, shade(col, 0.5));
  g.fillStyle = gr; rr(g, x, y - r, w, h + r, r); g.fill();
}
function grain(g, x, y, w, h, R, alpha) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.strokeStyle = `rgba(90,45,15,${alpha})`; g.lineWidth = 1.5;
  for (let i = 0; i < w * h / 2500; i++) { const gx = x + R() * w, gy = y + R() * h, l = 40 + R() * 120; g.beginPath(); g.moveTo(gx, gy); g.bezierCurveTo(gx + l * 0.3, gy + (R() - 0.5) * 8, gx + l * 0.6, gy + (R() - 0.5) * 8, gx + l, gy); g.stroke(); }
  g.restore();
}
function topLight(g, x, y, w, h, r) { // warm light from the window, darker towards the front
  const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, 'rgba(255,230,170,.22)'); gr.addColorStop(1, 'rgba(60,20,40,.12)');
  g.fillStyle = gr; rr(g, x, y, w, h, r); g.fill();
  g.strokeStyle = 'rgba(255,245,220,.5)'; g.lineWidth = 3; rr(g, x + 1.5, y + 1.5, w - 3, h - 3, r); g.stroke();
}
ART.surface = function (o, idx, teamCol) {
  const F = ART.FRONT, pad = 4, W = o.w + pad * 2, H = o.h + F + pad * 2;
  const c = canvas(W, H), g = c.getContext('2d'), R = SIM.rng(idx * 977 + 13);
  g.translate(pad, pad);
  const w = o.w, h = o.h;
  if (o.kind === 'box') { // cardboard box with taped flaps in the duo's colour
    front(g, 0, h, w, F, '#c99560', 14);
    g.strokeStyle = 'rgba(90,50,20,.18)'; g.lineWidth = 2; for (let x = 8; x < w; x += 9) { g.beginPath(); g.moveTo(x, h + 2); g.lineTo(x, h + F - 4); g.stroke(); }
    g.fillStyle = '#d9a86c'; rr(g, 0, 0, w, h, 14); g.fill();
    g.strokeStyle = 'rgba(120,70,30,.35)'; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w / 2, h - 6); g.moveTo(8, h / 2); g.lineTo(w - 8, h / 2); g.stroke();
    g.fillStyle = teamCol; g.globalAlpha = 0.85; g.fillRect(w / 2 - 26, 0, 52, h); g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(w / 2 - 26, 0, 10, h);
    g.fillStyle = 'rgba(80,40,20,.25)'; g.font = '900 30px "Baloo 2", Nunito, sans-serif'; g.textAlign = 'center'; g.fillText('↑ FRAGILE', w * 0.27, h * 0.82);
    topLight(g, 0, 0, w, h, 14);
  } else if (o.kind === 'block') { // a toy block with a carved letter
    const col = ART.PAL.toy[idx % 6];
    front(g, 0, h, w, F, col, 14);
    const gt = g.createLinearGradient(0, 0, 0, h); gt.addColorStop(0, shade(col, 1.12)); gt.addColorStop(1, shade(col, 0.95));
    g.fillStyle = gt; rr(g, 0, 0, w, h, 14); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 4; rr(g, 12, 12, w - 24, h - 24, 9); g.stroke();
    g.fillStyle = shade(col, 0.62); g.font = `900 ${Math.min(w, h) * 0.55}px "Baloo 2", Nunito, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(LETTERS[(R() * LETTERS.length) | 0], w / 2, h / 2 + 4);
    topLight(g, 0, 0, w, h, 14);
  } else if (o.kind === 'book') { // a hardcover lying flat: pages at the front, cloth cover on top
    const col = ['#b8433a', '#2f6f8f', '#5d8a3a'][idx % 3];
    g.fillStyle = '#f2e6c8'; rr(g, 6, h - 8, w - 12, F + 4, 6); g.fill();
    g.strokeStyle = 'rgba(120,90,60,.35)'; g.lineWidth = 1; for (let k = 4; k < F; k += 4) { g.beginPath(); g.moveTo(8, h + k - 6); g.lineTo(w - 8, h + k - 6); g.stroke(); }
    g.fillStyle = shade(col, 0.7); g.fillRect(0, h - 4, w, 8);
    const gt = g.createLinearGradient(0, 0, w, 0); gt.addColorStop(0, shade(col, 0.82)); gt.addColorStop(0.06, shade(col, 1.06)); gt.addColorStop(1, shade(col, 0.92));
    g.fillStyle = gt; rr(g, 0, 0, w, h, 10); g.fill();
    g.globalAlpha = 0.08; g.fillStyle = '#000'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1.5); g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,215,130,.75)'; g.lineWidth = 3; rr(g, 18, 18, w - 36, h - 36, 6); g.stroke();
    g.fillStyle = 'rgba(255,225,150,.85)'; rr(g, w * 0.25, h * 0.38, w * 0.5, h * 0.12, 5); g.fill();
    topLight(g, 0, 0, w, h, 10);
  } else if (o.kind === 'velvet') { // a jewellery box: purple velvet in a gold rim
    front(g, 0, h, w, F, '#6b3d8a', 18);
    g.fillStyle = '#e6b84f'; rr(g, w / 2 - 14, h + 6, 28, 20, 4); g.fill();
    g.fillStyle = '#d9a840'; rr(g, 0, 0, w, h, 18); g.fill();
    const gv = g.createRadialGradient(w * 0.4, h * 0.35, 10, w / 2, h / 2, Math.max(w, h) * 0.7); gv.addColorStop(0, '#9a5cc0'); gv.addColorStop(1, '#5c2f7a');
    g.fillStyle = gv; rr(g, 12, 12, w - 24, h - 24, 12); g.fill();
    g.globalAlpha = 0.07; g.fillStyle = '#fff'; for (let i = 0; i < 900; i++) g.fillRect(12 + R() * (w - 24), 12 + R() * (h - 24), 2, 2); g.globalAlpha = 1;
    topLight(g, 0, 0, w, h, 18);
  } else if (o.kind === 'tin') { // a cookie tin, teal with a pressed pattern
    front(g, 0, h, w, F, '#2f8f8a', 22);
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(10, h + 10); g.lineTo(w - 10, h + 10); g.stroke();
    const gt = g.createLinearGradient(0, 0, w, h); gt.addColorStop(0, '#5cc9c0'); gt.addColorStop(1, '#2a8a85');
    g.fillStyle = gt; rr(g, 0, 0, w, h, 22); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 5; rr(g, 10, 10, w - 20, h - 20, 16); g.stroke();
    g.fillStyle = 'rgba(255,240,200,.28)';
    for (let y = 40; y < h - 20; y += 52) for (let x = 40; x < w - 20; x += 52) { g.beginPath(); for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, rr2 = k % 2 ? 7 : 15; g.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); } g.fill(); }
    topLight(g, 0, 0, w, h, 22);
  } else if (o.kind === 'box2') { // a shoebox lid, striped
    front(g, 0, h, w, F, '#e6d3b0', 12);
    g.fillStyle = '#f3e3c8'; rr(g, 0, 0, w, h, 12); g.fill();
    g.save(); rr(g, 0, 0, w, h, 12); g.clip();
    g.fillStyle = 'rgba(232,85,63,.22)'; for (let x = -h; x < w; x += 46) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 22, 0); g.lineTo(x + 22 + h, h); g.lineTo(x + h, h); g.fill(); }
    g.restore();
    g.fillStyle = '#e8553f'; rr(g, w * 0.3, h * 0.42, w * 0.4, 30, 8); g.fill();
    g.fillStyle = '#fff'; g.font = '900 20px "Baloo 2", Nunito'; g.textAlign = 'center'; g.fillText('SHOES', w / 2, h * 0.42 + 22);
    topLight(g, 0, 0, w, h, 12);
  } else if (o.kind === 'rails') { // a wooden plank with toy train rails across it
    front(g, 0, h, w, F, '#b98055', 8);
    g.fillStyle = '#d7a273'; rr(g, 0, 0, w, h, 8); g.fill(); grain(g, 0, 0, w, h, R, 0.18);
    topLight(g, 0, 0, w, h, 8);
  } else if (o.kind === 'ring') { // the wooden frame round the board
    front(g, 0, h, w, F, '#8a5432', 10);
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#c98a4f'); gr.addColorStop(1, '#b0743f');
    g.fillStyle = gr; rr(g, 0, 0, w, h, 10); g.fill(); grain(g, 0, 0, w, h, R, 0.2);
    g.strokeStyle = 'rgba(255,235,200,.35)'; g.lineWidth = 3; g.setLineDash([16, 12]); rr(g, 14, 14, w - 28, h - 28, 6); g.stroke(); g.setLineDash([]);
    topLight(g, 0, 0, w, h, 10);
  } else if (o.kind === 'ruler') { // a fixed ruler bridge
    const r = ART.rulerCanvas(w, h); g.drawImage(r, -4, -4);
  } else if (o.kind === 'table') { // the board game everyone races to
    front(g, 0, h, w, F, '#8a5432', 26);
    g.fillStyle = '#f4e7c9'; rr(g, 0, 0, w, h, 26); g.fill();
    // a track of coloured squares round the edge and a spiral towards the middle
    const sq = 72, n = Math.floor((w - 60) / sq);
    for (let i = 0; i < n; i++) for (const [x, y] of [[30 + i * sq, 30], [30 + i * sq, h - 30 - sq], [30, 30 + i * sq], [w - 30 - sq, 30 + i * sq]]) {
      g.fillStyle = ART.PAL.toy[(i + ((x + y) | 0)) % 6]; rr(g, x + 4, y + 4, sq - 8, sq - 8, 10); g.fill();
      g.fillStyle = 'rgba(255,255,255,.3)'; rr(g, x + 8, y + 8, sq - 16, 10, 5); g.fill();
    }
    g.strokeStyle = 'rgba(160,110,70,.35)'; g.lineWidth = 26; g.lineCap = 'round'; g.beginPath();
    for (let a = 0; a < Math.PI * 5; a += 0.05) { const rr2 = 140 + a * 26; g.lineTo(w / 2 + Math.cos(a) * rr2, h / 2 + Math.sin(a) * rr2); }
    g.stroke();
    // the flag ring
    const gc = g.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, 190); gc.addColorStop(0, '#fff6dc'); gc.addColorStop(1, '#f1d9a8');
    g.fillStyle = gc; g.beginPath(); g.arc(w / 2, h / 2, 185, 0, 7); g.fill();
    g.strokeStyle = '#d4a65e'; g.lineWidth = 8; g.beginPath(); g.arc(w / 2, h / 2, 185, 0, 7); g.stroke();
    g.fillStyle = 'rgba(212,166,94,.5)'; g.beginPath(); for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 - Math.PI / 2, rr2 = k % 2 ? 46 : 110; g.lineTo(w / 2 + Math.cos(a) * rr2, h / 2 + Math.sin(a) * rr2); } g.fill();
    topLight(g, 0, 0, w, h, 26);
  }
  return { tex: tex(c), x: o.x - pad, y: o.y - pad };
};

/* ---------- moving and switching parts ---------- */
// a wooden ruler, laid along its long side (w x h footprint), with a thin front face
ART.ruler = function (w, h) { return { tex: tex(ART.rulerCanvas(w, h)), ox: 4, oy: 4 }; };
ART.rulerCanvas = function (w, h) {
  const F = 12, horiz = w >= h, c = canvas(w + 8, h + F + 8), g = c.getContext('2d'); g.translate(4, 4);
  front(g, 0, h, w, F, '#d9a23c', 6);
  const gr = horiz ? g.createLinearGradient(0, 0, 0, h) : g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#ffe08a'); gr.addColorStop(1, '#f2b84a');
  g.fillStyle = gr; rr(g, 0, 0, w, h, 6); g.fill();
  g.strokeStyle = 'rgba(90,50,10,.6)'; g.lineWidth = 1.5; g.fillStyle = 'rgba(90,50,10,.7)'; g.font = '800 11px Nunito'; g.textAlign = 'center';
  const L = horiz ? w : h;
  for (let k = 8, i = 0; k < L - 4; k += 10, i++) {
    const len = i % 10 === 0 ? 22 : i % 5 === 0 ? 15 : 9;
    g.beginPath(); if (horiz) { g.moveTo(k, 0); g.lineTo(k, len); } else { g.moveTo(0, k); g.lineTo(len, k); } g.stroke();
    if (i % 10 === 0 && i) { if (horiz) g.fillText(i / 10, k, 34); else g.fillText(i / 10, 32, k + 4); }
  }
  return c;
};
// a jar lid floating over the drop
ART.lid = function (w, h, col) {
  const F = 18, c = canvas(w + 8, h + F + 8), g = c.getContext('2d'); g.translate(4, 4);
  front(g, 0, h, w, F, col, 24);
  g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = 2; for (let x = 10; x < w; x += 8) { g.beginPath(); g.moveTo(x, h + 2); g.lineTo(x, h + F - 3); g.stroke(); }
  const gr = g.createRadialGradient(w * 0.35, h * 0.3, 6, w / 2, h / 2, w * 0.7); gr.addColorStop(0, mix(col, '#ffffff', 0.35)); gr.addColorStop(1, shade(col, 0.85));
  g.fillStyle = gr; rr(g, 0, 0, w, h, 24); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 4; rr(g, 9, 9, w - 18, h - 18, 18); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '900 20px "Baloo 2", Nunito'; g.textAlign = 'center'; g.fillText('JAM', w / 2, h / 2 + 7);
  return { tex: tex(c), ox: 4, oy: 4 };
};
// a gate: coloured pencils standing in a row (w x h footprint), drawn standing up by `up`
ART.gate = function (w, h) {
  const up = 74, c = canvas(w + 8, h + up + 8), g = c.getContext('2d'); g.translate(4, 4 + up);
  const horiz = w >= h, n = Math.max(1, Math.floor((horiz ? w : h) / 22));
  g.fillStyle = 'rgba(52,22,40,.35)'; rr(g, -2, 4, w + 4, h + 6, 8); g.fill();
  const cols = ART.PAL.toy;
  // pencils from back to front so the nearer ones overlap
  for (let i = 0; i < n; i++) {
    const px = horiz ? 2 + i * (w - 4) / n : 2, py = horiz ? 2 : 2 + i * (h - 4) / n, pw = horiz ? (w - 4) / n - 2 : w - 4, ph = horiz ? h - 4 : (h - 4) / n - 2;
    const col = cols[i % 6], top = py - up;
    g.fillStyle = shade(col, 0.75); g.fillRect(px, top + 10, pw, up + ph - 10);
    g.fillStyle = col; g.fillRect(px, top + 10, pw * 0.55, up + ph - 10);
    g.fillStyle = '#f1d3a1'; g.beginPath(); g.moveTo(px, top + 12); g.lineTo(px + pw / 2, top - 6); g.lineTo(px + pw, top + 12); g.fill();
    g.fillStyle = shade(col, 0.6); g.beginPath(); g.moveTo(px + pw * 0.35, top + 1); g.lineTo(px + pw / 2, top - 6); g.lineTo(px + pw * 0.65, top + 1); g.fill();
  }
  return { tex: tex(c), ox: 4, oy: 4 + up, up };
};
// a round button on the floor (up / pressed)
ART.plate = function (col, down) {
  const S = 2, R = 44, c = canvas((R * 2 + 8) * S, (R * 2 + 24) * S), g = c.getContext('2d'); g.scale(S, S); g.translate(R + 4, R + 4);
  g.fillStyle = 'rgba(52,22,40,.3)'; g.beginPath(); g.ellipse(4, 10, R, R * 0.9, 0, 0, 7); g.fill();
  g.fillStyle = '#e9dcc4'; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
  g.strokeStyle = 'rgba(120,90,60,.4)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, R - 2, 0, 7); g.stroke();
  const lift = down ? 2 : 9;
  g.fillStyle = shade(col, 0.6); g.beginPath(); g.ellipse(0, 4, R * 0.72, R * 0.66, 0, 0, 7); g.fill();
  const gr = g.createRadialGradient(-8, -10 - lift, 4, 0, -lift, R * 0.7); gr.addColorStop(0, mix(col, '#ffffff', down ? 0.15 : 0.45)); gr.addColorStop(1, shade(col, down ? 0.8 : 1));
  g.fillStyle = gr; g.beginPath(); g.arc(0, -lift + 4, R * 0.7, 0, 7); g.fill();
  if (!down) { g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.ellipse(-10, -lift - 8, 10, 5, -0.4, 0, 7); g.fill(); }
  return { tex: tex(c), w: R * 2 + 8, h: R * 2 + 24, ax: 0.5, ay: (R + 4) / (R * 2 + 24) };
};
ART.leverBase = function () {
  const S = 2, c = canvas(70 * S, 50 * S), g = c.getContext('2d'); g.scale(S, S);
  g.fillStyle = 'rgba(52,22,40,.3)'; g.beginPath(); g.ellipse(38, 40, 30, 9, 0, 0, 7); g.fill();
  g.fillStyle = '#7a4a2e'; rr(g, 10, 18, 50, 24, 8); g.fill();
  g.fillStyle = '#a8683f'; rr(g, 10, 12, 50, 18, 8); g.fill();
  g.fillStyle = '#5a321e'; rr(g, 30, 16, 10, 8, 3); g.fill();
  return { tex: tex(c), w: 70, h: 50 };
};
ART.leverStick = function () {
  const S = 2, c = canvas(20 * S, 60 * S), g = c.getContext('2d'); g.scale(S, S);
  g.fillStyle = '#d9d2c4'; rr(g, 7, 14, 6, 46, 3); g.fill();
  const gr = g.createRadialGradient(8, 8, 2, 10, 11, 10); gr.addColorStop(0, '#ff9b80'); gr.addColorStop(1, '#d6402c');
  g.fillStyle = gr; g.beginPath(); g.arc(10, 11, 9, 0, 7); g.fill();
  return { tex: tex(c), w: 20, h: 60 };
};
// the pencil that spins on a pin (length 2*len, pointing right)
ART.pencil = function (len) {
  const S = 2, L = len * 2 + 10, c = canvas(L * S, 30 * S), g = c.getContext('2d'); g.scale(S, S);
  g.fillStyle = '#f6c844'; rr(g, 18, 6, L - 40, 18, 3); g.fill();
  g.fillStyle = '#e0a92a'; g.fillRect(18, 15, L - 40, 9);
  g.fillStyle = '#e88aa0'; rr(g, 2, 6, 14, 18, 4); g.fill(); g.fillStyle = '#c8c8c8'; g.fillRect(14, 6, 6, 18);
  g.fillStyle = '#f1d3a1'; g.beginPath(); g.moveTo(L - 22, 6); g.lineTo(L - 2, 15); g.lineTo(L - 22, 24); g.fill();
  g.fillStyle = '#3a2a2a'; g.beginPath(); g.moveTo(L - 8, 12.3); g.lineTo(L - 2, 15); g.lineTo(L - 8, 17.7); g.fill();
  return { tex: tex(c), w: L, h: 30 };
};
ART.pin = function () {
  const S = 2, c = canvas(36 * S, 36 * S), g = c.getContext('2d'); g.scale(S, S);
  const gr = g.createRadialGradient(14, 12, 2, 18, 18, 14); gr.addColorStop(0, '#ff9ab0'); gr.addColorStop(1, '#c43a5a');
  g.fillStyle = gr; g.beginPath(); g.arc(18, 18, 13, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.ellipse(13, 12, 5, 3, -0.5, 0, 7); g.fill();
  return { tex: tex(c), w: 36, h: 36 };
};
// the seesaw: a ruler on an eraser, end A (stand) to end B (land), drawn horizontally; rotated when placed
ART.seesaw = function (len) {
  const S = 2, L = len + 90, c = canvas(L * S, 70 * S), g = c.getContext('2d'); g.scale(S, S);
  g.fillStyle = 'rgba(52,22,40,.3)'; g.beginPath(); g.ellipse(L / 2 + 6, 52, L / 2 - 10, 10, 0, 0, 7); g.fill();
  g.fillStyle = '#ff9fb2'; rr(g, L / 2 - 22, 26, 44, 26, 6); g.fill(); g.fillStyle = '#e46f88'; g.fillRect(L / 2 - 22, 40, 44, 12);
  const gr = g.createLinearGradient(0, 18, 0, 36); gr.addColorStop(0, '#ffe08a'); gr.addColorStop(1, '#efb040');
  g.fillStyle = gr; rr(g, 6, 18, L - 12, 18, 5); g.fill();
  g.strokeStyle = 'rgba(90,50,10,.55)'; g.lineWidth = 1.2; for (let x = 14; x < L - 10; x += 8) { g.beginPath(); g.moveTo(x, 18); g.lineTo(x, x % 40 < 8 ? 28 : 23); g.stroke(); }
  return { tex: tex(c), w: L, h: 70 };
};
// a toy treasure chest; golden ones on the board game
ART.chest = function (tier, open) {
  const S = 2, W = 70, H = 76, c = canvas(W * S, H * S), g = c.getContext('2d'); g.scale(S, S);
  const wood = tier ? '#d9a630' : '#b36a3a', band = tier ? '#fff1b0' : '#e8b44f';
  g.fillStyle = 'rgba(52,22,40,.35)'; g.beginPath(); g.ellipse(38, 66, 32, 9, 0, 0, 7); g.fill();
  g.fillStyle = shade(wood, 0.75); rr(g, 6, 34, 58, 32, 6); g.fill();
  g.fillStyle = band; g.fillRect(14, 34, 6, 32); g.fillRect(50, 34, 6, 32);
  if (open) {
    g.fillStyle = shade(wood, 0.55); rr(g, 6, 10, 58, 26, 8); g.fill();
    g.fillStyle = '#3a1e14'; rr(g, 10, 28, 50, 10, 4); g.fill();
    const gl = g.createRadialGradient(35, 30, 2, 35, 30, 30); gl.addColorStop(0, 'rgba(255,240,170,.9)'); gl.addColorStop(1, 'rgba(255,240,170,0)');
    g.fillStyle = gl; g.fillRect(0, 0, W, 44);
  } else {
    const gr = g.createLinearGradient(0, 14, 0, 38); gr.addColorStop(0, mix(wood, '#ffffff', 0.25)); gr.addColorStop(1, wood);
    g.fillStyle = gr; rr(g, 6, 14, 58, 24, 12); g.fill();
    g.fillStyle = band; g.fillRect(14, 14, 6, 24); g.fillRect(50, 14, 6, 24);
    g.fillStyle = tier ? '#fff' : '#ffe08a'; rr(g, 29, 30, 12, 14, 3); g.fill();
    g.fillStyle = '#5a321e'; g.fillRect(33.5, 35, 3, 5);
  }
  return { tex: tex(c), w: W, h: H };
};
// pickups lying on the floor
ART.item = function (k) {
  const S = 2, c = canvas(56 * S, 56 * S), g = c.getContext('2d'); g.scale(S, S); g.translate(28, 28);
  if (k === 'heal') { // a sticking plaster
    g.rotate(-0.5); g.fillStyle = '#f2c6a0'; rr(g, -22, -9, 44, 18, 9); g.fill();
    g.fillStyle = '#fbe3cc'; rr(g, -8, -8, 16, 16, 3); g.fill();
    g.fillStyle = '#e5484d'; g.fillRect(-2, -6, 4, 12); g.fillRect(-6, -2, 12, 4);
  } else if (k === 'armor') { // a bottle cap
    g.fillStyle = '#4a7bd5'; g.beginPath(); for (let i = 0; i < 21; i++) { const a = i / 21 * Math.PI * 2, r = i % 2 ? 17 : 20; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill();
    const gr = g.createRadialGradient(-5, -5, 2, 0, 0, 16); gr.addColorStop(0, '#a8c8ff'); gr.addColorStop(1, '#3a66c0');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 14, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '900 14px Nunito'; g.textAlign = 'center'; g.fillText('+', 0, 5);
  } else { g.rotate(-0.4); g.drawImage(ART.gunCanvas(0, +k[1]), -24, -10, 48, 22); }
  return tex(c);
};
// the weapons, pointing right, grip at the left (0 slingshot, 1 crayon gun, 2 rubber-band gun, 3 stapler, 4 marble bomb)
ART.gunCanvas = function (team, w) {
  const S = 3, W = 46, H = 22, c = canvas(W * S, H * S), g = c.getContext('2d'); g.scale(S, S);
  const col = ART.PAL.team[team % 8];
  if (w === 0) { // slingshot: a wooden Y with a band
    g.strokeStyle = '#a8743e'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(4, 14); g.lineTo(18, 11); g.lineTo(30, 4); g.moveTo(18, 11); g.lineTo(30, 18); g.stroke();
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(30, 4); g.lineTo(24, 11); g.lineTo(30, 18); g.stroke();
  } else if (w === 1) { // a fat crayon with a trigger
    g.fillStyle = '#8a5a3a'; rr(g, 4, 10, 9, 10, 2); g.fill();
    g.fillStyle = '#e8553f'; rr(g, 8, 5, 28, 10, 3); g.fill(); g.fillStyle = '#c23b2a'; g.fillRect(8, 11, 28, 4);
    g.fillStyle = '#e8553f'; g.beginPath(); g.moveTo(36, 5); g.lineTo(44, 10); g.lineTo(36, 15); g.fill();
    g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(14, 6, 16, 2);
  } else if (w === 2) { // rubber-band gun: wooden frame with bands
    g.fillStyle = '#c99a62'; rr(g, 4, 9, 10, 11, 2); g.fill(); g.fillRect(10, 7, 32, 6);
    g.strokeStyle = '#6cc24a'; g.lineWidth = 2; for (let x = 18; x < 40; x += 6) { g.beginPath(); g.moveTo(x, 5); g.lineTo(x, 15); g.stroke(); }
  } else if (w === 3) { // a stapler
    g.fillStyle = '#3a3f55'; rr(g, 4, 12, 40, 7, 3); g.fill();
    g.fillStyle = '#5b78d6'; rr(g, 6, 5, 38, 8, 4); g.fill(); g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(10, 6, 26, 2);
  } else if (w === 5) { // balloon air blaster: a pump with a funnel
    g.fillStyle = '#e84f8a'; rr(g, 4, 7, 22, 10, 4); g.fill();
    g.fillStyle = '#ffd0e0'; g.fillRect(8, 9, 14, 2);
    g.fillStyle = '#f6c844'; g.beginPath(); g.moveTo(26, 9); g.lineTo(44, 3); g.lineTo(44, 21); g.lineTo(26, 15); g.fill();
  } else if (w === 6) { // toy hammer: a squeaky mallet
    g.fillStyle = '#a8743e'; rr(g, 2, 9, 30, 5, 2); g.fill();
    g.fillStyle = '#e8553f'; rr(g, 28, 1, 16, 20, 5); g.fill(); g.fillStyle = '#ffe08a'; rr(g, 28, 1, 4, 20, 2); g.fill(); rr(g, 40, 1, 4, 20, 2); g.fill();
  } else { // marble launcher: a cup on a stick with a marble
    g.fillStyle = '#a8743e'; rr(g, 2, 10, 26, 5, 2); g.fill();
    g.fillStyle = '#3a7bd5'; g.beginPath(); g.ellipse(32, 11, 9, 8, 0, 0, 7); g.fill();
    const gr = g.createRadialGradient(31, 8, 1, 33, 11, 7); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#8e5bd6');
    g.fillStyle = gr; g.beginPath(); g.arc(33, 10, 6, 0, 7); g.fill();
  }
  return c;
};
ART.gun = function (team, w) { return { tex: tex(ART.gunCanvas(team, w)), w: 46, h: 22 }; };
// the flag: a pennant on a pencil pole (white pennant, tinted with the holder's colour)
ART.flagPole = function () {
  const S = 2, c = canvas(20 * S, 150 * S), g = c.getContext('2d'); g.scale(S, S);
  g.fillStyle = '#f6c844'; rr(g, 6, 8, 8, 142, 3); g.fill(); g.fillStyle = '#e0a92a'; g.fillRect(10, 8, 4, 142);
  g.fillStyle = '#ff6b8a'; g.beginPath(); g.arc(10, 8, 7, 0, 7); g.fill();
  return { tex: tex(c), w: 20, h: 150 };
};
ART.pennant = function () {
  const S = 2, c = canvas(90 * S, 56 * S), g = c.getContext('2d'); g.scale(S, S);
  g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(0, 2); g.quadraticCurveTo(50, 8, 88, 26); g.quadraticCurveTo(50, 40, 0, 52); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,.12)'; g.beginPath(); g.moveTo(0, 30); g.quadraticCurveTo(44, 36, 88, 26); g.quadraticCurveTo(50, 40, 0, 52); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.font = '900 20px "Baloo 2", Nunito'; g.fillText('★', 18, 34);
  return { tex: tex(c), w: 90, h: 56 };
};

/* ---------- characters: little handmade dolls (felt tunic in the duo colour, wooden or clay head, yarn hair) ---------- */
ART.doll = function (team, slot) {
  const S = 3, W = 60, H = 74, c = canvas(W * S, H * S), g = c.getContext('2d'); g.scale(S, S);
  const col = ART.PAL.team[team % 8], cx = W / 2;
  g.fillStyle = '#5a3a2a'; g.beginPath(); g.ellipse(cx - 7, H - 7, 6, 4, 0, 0, 7); g.ellipse(cx + 7, H - 7, 6, 4, 0, 0, 7); g.fill();
  const gb = g.createLinearGradient(0, 34, 0, H - 6); gb.addColorStop(0, mix(col, '#ffffff', 0.15)); gb.addColorStop(1, shade(col, 0.72));
  g.fillStyle = gb; g.beginPath(); g.moveTo(cx - 13, 38); g.quadraticCurveTo(cx - 19, H - 8, cx - 15, H - 9); g.lineTo(cx + 15, H - 9); g.quadraticCurveTo(cx + 19, H - 8, cx + 13, 38); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.4; g.setLineDash([2.5, 2.5]); g.beginPath(); g.moveTo(cx - 14, H - 13); g.lineTo(cx + 14, H - 13); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#ffe2a6'; g.beginPath(); g.arc(cx, 48, 2.6, 0, 7); g.fill();
  const skin = slot ? '#f2c7a5' : '#e0aa76';
  const gh = g.createRadialGradient(cx - 6, 16, 3, cx, 22, 20); gh.addColorStop(0, mix(skin, '#ffffff', 0.35)); gh.addColorStop(1, shade(skin, 0.82));
  g.fillStyle = gh; g.beginPath(); g.ellipse(cx, 23, 17, 16, 0, 0, 7); g.fill();
  if (!slot) { g.strokeStyle = 'rgba(120,70,30,.25)'; g.lineWidth = 1; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(cx + 4, 26, 6 + k * 3.5, 3.6, 5.6); g.stroke(); } }
  if (!slot) {
    g.fillStyle = shade(col, 0.85); g.beginPath(); g.ellipse(cx, 13, 17, 10, 0, Math.PI, 0); g.fill();
    g.fillRect(cx - 17, 12, 34, 4); g.beginPath(); g.ellipse(cx + 10, 15, 11, 3.5, 0.2, 0, 7); g.fill();
    g.fillStyle = '#fff2d6'; g.beginPath(); g.arc(cx, 4, 3.5, 0, 7); g.fill();
  } else {
    g.fillStyle = '#8a4a2e';
    for (const [x, y, r] of [[-11, 12, 8], [0, 8, 9], [11, 12, 8], [-16, 22, 6], [16, 22, 6]]) { g.beginPath(); g.arc(cx + x, y, r, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(255,220,180,.35)'; g.lineWidth = 1.2; for (const [x, y] of [[-11, 12], [0, 8], [11, 12]]) { g.beginPath(); g.arc(cx + x, y, 5, 3.6, 5.8); g.stroke(); }
    g.fillStyle = col; g.beginPath(); g.ellipse(cx + 16, 10, 5, 3.5, 0.6, 0, 7); g.fill();
  }
  g.fillStyle = ART.PAL.ink; g.beginPath(); g.arc(cx - 6, 25, 2.6, 0, 7); g.arc(cx + 6, 25, 2.6, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(cx - 5.3, 24.2, 0.9, 0, 7); g.arc(cx + 6.7, 24.2, 0.9, 0, 7); g.fill();
  g.fillStyle = 'rgba(240,110,100,.45)'; g.beginPath(); g.ellipse(cx - 10, 30, 3.4, 2.2, 0, 0, 7); g.ellipse(cx + 10, 30, 3.4, 2.2, 0, 0, 7); g.fill();
  g.strokeStyle = '#7a3a3a'; g.lineWidth = 1.3; g.lineCap = 'round'; g.beginPath(); g.arc(cx, 29, 3.5, 0.3, 2.8); g.stroke();
  return { tex: tex(c), w: W, h: H };
};

/* ---------- light and particles ---------- */
ART.glow = function (size, rgb, a) {
  const c = canvas(size, size), g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(0.4, `rgba(${rgb},${a * 0.45})`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, size, size); return tex(c);
};
ART.shadowBlob = function () {
  const c = canvas(64, 32), g = c.getContext('2d'), gr = g.createRadialGradient(32, 16, 0, 32, 16, 30);
  gr.addColorStop(0, 'rgba(52,22,40,.5)'); gr.addColorStop(1, 'rgba(52,22,40,0)');
  g.setTransform(1, 0, 0, 0.5, 0, 8); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return tex(c);
};
ART.ray = function () {
  const c = canvas(128, 512), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 512);
  const gx = g.createLinearGradient(0, 0, 128, 0); gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(0.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = gx; g.fillRect(0, 0, 128, 512);
  return tex(c);
};
ART.vignette = function (w, h) {
  const c = canvas(w, h), g = c.getContext('2d');
  const top = g.createLinearGradient(0, 0, 0, h * 0.22); top.addColorStop(0, 'rgba(255,196,120,.32)'); top.addColorStop(1, 'rgba(255,196,120,0)');
  g.fillStyle = top; g.fillRect(0, 0, w, h * 0.22);
  const bot = g.createLinearGradient(0, h * 0.8, 0, h); bot.addColorStop(0, 'rgba(60,30,70,0)'); bot.addColorStop(1, 'rgba(60,30,70,.35)');
  g.fillStyle = bot; g.fillRect(0, h * 0.8, w, h * 0.2);
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
  vg.addColorStop(0, 'rgba(30,10,40,0)'); vg.addColorStop(1, 'rgba(30,10,40,.55)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
  return tex(c);
};
// a solid block standing on a surface (cover on the board game), drawn standing up
ART.block = function (o, seed) {
  const R = SIM.rng(seed), S = 2, lift = Math.min(o.w, o.h) * 0.55, W = o.w + 24, H = o.h + lift + 40;
  const c = canvas(W * S, H * S), g = c.getContext('2d'); g.scale(S, S);
  const x0 = 8, y0 = lift + 4, col = ART.PAL.toy[(seed * 7) % 6];
  g.save(); g.filter = 'blur(5px)'; g.fillStyle = ART.PAL.shadow + '0.35)';
  g.beginPath(); g.moveTo(x0, y0 + o.h * 0.4); g.lineTo(x0 + o.w, y0 + o.h * 0.4); g.lineTo(x0 + o.w + 10, y0 + o.h + 30); g.lineTo(x0 + 6, y0 + o.h + 30); g.closePath(); g.fill(); g.restore();
  const r = 10, ty = y0 - lift;
  const gf = g.createLinearGradient(0, ty + o.h, 0, y0 + o.h); gf.addColorStop(0, shade(col, 0.78)); gf.addColorStop(1, shade(col, 0.58));
  g.fillStyle = gf; rr(g, x0, ty + o.h - r, o.w, lift + r, r); g.fill();
  const gt = g.createLinearGradient(0, ty, 0, ty + o.h); gt.addColorStop(0, shade(col, 1.14)); gt.addColorStop(1, shade(col, 0.96));
  g.fillStyle = gt; rr(g, x0, ty, o.w, o.h, r); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3; rr(g, x0 + 9, ty + 9, o.w - 18, o.h - 18, 7); g.stroke();
  g.fillStyle = shade(col, 0.6); g.font = `900 ${o.w * 0.5}px "Baloo 2", Nunito, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(LETTERS[(R() * LETTERS.length) | 0], x0 + o.w / 2, ty + o.h / 2 + 2);
  return { tex: tex(c), x: o.x - x0, y: o.y - y0, w: W, h: H };
};

/* ---------- the board, the towers and the arena's moving parts ---------- */
// the whole board game top (1300 x 1300), cut into tiles by the caller
ART.board = function () {
  const W = C_BOARD * 2, c = canvas(W, W), g = c.getContext('2d');
  g.fillStyle = '#f4e7c9'; g.fillRect(0, 0, W, W);
  const T = 130;
  for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) { // a soft checker, coloured squares round the edge
    const edge = i === 0 || j === 0 || i === 9 || j === 9;
    g.fillStyle = edge ? ART.PAL.toy[(i + j) % 6] : (i + j) % 2 ? '#f1dfba' : '#f7ecd4';
    rr(g, i * T + 5, j * T + 5, T - 10, T - 10, 14); g.fill();
    if (edge) { g.fillStyle = 'rgba(255,255,255,.3)'; rr(g, i * T + 12, j * T + 12, T - 24, 14, 7); g.fill(); }
  }
  g.strokeStyle = 'rgba(160,110,70,.3)'; g.lineWidth = 22; g.lineCap = 'round'; g.beginPath();
  for (let a = 0; a < Math.PI * 5; a += 0.05) { const r2 = 120 + a * 30; g.lineTo(W / 2 + Math.cos(a) * r2, W / 2 + Math.sin(a) * r2); }
  g.stroke();
  const gc = g.createRadialGradient(W / 2, W / 2, 20, W / 2, W / 2, 190); gc.addColorStop(0, '#fff6dc'); gc.addColorStop(1, '#f1d9a8');
  g.fillStyle = gc; g.beginPath(); g.arc(W / 2, W / 2, 182, 0, 7); g.fill();
  g.fillStyle = 'rgba(212,166,94,.5)'; g.beginPath(); for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 - Math.PI / 2, r2 = k % 2 ? 46 : 110; g.lineTo(W / 2 + Math.cos(a) * r2, W / 2 + Math.sin(a) * r2); } g.fill();
  g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(0, 0, 0, W); gr.addColorStop(0, 'rgba(255,230,170,.18)'); gr.addColorStop(1, 'rgba(60,20,40,.1)'); g.fillStyle = gr; g.fillRect(0, 0, W, W);
  return c;
};
const C_BOARD = 650;
// the front face under one board tile
ART.tileFront = function () { const c = canvas(130, ART.FRONT + 8), g = c.getContext('2d'); front(g, 0, 0, 130, ART.FRONT, '#8a5432', 4); return tex(c); };
// a stack of books standing up from the board (footprint w x h, `up` px tall on screen)
ART.tower = function (w, h, up, seed) {
  const R = SIM.rng(seed), c = canvas(w + 8, h + up + 8), g = c.getContext('2d'); g.translate(4, 4);
  const cols = ['#b8433a', '#2f6f8f', '#5d8a3a', '#8e5bd6', '#e0a92a'];
  let y = h; const n = 4, bh = up / n;
  for (let k = 0; k < n; k++) { // spines from the bottom up, each book a little offset
    const col = cols[(seed + k) % cols.length], ox = (R() - 0.5) * 8;
    g.fillStyle = shade(col, 0.75); rr(g, ox, y + up - (k + 1) * bh, w, bh + 2, 5); g.fill();
    g.fillStyle = 'rgba(255,225,150,.6)'; g.fillRect(ox + w * 0.2, y + up - (k + 1) * bh + bh * 0.35, w * 0.6, 3);
  }
  const col = cols[(seed + n) % cols.length];
  const gt = g.createLinearGradient(0, 0, w, 0); gt.addColorStop(0, shade(col, 0.85)); gt.addColorStop(1, shade(col, 1.05));
  g.fillStyle = gt; rr(g, 0, 0, w, h, 10); g.fill();
  g.strokeStyle = 'rgba(255,215,130,.75)'; g.lineWidth = 3; rr(g, 10, 10, w - 20, h - 20, 6); g.stroke();
  topLight(g, 0, 0, w, h, 10);
  return { tex: tex(c), w: w + 8, h: h + up + 8 };
};
// a drawer pulled out of a cabinet (footprint w x h, laid along its long side)
ART.drawer = function (w, h) {
  const F = 26, c = canvas(w + 8, h + F + 8), g = c.getContext('2d'); g.translate(4, 4);
  front(g, 0, h, w, F, '#a8683f', 8);
  g.fillStyle = '#c98a4f'; rr(g, 0, 0, w, h, 8); g.fill();
  g.fillStyle = '#e8c08a'; rr(g, 10, 10, w - 20, h - 20, 6); g.fill(); // the inside
  g.strokeStyle = 'rgba(90,45,15,.25)'; g.lineWidth = 2; for (let k = 1; k < 4; k++) { const horiz = w >= h; g.beginPath(); if (horiz) { g.moveTo(10, 10 + k * (h - 20) / 4); g.lineTo(w - 10, 10 + k * (h - 20) / 4); } else { g.moveTo(10 + k * (w - 20) / 4, 10); g.lineTo(10 + k * (w - 20) / 4, h - 10); } g.stroke(); }
  return { tex: tex(c) };
};
// a desk fan seen from above, far below the gap; blades turn separately
ART.fanBase = function (r) { const c = canvas(r * 2 + 8, r * 2 + 8), g = c.getContext('2d'); g.translate(r + 4, r + 4); g.fillStyle = 'rgba(30,40,60,.55)'; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.strokeStyle = 'rgba(200,230,255,.45)'; g.lineWidth = 3; for (let k = 1; k <= 4; k++) { g.beginPath(); g.arc(0, 0, r * k / 4.2, 0, 7); g.stroke(); } return tex(c); };
ART.fanBlades = function (r) { const c = canvas(r * 2, r * 2), g = c.getContext('2d'); g.translate(r, r); g.fillStyle = 'rgba(140,200,255,.5)'; for (let k = 0; k < 3; k++) { g.rotate(Math.PI * 2 / 3); g.beginPath(); g.ellipse(r * 0.45, 0, r * 0.45, r * 0.18, 0.3, 0, 7); g.fill(); } g.fillStyle = '#dfe9f5'; g.beginPath(); g.arc(0, 0, r * 0.12, 0, 7); g.fill(); return tex(c); };
// a toy train engine, footprint w x h, drawn standing up
ART.train = function (w, h) {
  const up = 40, c = canvas(w + 8, h + up + 8), g = c.getContext('2d'); g.translate(4, 4 + up);
  g.fillStyle = 'rgba(52,22,40,.35)'; rr(g, 4, 6, w, h, 10); g.fill();
  front(g, 0, h - up * 0.2, w, up * 0.2 + 2, '#c23b2a', 8);
  g.fillStyle = '#e8553f'; rr(g, 0, -up, w, h, 12); g.fill();
  g.fillStyle = '#3a7bd5'; rr(g, w * 0.12, -up + h * 0.15, w * 0.35, h * 0.7, 6); g.fill();
  g.fillStyle = '#f6c844'; g.beginPath(); g.arc(w * 0.72, -up + h / 2, Math.min(w, h) * 0.18, 0, 7); g.fill();
  g.fillStyle = '#2a1f3d'; for (const fx of [0.2, 0.5, 0.8]) { g.beginPath(); g.arc(w * fx, h * 0.98 - up * 0.1, 7, 0, 7); g.fill(); }
  return { tex: tex(c), up };
};
// the giant slingshot's frame (a wooden Y), drawn standing up
ART.sling = function () {
  const S = 2, c = canvas(90 * S, 120 * S), g = c.getContext('2d'); g.scale(S, S);
  g.fillStyle = 'rgba(52,22,40,.3)'; g.beginPath(); g.ellipse(48, 112, 26, 7, 0, 0, 7); g.fill();
  g.strokeStyle = '#8a5432'; g.lineWidth = 12; g.lineCap = 'round';
  g.beginPath(); g.moveTo(45, 110); g.lineTo(45, 64); g.lineTo(18, 16); g.moveTo(45, 64); g.lineTo(72, 16); g.stroke();
  g.strokeStyle = '#c98a4f'; g.lineWidth = 5; g.beginPath(); g.moveTo(43, 106); g.lineTo(43, 64); g.lineTo(17, 18); g.stroke();
  return { tex: tex(c), w: 90, h: 120 };
};
// the giant marble
ART.marble = function (r) {
  const S = 2, c = canvas((r * 2 + 4) * S, (r * 2 + 4) * S), g = c.getContext('2d'); g.scale(S, S); g.translate(r + 2, r + 2);
  const gr = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.3, '#9fd8ff'); gr.addColorStop(0.8, '#3a7bd5'); gr.addColorStop(1, '#22457a');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,107,74,.75)'; g.lineWidth = r * 0.22; g.beginPath(); g.arc(0, 0, r * 0.55, 0.4, 2.6); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.ellipse(-r * 0.38, -r * 0.42, r * 0.2, r * 0.12, -0.6, 0, 7); g.fill();
  return { tex: tex(c), w: r * 2 + 4 };
};
