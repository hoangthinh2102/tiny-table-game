'use strict';
/* ===== Tiny Tumble — 3D dolls, toy weapons and pickups, built from primitives (used by render3d.js) =====
   A doll faces +x, stands on y = 0 with its right hand on +z and is about 80 units tall (the player radius is 18).
   Body, head and hair are one mesh: the face is painted on the head's texture; everything else takes its colour from
   the vertices and samples the white band along the bottom of that texture. Two looks per duo: slot 0 is a wooden
   doll in a knitted beanie, slot 1 a clay doll with yarn curls and a bow; tunic, beanie and bow are in the duo colour. */
(function () {
  const R = window.R3D;
  R.kit = function () {
    const T = R.T, H = R.H, parts = {}, guns = {}, items = {}, faces = {};
    const SKIN = ['#e0aa76', '#f2c7a5'];
    function face(slot, closed) {
      const key = slot + '|' + closed; if (faces[key]) return faces[key];
      const c = H.cvs(512, 256), g = c.getContext('2d'), skin = SKIN[slot];
      g.fillStyle = skin; g.fillRect(0, 0, 512, 256);
      if (!slot) { g.strokeStyle = 'rgba(120,70,30,.16)'; g.lineWidth = 3; for (let k = 0; k < 6; k++) { g.beginPath(); g.ellipse(330, 96, 26 + k * 16, 16 + k * 10, 0.2, 0, 7); g.stroke(); } }
      g.fillStyle = '#fff'; g.fillRect(0, 226, 512, 30); // the white band the rest of the doll samples
      const ey = 140;
      for (const s of [-1, 1]) {
        const x = 256 + s * 30;
        if (closed) { g.strokeStyle = '#2a1f3d'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.arc(x, ey - 3, 11, 0.25, Math.PI - 0.25); g.stroke(); }
        else {
          g.fillStyle = '#2a1f3d'; g.beginPath(); g.ellipse(x, ey, 11.5, 15.5, 0, 0, 7); g.fill();
          g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 3.5, ey - 6, 4.4, 0, 7); g.fill(); g.beginPath(); g.arc(x - 3.5, ey + 5, 2, 0, 7); g.fill();
        }
        g.fillStyle = 'rgba(240,105,100,.5)'; g.beginPath(); g.ellipse(256 + s * 56, ey + 24, 13, 7.5, 0, 0, 7); g.fill();
        g.strokeStyle = 'rgba(60,30,30,.55)'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(x - 9, ey - 25 - (slot ? 2 : 0)); g.lineTo(x + 9, ey - 27); g.stroke();
      }
      g.strokeStyle = '#7a3a3a'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.arc(256, ey + 18, 8, 0.4, Math.PI - 0.4); g.stroke();
      return (faces[key] = H.ctex(c));
    }
    function dollParts(team, slot) {
      const key = team + '|' + slot; if (parts[key]) return parts[key];
      const tc = ART.PAL.team[team % 8], tl = ART.mix(tc, '#ffffff', 0.4), td = ART.shade(tc, 0.7), skin = SKIN[slot];
      const foot = H.bag(), up = H.bag();
      // a shoe and a stubby leg
      foot.sph(7.8, 4.8, 5.8, slot ? '#c0434f' : '#6a4030', 2.2, 4.4, 0, 14);
      foot.cyl(3.9, 4.3, 11, slot ? '#f3e7d6' : '#7d6e60', 0, 11.5, 0, 10);
      // the felt tunic, its hem, a button, the arms
      up.lathe([[0, 12], [13, 12.2], [15, 15], [14.6, 22], [12, 31], [8.6, 38.5], [0, 39.5]], tc, 0, 0, 0, 24);
      up.tor(14.6, 1.9, tl, 0, 13.4, 0, Math.PI / 2, 0, 0);
      up.sph(2.6, 2.6, 1.8, '#fff2d6', 13.4, 25, 0, 10); up.sph(2.2, 2.2, 1.6, '#fff2d6', 11.4, 31, 0, 10);
      up.cap(3.8, 10, tc, -1, 26, -14, -0.35, 0, 0); up.sph(4.4, 4.4, 4.4, skin, -1, 18.5, -16.5, 10);
      up.cap(3.8, 9, tc, 5, 29, 12.5, 0, 0, -1.25);
      if (slot) up.tor(9, 2.8, '#fff2d6', 0, 38, 0, Math.PI / 2, 0, 0); else { up.tor(9, 3.2, td, 0, 38, 0, Math.PI / 2, 0, 0); up.cap(2.8, 9, td, -6, 31, -8, 0.3, 0, 0.5); }
      // the head (keeps the sphere's uv for the face) and hair, tilted back so the face looks up at the camera
      const hd = H.bag();
      hd.add(new T.SphereGeometry(17, 30, 22), '#ffffff', H.mat4(0, 56, 0), 0);
      if (!slot) { // knitted beanie with a pompom; a little fringe; ears
        hd.add(new T.SphereGeometry(18.4, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.43), tc, H.mat4(-0.6, 57, 0));
        hd.tor(17.4, 3, td, -0.6, 61.2, 0, Math.PI / 2, 0, 0, Math.PI * 2, 28);
        for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; hd.box(1.4, 5.5, 2.4, ART.shade(tc, 0.6), -0.6 + Math.cos(a) * 19.6, 61.2, Math.sin(a) * 19.6, undefined, 0, -a, 0); }
        hd.sph(6.6, 6.6, 6.6, '#fff2d6', -1.5, 76.5, 0, 12);
        for (const s of [-1, 0, 1]) hd.sph(5, 3.2, 4.4, '#5a3a24', 14.6, 58.6 - Math.abs(s), s * 6.5, 10);
        for (const s of [-1, 1]) hd.sph(3.4, 4.6, 2.4, skin, -0.5, 54, s * 16.8, 10);
      } else { // yarn curls, two buns and a bow
        const hc = '#8a4a2e', hl = '#a8623e';
        hd.add(new T.SphereGeometry(18.2, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hc, H.mat4(-1.4, 56.5, 0));
        hd.sph(17.6, 16, 17.8, hc, -4.2, 52, 0, 18);
        for (let k = -2; k <= 2; k++) hd.sph(5.6, 4.6, 5.4, k % 2 ? hl : hc, 14 - Math.abs(k) * 2.4, 66 - Math.abs(k) * 2, k * 6, 10);
        for (const s of [-1, 1]) { hd.sph(8.4, 8.4, 8.4, hc, -3, 66, s * 14.5, 12); hd.tor(5, 1.2, hl, -3, 66, s * 14.5, 0.6, 0, 0); }
        hd.sph(7.4, 5, 3, tc, -5.5, 75, 11, 10, 0, 0, 0.5); hd.sph(7.4, 5, 3, tc, 5.5, 75, 11, 10, 0, 0, -0.5); hd.sph(3.4, 3.4, 3.4, td, 0, 75.5, 11.5, 8);
      }
      for (const g of hd.list) { g.translate(0, -50, 0); g.rotateZ(0.3); g.translate(-1, 50, 0); up.list.push(g); }
      return (parts[key] = { foot: H.merge(foot.list), up: H.merge(up.list), face: face(slot, false), blink: face(slot, true) });
    }
    // the weapons, grip at the origin, pointing +x (0 slingshot, 1 crayon, 2 rubber bands, 3 stapler, 4 marble bomb, 5 balloon puffer, 6 hammer)
    function gunParts(b, w, tc) {
      const X = Math.PI / 2;
      if (w === 0) {
        b.cyl(2.6, 2.6, 16, '#a8743e', 4, -1, 0, 8, 0, 0, X);
        for (const s of [-1, 1]) { b.cyl(2.3, 2.3, 15, '#a8743e', 17, 0, s * 4, 8, 0, s * 0.55, X); b.sph(2.6, 2.6, 2.6, '#c98a4f', 23, 0, s * 8, 8); }
        b.cyl(1.1, 1.1, 16, tc, 22, 0, 0, 6, X); b.box(3, 3, 5, '#7a4a2e', 21, 0, 0);
      } else if (w === 1) {
        b.box(7, 11, 6, '#8a5a3a', 0, -5, 0); b.cyl(5, 5, 28, '#e8553f', 15, 2, 0, 10, 0, 0, X); b.cyl(5.3, 5.3, 11, '#fff2d6', 12, 2, 0, 10, 0, 0, X);
        b.cone(5, 10, '#e8553f', 34, 2, 0, 10, 0, 0, -X);
      } else if (w === 2) {
        b.box(7, 12, 6, '#c99a62', 0, -5, 0); b.box(36, 5, 5, '#c99a62', 16, 2, 0);
        for (let x = 16; x <= 34; x += 6) b.tor(4.2, 1.1, '#6cc24a', x, 2, 0, 0, X, 0, Math.PI * 2, 12);
      } else if (w === 3) {
        b.box(42, 6, 11, '#3a3f55', 18, -3, 0); b.box(40, 7, 10, '#5b78d6', 18.5, 4, 0, 0, 0, 0, 0.05); b.box(30, 1.5, 4, '#a8c0ff', 16, 8, 0);
      } else if (w === 4) {
        b.cyl(2.4, 2.4, 24, '#a8743e', 12, 0, 0, 8, 0, 0, X); b.sph(8.5, 6, 8.5, '#3a7bd5', 28, 3, 0, 12); b.sph(5.8, 5.8, 5.8, '#b48cff', 28, 7.5, 0, 12);
      } else if (w === 5) {
        b.cyl(5, 5, 22, '#e84f8a', 10, 2, 0, 12, 0, 0, X); b.cyl(5.3, 5.3, 3, '#ffd0e0', 6, 2, 0, 12, 0, 0, X);
        b.cone(11, 14, '#f6c844', 27, 2, 0, 14, 0, 0, X);
      } else {
        b.cyl(2.3, 2.3, 30, '#a8743e', 14, 0, 0, 8, 0, 0, X); b.cyl(8.5, 8.5, 20, '#e8553f', 30, 0, 0, 14, X);
        for (const s of [-1, 1]) b.cyl(8.8, 8.8, 3.4, '#ffe08a', 30, 0, s * 9, 14, X);
      }
    }
    function gun(w, team, slot) {
      const key = w + '|' + (w === 0 ? team : 0) + '|' + slot; if (guns[key]) return guns[key];
      const b = H.bag(); gunParts(b, w, ART.PAL.team[team % 8]);
      b.sph(4.6, 4.6, 4.6, SKIN[slot], 0, 0, 0, 10); // the hand
      return (guns[key] = H.merge(b.list));
    }
    function item(k) { // pickups, centred at the origin
      if (items[k]) return items[k];
      const b = H.bag();
      if (k === 'heal') { // a sticking plaster
        b.slab(44, 6, 18, 8, 2, '#f2c6a0', 0, 3, 0); b.slab(16, 7, 16, 4, 1.5, '#fbe3cc', 0, 3.6, 0);
        b.box(4, 1.5, 11, '#e5484d', 0, 4, 0); b.box(11, 1.5, 4, '#e5484d', 0, 4, 0);
        for (const m of b.list) m.rotateX(-1.1);
      } else if (k === 'armor') { // a bottle cap
        b.cyl(19, 20, 8, '#4a7bd5', 0, 0, 0, 21); b.cyl(15, 15, 1.5, '#a8c8ff', 0, 4.4, 0, 21);
        b.box(3.6, 1.5, 12, '#fff', 0, 5.2, 0); b.box(12, 1.5, 3.6, '#fff', 0, 5.2, 0);
        for (const m of b.list) m.rotateX(-1.1);
      } else { gunParts(b, +k[1], '#ffb347'); for (const m of b.list) { m.scale(1.45, 1.45, 1.45); m.translate(-24, 0, 0); } }
      return (items[k] = H.merge(b.list));
    }
    return { parts: dollParts, gun, item };
  };
})();
