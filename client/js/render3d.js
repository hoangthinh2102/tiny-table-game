'use strict';
/* ===== Tiny Tumble — 3D view (Three.js 0.169, loaded at runtime; the PixiJS scene stays as the fallback) =====
   The sim is 2D + height. Sim (x, y, z) → three (x, z, y): the desk plane is XZ, height is +Y, and the camera looks
   down from +Z (the bottom of the screen) like a tabletop miniature, following the target game.js's camera() computes.
   - Furniture tops are at y = 0 (towers at C.TOWER_Z): solid pieces whose sides go down to a dark room floor far below
     (stacks of books, toy blocks, boxes). Everything is darkened by depth (deepen), so any gap reads as a drop.
   - Static pieces are merged into one mesh per material; the board's tiles are one InstancedMesh.
   - Things that move by the clock are posed from the shared sim at the predicted time, exactly as the 2D scene does.
   - Name tags, bars, progress rings and damage numbers are HTML, projected from 3D.
   game.js keeps all gameplay. Hooks: R3D.load() at boot, R3D.build(map) per match, R3D.player() for every player it
   places, R3D.event() per snapshot event, R3D.frame() after its camera(), R3D.screenToWorld() for mouse aiming.
   R3D.menu(true|false): the desk as a slow cinematic backdrop behind the title card, with its own frame loop. */
(function () {
  const URLS = ['https://unpkg.com/three@0.169.0/build/three.module.min.js', 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js'];
  const DS = 1.25;                                 // dolls drawn this much bigger than modelled (readability; the sim radius is unchanged)
  const DEEP = 1100;                               // the room floor, this far below the desk tops
  const FOV = 30, PITCH = 0.9, PITCH_FAR = 1.18;   // vertical field of view (deg); camera tilt down (rad) close up / over the whole desk
  const BG = '#2a1f3d', LDIR = [-0.42, 1, -0.62];  // background; towards the sun (the window, top left)
  const TOY = ['#e8553f', '#f39c32', '#f6c844', '#2bb3a3', '#3a7bd5', '#8e5bd6'];
  const BOOK = ['#b8433a', '#2f6f8f', '#5d8a3a', '#8e5bd6', '#d99a2b', '#c0603a', '#3a6fc0', '#7d8f3a'];
  const LETTERS = 'ABCDEGHIKLMNOPQRSTUVXY';
  const R = { on: false, T: null, views: new Map(), items: new Map(), devs: [], trash: [], frameNo: 0, floats: [], rings: [], rq: [], rqn: 0 };
  window.R3D = R;
  const WD = { on: new Set(), bt: new Map(), sl: new Map() }; // what the devices show: open gates, lowered bridges, timers, slingshot pulls
  let T = null, V1, V2, V3, Q1, M1, S1, C1, UP;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angD = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const rgb = (s) => { const n = parseInt(s.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }; // display colour, for raw shaders

  /* ---------- loading ---------- */
  R.load = function (host) {
    if (R.loadP) return R.loadP;
    return (R.loadP = (async () => {
      try {
        const lib = await Promise.race([importThree(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 15000))]);
        T = R.T = lib; init(host); R.on = true;
      } catch (e) {
        console.warn('3D view off, using 2D:', e && e.message);
        R.on = false; for (const el of [R.cv, R.vig, R.tags]) if (el) el.remove();
      }
      return R.on;
    })());
  };
  async function importThree() { let err = null; for (const u of URLS) { try { return await import(u); } catch (e) { err = e; } } throw err || new Error('three.js unavailable'); }

  function init(host) {
    const cv = document.createElement('canvas'); cv.id = 'cv3d'; host.prepend(cv); R.cv = cv;
    const ren = new T.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance', stencil: false });
    if (!ren.getContext()) throw new Error('no WebGL');
    R.ren = ren; R.aniso = Math.min(4, ren.capabilities.getMaxAnisotropy());
    ren.shadowMap.enabled = true; ren.shadowMap.type = TOUCH ? T.PCFShadowMap : T.PCFSoftShadowMap;
    R.q = { lvl: 0, pr: Math.min(devicePixelRatio || 1, TOUCH ? 1.25 : 1.5), map: TOUCH ? 1024 : 2048, slow: 0, ft: 1 / 60 };
    V1 = new T.Vector3(); V2 = new T.Vector3(); V3 = new T.Vector3(); Q1 = new T.Quaternion(); M1 = new T.Matrix4(); S1 = new T.Vector3(); C1 = new T.Color(); UP = new T.Vector3(0, 1, 0);
    R.ray = new T.Raycaster(); R.ndc = new T.Vector2(); R.plane = new T.Plane(new T.Vector3(0, 1, 0), 0); R.hit = new T.Vector3(); R.aim = { x: 0, y: 0 };
    const sc = R.scene = new T.Scene(); sc.background = new T.Color(BG); sc.fog = new T.Fog(BG, 3000, 9000);
    R.cam = new T.PerspectiveCamera(FOV, innerWidth / innerHeight, 20, 60000);
    R.hemi = new T.HemisphereLight('#9fe3d8', '#7a4f9a', 1.5); sc.add(R.hemi);
    const sun = R.sun = new T.DirectionalLight('#ffd49c', 3.1); sun.castShadow = true;
    sun.shadow.mapSize.set(R.q.map, R.q.map); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 1.6; sun.shadow.camera.near = 50; sun.shadow.camera.far = 6500;
    sc.add(sun, sun.target);
    const fill = new T.DirectionalLight('#ffe6cf', 0.7); fill.position.set(0.15, 0.5, 1); sc.add(fill); // from the camera side: faces and fronts
    R.ldir = new T.Vector3(...LDIR).normalize(); R.lright = new T.Vector3().crossVectors(UP, R.ldir).normalize(); R.lup = new T.Vector3().crossVectors(R.ldir, R.lright).normalize();
    R.deepU = { value: new T.Vector4(0.2, 0.12, 0.27, DEEP) }; R.inkU = { value: new T.Vector2(1.6, 720) }; R.ptU = { value: 1000 };
    const div = (id) => { const d = document.createElement('div'); d.id = id; host.appendChild(d); return d; };
    R.vig = div('vig3d'); R.tags = div('tags3d');
    R.fade = document.createElement('div'); R.fade.style.cssText = 'position:absolute;inset:0;background:' + BG + ';opacity:0'; R.vig.appendChild(R.fade); // the menu's cut back to its first shot
    if (!TOUCH) for (const k of ['top', 'bot']) { const d = document.createElement('div'); d.className = 'ts3 ' + k; R.vig.appendChild(d); } // tilt-shift: the far and near edges a little out of focus
    textures(); materials(); fxInit();
    R.H = { bag, merge, mat4, rslab, cvs, ctex, toon };
  }

  /* ---------- textures: small tileable canvases, mostly light grey so the vertex colour gives the hue ---------- */
  function cvs(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function ctex(c, rep) { const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = R.aniso; if (rep) t.wrapS = t.wrapT = T.RepeatWrapping; return t; }
  function tile(S, bg, fn) { const c = cvs(S, S), g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, S, S); fn(g, S, SIM.rng(S * 31 + bg.charCodeAt(2))); return c; }
  const wrap9 = (S, f) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) f(ox, oy); };
  function dots(g, S, r, n, col, a0, a1, s0, s1) { g.fillStyle = col; for (let i = 0; i < n; i++) { g.globalAlpha = a0 + r() * (a1 - a0); const s = s0 + r() * (s1 - s0); g.fillRect(r() * S, r() * S, s, s); } g.globalAlpha = 1; }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
  function textures() {
    const X = R.tx = {};
    X.wood = ctex(tile(256, '#efe2d0', (g, S, r) => {
      for (let i = 0; i < 52; i++) {
        const y0 = r() * S, k = 1 + ((r() * 3) | 0), ph = r() * 6.28, amp = 1 + r() * 4;
        g.strokeStyle = `rgba(110,66,34,${0.05 + r() * 0.17})`; g.lineWidth = 0.8 + r() * 2.6;
        for (const oy of [-S, 0, S]) { g.beginPath(); for (let x = 0; x <= S; x += 8) g.lineTo(x, y0 + oy + Math.sin(x / S * 6.283 * k + ph) * amp); g.stroke(); }
      }
      dots(g, S, r, 400, '#7a4a2a', 0.03, 0.1, 1, 2);
    }), true);
    X.card = ctex(tile(256, '#f2e7d7', (g, S, r) => {
      g.fillStyle = 'rgba(120,85,50,.07)'; for (let x = 0; x < S; x += 8) g.fillRect(x, 0, 3, S);
      dots(g, S, r, 900, '#6a4a2a', 0.04, 0.16, 1, 2.2);
    }), true);
    X.cloth = ctex(tile(256, '#f4efe8', (g, S, r) => {
      for (let y = 0; y < S; y += 2) { g.fillStyle = `rgba(0,0,0,${0.02 + r() * 0.04})`; g.fillRect(0, y, S, 1); }
      for (let x = 0; x < S; x += 2) { g.fillStyle = `rgba(255,255,255,${0.04 + r() * 0.06})`; g.fillRect(x, 0, 1, S); }
      dots(g, S, r, 300, '#000', 0.03, 0.08, 1, 3);
    }), true);
    X.pages = ctex(tile(128, '#f9f1de', (g, S, r) => { for (let y = 0; y < S; y += 4) { g.fillStyle = `rgba(140,110,70,${0.12 + r() * 0.18})`; g.fillRect(0, y, S, 1); } }), true);
    X.velvet = ctex(tile(256, '#ece4f0', (g, S, r) => {
      for (let i = 0; i < 26; i++) { const x = r() * S, y = r() * S, rad = 20 + r() * 50; wrap9(S, (ox, oy) => { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad); gr.addColorStop(0, `rgba(255,255,255,${0.12 + r() * 0.1})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2); }); }
      dots(g, S, r, 2500, '#000', 0.04, 0.12, 1, 1.5); dots(g, S, r, 1200, '#fff', 0.06, 0.2, 1, 1.5);
    }), true);
    X.tin = ctex(tile(256, '#eef6f5', (g, S, r) => {
      const star = (x, y, a, b) => { g.beginPath(); for (let k = 0; k < 10; k++) { const t = k / 10 * Math.PI * 2, rr2 = k % 2 ? b : a; g.lineTo(x + Math.cos(t) * rr2, y + Math.sin(t) * rr2); } g.closePath(); };
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const x = i * 64 + 32 + (j % 2) * 32, y = j * 64 + 32;
        wrap9(S, (ox, oy) => { g.fillStyle = 'rgba(20,60,60,.22)'; star(x + ox + 2, y + oy + 2, 18, 8); g.fill(); g.fillStyle = 'rgba(255,255,255,.75)'; star(x + ox - 1.5, y + oy - 1.5, 18, 8); g.fill(); g.fillStyle = '#e4f1ef'; star(x + ox, y + oy, 16, 7); g.fill(); });
      }
      dots(g, S, r, 300, '#fff', 0.1, 0.3, 1, 2);
    }), true);
    X.paint = ctex(tile(128, '#f6f3f0', (g, S, r) => { dots(g, S, r, 500, '#000', 0.02, 0.06, 1, 2); dots(g, S, r, 300, '#fff', 0.1, 0.3, 1, 2); }), true);
    X.stripe = ctex(tile(256, '#f6ead2', (g, S) => { g.fillStyle = 'rgba(232,85,63,.6)'; for (let x = -S; x < S * 2; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 24, 0); g.lineTo(x + 24 + S, S); g.lineTo(x + S, S); g.fill(); } }), true);
    X.floor = ctex(tile(512, '#6e4230', (g, S, r) => {
      const cols = ['#7a4a33', '#865238', '#6e4230', '#8d5a3c', '#734634'];
      for (let x = 0; x < S; x += 64) { let y = -r() * 200; while (y < S) { const len = 160 + r() * 260; g.fillStyle = cols[(r() * 5) | 0]; for (const oy of [0, S]) g.fillRect(x, y - oy, 64, len); g.fillStyle = 'rgba(30,12,8,.5)'; for (const oy of [0, S]) g.fillRect(x, y + len - 3 - oy, 64, 3); y += len; } g.fillStyle = 'rgba(30,12,8,.55)'; g.fillRect(x, 0, 3, S); }
      for (let i = 0; i < 90; i++) { const y = r() * S, x = r() * S; g.strokeStyle = `rgba(40,18,10,${0.08 + r() * 0.12})`; g.lineWidth = 1 + r() * 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 30 + r() * 90); g.stroke(); }
    }), true);
    X.rug = ctex((() => {
      const c = cvs(512, 384), g = c.getContext('2d');
      g.fillStyle = '#2b5e63'; rr(g, 0, 0, 512, 384, 30); g.fill();
      g.strokeStyle = '#c9965e'; g.lineWidth = 12; rr(g, 22, 22, 468, 340, 18); g.stroke();
      g.strokeStyle = '#e8b57a'; g.lineWidth = 4; rr(g, 44, 44, 424, 296, 12); g.stroke();
      g.fillStyle = 'rgba(232,181,122,.35)';
      for (let j = 0; j < 5; j++) for (let i = 0; i < 7; i++) { const x = 86 + i * 57, y = 92 + j * 50; g.beginPath(); g.moveTo(x, y - 16); g.lineTo(x + 16, y); g.lineTo(x, y + 16); g.lineTo(x - 16, y); g.fill(); }
      return c;
    })());
    X.ruler = ctex((() => { // 500 units of ruler: ticks from the top edge (v = 1), plain towards the bottom
      const c = cvs(512, 128), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, '#ffe7a0'); gr.addColorStop(1, '#f2b84a'); g.fillStyle = gr; g.fillRect(0, 0, 512, 128);
      g.fillStyle = 'rgba(90,50,10,.75)'; g.font = '800 22px Nunito, sans-serif'; g.textAlign = 'center';
      for (let i = 0; i < 50; i++) { const x = i * 512 / 50 + 2, len = i % 10 === 0 ? 46 : i % 5 === 0 ? 32 : 20; g.fillRect(x - 1, 0, 2.2, len); if (i % 10 === 0) g.fillText(String(i / 10 + 1), x + 14, 70); }
      return c;
    })(), true);
    X.board = ctex(ART.board());
    X.glow = ctex(radial(64, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.5)'], [1, 'rgba(255,255,255,0)']]));
    X.blob = ctex(radial(64, [[0, 'rgba(40,16,40,.6)'], [0.6, 'rgba(40,16,40,.3)'], [1, 'rgba(40,16,40,0)']]));
    X.dot = ctex(radial(32, [[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(255,255,255,1)'], [0.75, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0)']]));
    X.streak = ctex((() => { const c = cvs(32, 128), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; rr(g, 12, 0, 8, 128, 4); g.fill(); const d = cvs(128, 128); d.getContext('2d').drawImage(c, 48, 0); return d; })());
    X.mark = ctex((() => { const c = cvs(64, 64), g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 24, 0, 7); g.fill(); g.strokeStyle = '#2a1f3d'; g.lineWidth = 7; g.stroke(); return c; })());
    X.dash = ctex((() => { const c = cvs(256, 256), g = c.getContext('2d'); g.strokeStyle = '#fff'; g.lineWidth = 9; g.setLineDash([22, 16]); g.lineCap = 'round'; rr(g, 8, 8, 240, 240, 18); g.stroke(); return c; })());
    // decals: letters for the toy blocks, a book cover frame, box prints
    X.atlas = ctex((() => {
      const c = cvs(1024, 1024), g = c.getContext('2d');
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
      for (let i = 0; i < LETTERS.length; i++) { g.font = '900 100px "Baloo 2", Nunito, sans-serif'; g.fillText(LETTERS[i], (i % 8) * 128 + 64, ((i / 8) | 0) * 128 + 72); }
      const cell = (k) => [(k % 8) * 128, ((k / 8) | 0) * 128];
      let [x, y] = cell(22); g.strokeStyle = '#fff'; g.lineWidth = 6; rr(g, x + 10, y + 10, 108, 108, 9); g.stroke(); rr(g, x + 30, y + 46, 68, 16, 6); g.fill();
      [x, y] = cell(23); g.font = '900 27px "Baloo 2", Nunito, sans-serif'; g.fillText('FRAGILE', x + 64, y + 96);
      g.beginPath(); g.moveTo(x + 64, y + 14); g.lineTo(x + 92, y + 46); g.lineTo(x + 74, y + 46); g.lineTo(x + 74, y + 74); g.lineTo(x + 54, y + 74); g.lineTo(x + 54, y + 46); g.lineTo(x + 36, y + 46); g.fill();
      [x, y] = cell(24); g.fillStyle = '#e8553f'; rr(g, x + 8, y + 36, 112, 56, 12); g.fill(); g.fillStyle = '#fff'; g.font = '900 34px "Baloo 2", Nunito, sans-serif'; g.fillText('SHOES', x + 64, y + 66);
      [x, y] = cell(25); g.font = '900 46px "Baloo 2", Nunito, sans-serif'; g.fillText('JAM', x + 64, y + 68);
      return c;
    })());
  }
  function radial(S, stops) { const c = cvs(S, S), g = c.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); for (const [k, col] of stops) gr.addColorStop(k, col); g.fillStyle = gr; g.fillRect(0, 0, S, S); return c; }

  /* ---------- materials ---------- */
  // darker and bluer the further below the desk tops (the room floor is in the shade), on top of the fog
  function deepen(m, extra, key) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uDeep = R.deepU;
      if (extra) extra(sh);
      sh.vertexShader = 'varying float vWY;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  { vec4 wq = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wq = instanceMatrix * wq;
  #endif
    vWY = (modelMatrix * wq).y; }`);
      sh.fragmentShader = 'uniform vec4 uDeep;\nvarying float vWY;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `{ float dk = smoothstep(-uDeep.w * 0.66, 24.0, vWY); outgoingLight *= mix(uDeep.rgb, vec3(1.0), dk * dk * (0.55 + 0.45 * dk)); }
#include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'deep' + (key || '');
    return m;
  }
  // toon shading with a warm rim, like painted wood and felt under a lamp
  function toon(o) {
    return deepen(new T.MeshToonMaterial(Object.assign({ gradientMap: R.ramp }, o)), (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{ vec3 vv = normalize(vViewPosition); float rim = smoothstep(0.55, 0.9, 1.0 - max(dot(normal, vv), 0.0)); outgoingLight += vec3(1.0, 0.85, 0.62) * rim * 0.25; }
#include <opaque_fragment>`);
    }, 'toon');
  }
  // ink outline: back faces pushed out along the normal by about the same number of screen pixels at any distance
  function inkMat(col) {
    const m = new T.MeshBasicMaterial({ color: col, side: T.BackSide });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uInk = R.inkU;
      sh.vertexShader = 'uniform vec2 uInk;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  { vec3 n = normalize(normalMatrix * normal); mvPosition.xyz += n * (uInk.x * 2.0 * max(-mvPosition.z, 1.0) / (projectionMatrix[1][1] * uInk.y)); gl_Position = projectionMatrix * mvPosition; }`);
    };
    m.customProgramCacheKey = () => 'ink';
    return m;
  }
  function materials() {
    const ramp = R.ramp = new T.DataTexture(new Uint8Array([120, 190, 255]), 3, 1, T.RedFormat); ramp.minFilter = ramp.magFilter = T.NearestFilter; ramp.needsUpdate = true;
    const X = R.tx, lam = (map, o) => deepen(new T.MeshLambertMaterial(Object.assign({ vertexColors: true, map }, o || {})));
    R.mats = {
      wood: lam(X.wood), card: lam(X.card), cloth: lam(X.cloth), pages: lam(X.pages), velvet: lam(X.velvet), tin: lam(X.tin), paint: lam(X.paint),
      stripe: lam(X.stripe), ruler: lam(X.ruler), floor: lam(X.floor), rug: deepen(new T.MeshLambertMaterial({ map: X.rug })),
      decal: lam(X.atlas, { alphaTest: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      prop: toon({ vertexColors: true }),
      // one tile of the painted board per instance: aTile is that tile's corner in the board texture
      board: deepen(new T.MeshLambertMaterial({ map: X.board }), (sh) => {
        sh.vertexShader = 'attribute vec2 aTile;\n' + sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
  #ifdef USE_MAP
    vMapUv = aTile + (0.0154 + vMapUv * 0.969) * 0.1;
  #endif`);
      }, 'tile'),
      tileSide: deepen(new T.MeshLambertMaterial({ color: '#9a6440', map: X.wood })),
    };
    R.ink = inkMat('#2a1a2e');
  }

  /* ---------- geometry: bags of primitives with vertex colours, merged into one mesh per material ---------- */
  function mat4(x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, order) {
    return new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz, order || 'XYZ')), new T.Vector3(sx, sy, sz));
  }
  // planar uv in world units: tops from x/z, sides from the horizontal axis and y
  function planarUV(geo, s) {
    const p = geo.attributes.position, nr = geo.attributes.normal, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const nx = Math.abs(nr.getX(i)), ny = Math.abs(nr.getY(i)), nz = Math.abs(nr.getZ(i));
      if (ny >= nx && ny >= nz) { uv[i * 2] = p.getX(i) / s; uv[i * 2 + 1] = -p.getZ(i) / s; }
      else if (nx >= nz) { uv[i * 2] = p.getZ(i) / s; uv[i * 2 + 1] = p.getY(i) / s; }
      else { uv[i * 2] = p.getX(i) / s; uv[i * 2 + 1] = p.getY(i) / s; }
    }
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
  }
  function bag() {
    const list = [];
    const o = {
      list,
      // uv: > 0 planar world mapping with that tile size, 0 keep the geometry's own, otherwise none
      add(geo, col, m, uv) {
        if (m) geo.applyMatrix4(m);
        const n = geo.attributes.position.count, c = new T.Color(col), a = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
        geo.setAttribute('color', new T.BufferAttribute(a, 3));
        if (uv > 0) planarUV(geo, uv); else if (!(uv === 0 && geo.attributes.uv)) geo.setAttribute('uv', new T.BufferAttribute(new Float32Array(n * 2), 2));
        list.push(geo); return geo;
      },
      box: (w, h, d, col, x, y, z, uv, rx = 0, ry = 0, rz = 0) => o.add(new T.BoxGeometry(w, h, d), col, mat4(x, y, z, 1, 1, 1, rx, ry, rz), uv),
      cyl: (r1, r2, h, col, x, y, z, seg = 12, rx = 0, ry = 0, rz = 0) => o.add(new T.CylinderGeometry(r1, r2, h, seg), col, mat4(x, y, z, 1, 1, 1, rx, ry, rz)),
      cone: (r, h, col, x, y, z, seg = 10, rx = 0, ry = 0, rz = 0) => o.add(new T.ConeGeometry(r, h, seg), col, mat4(x, y, z, 1, 1, 1, rx, ry, rz)),
      sph: (ax, ay, az, col, x, y, z, seg = 14, rx = 0, ry = 0, rz = 0) => o.add(new T.SphereGeometry(1, seg, Math.max(6, (seg * 0.7) | 0)), col, mat4(x, y, z, ax, ay, az, rx, ry, rz)),
      tor: (Rr, r, col, x, y, z, rx = 0, ry = 0, rz = 0, arc = Math.PI * 2, seg = 24) => o.add(new T.TorusGeometry(Rr, r, 6, seg, arc), col, mat4(x, y, z, 1, 1, 1, rx, ry, rz)),
      cap: (r, len, col, x, y, z, rx = 0, ry = 0, rz = 0) => o.add(new T.CapsuleGeometry(r, len, 4, 10), col, mat4(x, y, z, 1, 1, 1, rx, ry, rz)),
      lathe: (pts, col, x, y, z, seg = 24) => o.add(new T.LatheGeometry(pts.map(([r, h]) => new T.Vector2(r, h)), seg), col, mat4(x, y, z)),
      slab: (w, th, d, r, bev, col, x, y, z, uv, ry = 0) => o.add(rslab(w, th, d, r, bev), col, mat4(x, y, z, 1, 1, 1, 0, ry, 0), uv),
    };
    return o;
  }
  function merge(list) {
    let nv = 0, ni = 0;
    for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
    let v = 0, k = 0;
    for (const g of list) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, v * 3); nor.set(g.attributes.normal.array, v * 3); col.set(g.attributes.color.array, v * 3); uv.set(g.attributes.uv.array, v * 2);
      if (g.index) for (let i = 0; i < g.index.count; i++) idx[k++] = g.index.array[i] + v; else for (let i = 0; i < n; i++) idx[k++] = v + i;
      v += n; g.dispose();
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3)); out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('color', new T.BufferAttribute(col, 3)); out.setAttribute('uv', new T.BufferAttribute(uv, 2));
    out.setIndex(new T.BufferAttribute(idx, 1)); out.computeBoundingSphere();
    return out;
  }
  // a slab with rounded corners and softened edges, top at y = 0, centred on x/z
  function rslab(w, th, d, r, bev) {
    bev = Math.max(0, Math.min(bev ?? 3, th / 3, w / 4, d / 4)); r = Math.max(0.5, Math.min(r, w / 2 - bev - 0.5, d / 2 - bev - 0.5));
    const sw = w - bev * 2, sd = d - bev * 2, x0 = -sw / 2, y0 = -sd / 2, s = new T.Shape();
    s.moveTo(x0 + r, y0); s.lineTo(x0 + sw - r, y0); s.quadraticCurveTo(x0 + sw, y0, x0 + sw, y0 + r); s.lineTo(x0 + sw, y0 + sd - r); s.quadraticCurveTo(x0 + sw, y0 + sd, x0 + sw - r, y0 + sd);
    s.lineTo(x0 + r, y0 + sd); s.quadraticCurveTo(x0, y0 + sd, x0, y0 + sd - r); s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
    const g = new T.ExtrudeGeometry(s, { depth: Math.max(0.1, th - bev * 2), bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 4 });
    g.rotateX(-Math.PI / 2); g.translate(0, -th + bev, 0);
    return g;
  }
  // a ruler along +x from 0 to len, top at y = 0: uv u in 500-unit lengths, v across (ticks along the far edge)
  function rulerGeo(len, wid, th) {
    const g = new T.BoxGeometry(len, th, wid); g.translate(len / 2, -th / 2, 0);
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 500, Math.abs(n.getY(i)) > 0.5 ? 1 - (p.getZ(i) + wid / 2) / wid : 0.06);
    return g;
  }
  const cellUV = (k) => [(k % 8) / 8, 1 - (((k / 8) | 0) + 1) / 8];
  function decalGeo(k, w, h) {
    const geo = new T.PlaneGeometry(w, h), uv = geo.attributes.uv, [u0, v0] = cellUV(k), e = 0.003;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + e + uv.getX(i) * (0.125 - 2 * e), v0 + e + uv.getY(i) * (0.125 - 2 * e));
    return geo;
  }
  function decal(B, k, col, x, y, z, w, h, face) {
    const r = face === 'front' ? [0, 0, 0] : face === '+x' ? [0, Math.PI / 2, 0] : [-Math.PI / 2, 0, 0];
    B('decal').add(decalGeo(k, w, h), col, mat4(x, y, z, 1, 1, 1, ...r), 0);
  }
  const keep = (x) => { R.trash.push(x); return x; };
  function mk(b, mat, cast = true) { const m = new T.Mesh(keep(merge(b.list)), mat || R.mats.prop); m.castShadow = cast; m.receiveShadow = true; return m; }
  function grp(x, y, z, parent) { const g = new T.Group(); g.position.set(x, y, z); (parent || R.world).add(g); return g; }
  function ringMesh(r0, r1, col, op, parent, seg = 48, start = 0) {
    const geo = keep(new T.RingGeometry(r0, r1, seg, 1, start)); geo.rotateX(-Math.PI / 2);
    const m = new T.Mesh(geo, keep(new T.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 })));
    m.renderOrder = 2; (parent || R.world).add(m); return m;
  }
  function label(text, col, x, y, z, h) { // a word floating over the desk (seesaw ends, twin levers)
    const c = cvs(256, 80), g = c.getContext('2d');
    g.font = '900 52px "Baloo 2", Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 12; g.strokeStyle = '#2a1f3d'; g.lineJoin = 'round'; g.strokeText(text, 128, 42); g.fillStyle = col; g.fillText(text, 128, 42);
    const s = new T.Sprite(keep(new T.SpriteMaterial({ map: keep(ctex(c)), depthWrite: false, fog: false })));
    s.scale.set(h * 3.2, h, 1); s.position.set(x, y, z); s.renderOrder = 6; R.world.add(s); return s;
  }

  /* ---------- the desk, per match ---------- */
  function clearMatch() {
    if (R.world) R.scene.remove(R.world);
    for (const x of R.trash) x.dispose(); R.trash = [];
    for (const v of R.views.values()) v.tag.remove();
    R.views.clear(); R.items.clear(); R.devs = [];
    for (const f of R.floats) { f.life = 0; f.el.style.display = 'none'; }
    for (const el of R.rings) { el.on = false; el.style.display = 'none'; } R.rqn = 0;
    if (R.pellets) { R.pellets.count = 0; R.staples.count = 0; R.glow.al.fill(0); R.glow.up(); }
    if (R.fx) { R.fx.life.fill(0); R.fx.al.fill(0); }
    for (const s of R.shocks || []) s.m.visible = false;
  }
  R.build = function (M) {
    clearMatch(); R.isMenu = false;
    R.M = M; R.world = new T.Group(); R.scene.add(R.world);
    R.W0 = { t: 0, on: new Set() };
    const bags = {}, B = (k) => bags[k] || (bags[k] = bag());
    floor(M, B);
    M.ground.forEach((g, i) => piece(g, i, B));
    buildTiles(M);
    buildDevices(M, B);
    buildChests(M);
    buildMarble(M);
    for (const k in bags) {
      const m = new T.Mesh(keep(merge(bags[k].list)), R.mats[k]);
      m.castShadow = k !== 'floor' && k !== 'decal'; m.receiveShadow = true; m.frustumCulled = false; R.world.add(m);
    }
    R.cz = 30; R.gy = 0; R.fit = null; R.warm = 3; R.w = 0; R.camF = 0; R.lookZ = M.half;
    R.fx.wind = R.devs.filter((v) => v.d.type === 'fan');
  };

  function floor(M, B) {
    const c = M.half, g = new T.PlaneGeometry(40000, 40000); g.rotateX(-Math.PI / 2);
    B('floor').add(g, '#ffffff', mat4(c, -DEEP, c), 1500);
    const rug = new T.Mesh(keep(new T.PlaneGeometry(M.w * 0.66, M.w * 0.5)), R.mats.rug);
    rug.rotation.set(-Math.PI / 2, 0, 0.06); rug.position.set(c, -DEEP + 1.5, c + 250); rug.receiveShadow = true; R.world.add(rug);
    const rnd = SIM.rng(M.seed ^ 0xbeef), P = B('paint');
    for (let i = 0; i < 70; i++) { // toys lying about far below
      const x = c + (rnd() - 0.5) * M.w * 1.5, z = c + (rnd() - 0.5) * M.w * 1.5, s = 130 + rnd() * 230, col = TOY[(rnd() * 6) | 0], k = rnd();
      if (k < 0.4) P.slab(s, s, s, 14, 6, col, x, -DEEP + s, z, 220, rnd() * 3);
      else if (k < 0.65) P.sph(s / 2, s / 2, s / 2, col, x, -DEEP + s / 2, z, 16);
      else { const a = rnd() * 3, L = s * 1.7, r = s * 0.13; P.cyl(r, r, L, col, x, -DEEP + r, z, 6, 0, a, Math.PI / 2); P.cone(r, r * 2.6, '#f1d3a1', x + Math.cos(a) * (L / 2 + r * 1.3), -DEEP + r, z - Math.sin(a) * (L / 2 + r * 1.3), 6, 0, a, -Math.PI / 2); }
    }
  }
  // a hardcover lying flat: covers, spine, pages; top at y
  function book(B, x, z, w, d, y, th, col, sp, deco) {
    const cv = 5, cl = B('cloth'), sx = sp === 0 ? -1 : sp === 1 ? 1 : 0, sz = sp === 2 ? -1 : sp === 3 ? 1 : 0;
    cl.box(w, cv, d, col, x, y - cv / 2, z, 150); cl.box(w, cv, d, col, x, y - th + cv / 2, z, 150);
    if (sx) cl.box(cv, th, d, col, x + sx * (w / 2 - cv / 2), y - th / 2, z, 150); else cl.box(w, th, cv, col, x, y - th / 2, z + sz * (d / 2 - cv / 2), 150);
    B('pages').box(w - 10, th - cv * 2 + 0.2, d - 10, '#f6ead0', x + sx * 3, y - th / 2, z + sz * 3, 100);
    if (deco) decal(B, 22, '#f2c75a', x, y + 0.3, z, w - 30, d - 30);
  }
  // whatever the piece stands on, down to the floor: books mostly, now and then a cardboard box, always inside the top
  function stack(B, x, z, w, d, y, rnd) {
    let k = 0;
    while (y > -DEEP + 2) {
      const th = Math.min(y + DEEP, (k < 2 ? 38 : 70) + rnd() * 40), ins = 5 + rnd() * 14, ox = (rnd() - 0.5) * (ins - 4) * 2, oz = (rnd() - 0.5) * (ins - 4) * 2;
      if (k < 3 || rnd() < 0.7) book(B, x + ox, z + oz, w - ins * 2, d - ins * 2, y, th, BOOK[(rnd() * BOOK.length) | 0], (rnd() * 4) | 0, false);
      else B('card').box(w - ins * 2, th, d - ins * 2, '#c99560', x + ox, y - th / 2, z + oz, 170);
      y -= th; k++;
    }
  }
  function piece(g, i, B) {
    const rnd = SIM.rng(i * 977 + 13), x = g.x + g.w / 2, z = g.y + g.h / 2, w = g.w, d = g.h;
    switch (g.kind) {
      case 'box': { // the start box: cardboard, taped in the duo's colour
        B('card').slab(w, DEEP, d, 12, 5, '#dcab70', x, 0, z, 170);
        const tc = teamCol(g.route);
        B('paint').box(56, 1.2, d + 2, tc, x, 0.4, z, 200); B('paint').box(56, 100, 1.2, tc, x, -50, z + d / 2 + 0.5, 200);
        B('paint').box(w - 40, 0.6, 3, '#9a6a3a', x, 0.15, z, 200);
        decal(B, 23, '#8a5a30', x - w * 0.27, 0.4, z + d * 0.27, 120, 120);
        break;
      }
      case 'block': { // toy blocks stacked to the floor, letters on the faces you can see
        let y = 0, k = 0;
        while (y > -DEEP + 2) {
          const s0 = Math.min(w, d), s = k ? s0 - 10 - rnd() * 14 : s0, h = Math.min(s, y + DEEP), col = TOY[(i * 5 + k * 2) % 6], ox = k ? (rnd() - 0.5) * 8 : 0, oz = k ? (rnd() - 0.5) * 8 : 0;
          B('paint').slab(s, h, s, 16, 7, col, x + ox, y, z + oz, 220, k > 1 ? (rnd() - 0.5) * 0.12 : 0);
          if (k < 2) {
            const lc = ART.shade(col, 0.6), L = (rnd() * 22) | 0;
            if (!k) decal(B, L, lc, x, 0.4, z, s * 0.64, s * 0.64);
            decal(B, (L + 5) % 22, lc, x + ox, y - h / 2, z + oz + s / 2 + 0.6, s * 0.6, s * 0.6, 'front');
            decal(B, (L + 9) % 22, lc, x + ox + s / 2 + 0.6, y - h / 2, z + oz, s * 0.6, s * 0.6, '+x');
          }
          y -= h; k++;
        }
        break;
      }
      case 'book': { const th = 58; book(B, x, z, w, d, 0, th, BOOK[i % BOOK.length], (rnd() * 4) | 0, true); stack(B, x, z, w, d, -th, rnd); break; }
      case 'velvet': { // a jewellery box: velvet cushion in a gold rim
        B('paint').slab(w, 64, d, 20, 5, '#d8a43c', x, 0, z, 200);
        B('velvet').slab(w - 28, 6, d - 28, 14, 2.5, '#8a45b8', x, 1.2, z, 220);
        B('paint').box(30, 22, 5, '#f4d27a', x, -30, z + d / 2 + 1, 200);
        stack(B, x, z, w, d, -64, rnd);
        break;
      }
      case 'tin': { // a cookie tin with a pressed lid
        B('tin').slab(w + 6, 16, d + 6, 46, 4, '#62cbc2', x, 0, z, 180);
        B('tin').slab(w, 64, d, 42, 3, '#2f8f8a', x, -16, z, 180);
        stack(B, x, z, w - 16, d - 16, -80, rnd);
        break;
      }
      case 'box2': { // a shoebox: striped lid on a tall box
        B('stripe').slab(w + 8, 26, d + 8, 12, 4, '#ffffff', x, 0, z, 170);
        B('card').slab(w, DEEP - 26, d, 8, 3, '#efe0c4', x, -26, z, 170);
        const s = Math.min(170, w * 0.5); decal(B, 24, '#ffffff', x, 0.4, z, s, s);
        break;
      }
      case 'rails': { // a wooden plank on two beams
        B('wood').slab(w - 4, 28, d - 2, 6, 3, '#dba676', x, 0, z, 220);
        const horiz = w >= d;
        for (const s of [-1, 1]) B('wood').box(horiz ? w - 30 : 46, DEEP - 28, horiz ? 46 : d - 30, '#6e4228', x + (horiz ? 0 : s * w * 0.28), -28 - (DEEP - 28) / 2, z + (horiz ? s * d * 0.28 : 0), 220);
        break;
      }
      case 'ring': { // the wooden frame round the board
        B('wood').slab(w, 46, d, 3, 4, '#d99c5e', x, 0, z, 260);
        B('wood').box(w - 16, DEEP - 46, d - 16, '#7a4a2e', x, -46 - (DEEP - 46) / 2, z, 260);
        break;
      }
      case 'ruler': { const horiz = w >= d; B('ruler').add(rulerGeo(horiz ? w : d, horiz ? d : w, 10), '#ffffff', mat4(horiz ? g.x : x, 1.5, horiz ? z : g.y, 1, 1, 1, 0, horiz ? 0 : -Math.PI / 2, 0), 0); break; }
      case 'tower': { // books stacked on a board tile
        const n = 4, th = (g.z || C.TOWER_Z) / n; let y = g.z || C.TOWER_Z;
        for (let k = 0; k < n; k++) {
          const ins = k ? 3 + rnd() * 7 : 0, ox = k ? (rnd() - 0.5) * ins : 0, oz = k ? (rnd() - 0.5) * ins : 0;
          book(B, x + ox, z + oz, w - ins * 2, d - ins * 2, y, th, BOOK[(i + k * 3) % BOOK.length], (rnd() * 4) | 0, k === 0); y -= th;
        }
        break;
      }
      default: B('wood').slab(w, 40, d, 8, 3, '#d79a5c', x, 0, z, 220); stack(B, x, z, w, d, -40, rnd);
    }
  }

  /* ---------- the board: one instanced column per tile ---------- */
  function buildTiles(M) {
    const S = C.TILE - 4, geo = keep(new T.BoxGeometry(S, DEEP, S)); geo.translate(0, -DEEP / 2, 0);
    const ix = Array.from(geo.index.array); geo.setIndex([...ix.slice(12, 18), ...ix.slice(0, 12), ...ix.slice(18)]); // the top first
    geo.clearGroups(); geo.addGroup(0, 6, 0); geo.addGroup(6, 30, 1);
    const at = new Float32Array(200); for (let i = 0; i < 100; i++) { at[i * 2] = (i % 10) / 10; at[i * 2 + 1] = 1 - (((i / 10) | 0) + 1) / 10; }
    geo.setAttribute('aTile', new T.InstancedBufferAttribute(at, 2));
    const im = R.tiles = new T.InstancedMesh(geo, [R.mats.board, R.mats.tileSide], 100);
    im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
    R.tileK = new Float32Array(100).fill(1); R.tileSt = new Int8Array(100).fill(-1);
    C1.setRGB(1, 1, 1);
    for (let i = 0; i < 100; i++) { tileMatrix(i, 0, 0, M.tiles[i] ? 0 : null); im.setColorAt(i, C1); }
    R.world.add(im);
  }
  function tileMatrix(i, ox, oz, y) {
    const M = R.M, t = M.tiles[i], tr = SIM.tileRect(i);
    if (y === null || !t) S1.set(0, 0, 0); else S1.set(1, 1, 1);
    V1.set(tr.x + M.half + C.TILE / 2 + ox, y || 0, tr.y + M.half + C.TILE / 2 + oz); Q1.identity();
    R.tiles.setMatrixAt(i, M1.compose(V1, Q1, S1));
  }
  function tiles(dt, t) {
    const M = R.M, im = R.tiles; let dirty = false, cdirty = false;
    for (let i = 0; i < 100; i++) {
      if (!M.tiles[i]) continue;
      const st = SIM.tileState(M, i, t), k0 = R.tileK[i];
      const k = R.tileK[i] = k0 + ((st === 2 ? 0 : 1) - k0) * Math.min(1, dt * (st === 2 ? 3 : 6));
      if (st === 1) { tileMatrix(i, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3); dirty = true; }
      else if (Math.abs(k - k0) > 1e-4 || R.tileSt[i] === 1) { tileMatrix(i, 0, 0, -(1 - k) * DEEP * 1.15); dirty = true; }
      if (st !== R.tileSt[i]) { if (st === 1) C1.setRGB(1, 0.72, 0.66); else C1.setRGB(1, 1, 1); im.setColorAt(i, C1); cdirty = true; R.tileSt[i] = st; }
    }
    if (dirty) im.instanceMatrix.needsUpdate = true;
    if (cdirty) im.instanceColor.needsUpdate = true;
  }

  /* ---------- devices ---------- */
  function thread(P, ax, ay, bx, by, col) { // a loose yarn showing what a button or lever works, sagging over the drop
    const l = Math.hypot(bx - ax, by - ay), cv = new T.QuadraticBezierCurve3(new T.Vector3(ax, 3, ay), new T.Vector3((ax + bx) / 2, -Math.min(170, l * 0.3), (ay + by) / 2), new T.Vector3(bx, 3, by));
    P.add(new T.TubeGeometry(cv, Math.max(12, (l / 22) | 0), 2.4, 4), col);
  }
  function ghost(d) { // the dashed outline of where a bridge or a drawer will be
    const m = new T.Mesh(keep(new T.PlaneGeometry(d.w - 10, d.h - 10)), keep(new T.MeshBasicMaterial({ map: R.tx.dash, color: '#fff3d6', transparent: true, opacity: 0.4, depthWrite: false })));
    m.rotation.x = -Math.PI / 2; m.position.set(d.x + d.w / 2, 1, d.y + d.h / 2); m.renderOrder = 3; R.world.add(m); return m;
  }
  function buildDevices(M, B) {
    const P = B('prop');
    for (const d of M.dev) {
      const v = { d, k: 1, tilt: 0 };
      const target = (id) => M.dev.find((o) => o.id === id);
      switch (d.type) {
        case 'gate': { // coloured pencils standing in a row; they sink into the book when the gate opens
          const b = bag(), horiz = d.w >= d.h, len = horiz ? d.w : d.h, th = horiz ? d.h : d.w, n = Math.max(1, Math.floor(len / 22)), st = len / n, r = Math.min(st, th) * 0.5;
          for (let k = 0; k < n; k++) {
            const o = -len / 2 + st * (k + 0.5), px = horiz ? o : 0, pz = horiz ? 0 : o, h = 78 + ((k * 7) % 3) * 6, col = TOY[k % 6];
            b.cyl(r, r, h, col, px, h / 2, pz, 6); b.cyl(r * 1.04, r * 1.04, 4, ART.shade(col, 0.7), px, h - 12, pz, 6);
            b.cone(r, 16, '#f1d3a1', px, h + 8, pz, 6); b.cone(r * 0.36, 5.8, '#3a2a2a', px, h + 13.1, pz, 6);
          }
          v.o = grp(d.x + d.w / 2, 0, d.y + d.h / 2); v.o.add(mk(b));
          break;
        }
        case 'bridge': { // a ruler drawbridge: stands up on its hinge, folds down flat when lowered
          const horiz = d.w >= d.h, len = horiz ? d.w : d.h, wid = horiz ? d.h : d.w;
          const ctl = M.dev.find((o) => (o.type === 'lever' || o.type === 'plate' || o.type === 'twin') && o.link === d.id);
          const from = ctl ? (horiz ? (ctl.x > d.x + d.w / 2 ? 1 : 0) : (ctl.y > d.y + d.h / 2 ? 1 : 0)) : 0;
          v.o = grp(horiz ? (from ? d.x + d.w : d.x) : d.x + d.w / 2, 1.5, horiz ? d.y + d.h / 2 : (from ? d.y + d.h : d.y));
          v.o.rotation.y = horiz ? (from ? Math.PI : 0) : (from ? Math.PI / 2 : -Math.PI / 2);
          v.arm = grp(0, 0, 0, v.o);
          const b = bag(); b.add(rulerGeo(len, wid, 12), '#ffffff', null, 0); v.arm.add(mk(b, R.mats.ruler));
          b.list.length = 0; b.cyl(9, 9, wid + 10, '#a8683f', 0, -6, 0, 10, Math.PI / 2); v.o.add(mk(b)); // the hinge
          v.k = 0; v.gh = ghost(d);
          break;
        }
        case 'drawer': { // slides out of the cabinet (the next piece) and back in
          const horiz = d.w >= d.h, L = horiz ? d.w : d.h, wid = horiz ? d.h : d.w;
          const a = SIM.modLocal(M, d.route, d.mod, d.x, d.y)[0], bq = SIM.modLocal(M, d.route, d.mod, d.x + d.w, d.y + d.h)[0], from = bq > a ? 1 : 0;
          const b = bag();
          b.box(L, 32, wid, '#b97a48', 0, -16.6, 0); b.box(L - 18, 1, wid - 18, '#efc993', 0, -0.4, 0);
          b.box(10, 46, wid + 14, '#c98a4f', -L / 2 + 5, -23, 0); b.sph(7, 7, 7, '#f6c844', -L / 2 - 7, -22, 0, 12);
          v.o = grp(d.x + d.w / 2, 0, d.y + d.h / 2); v.o.add(mk(b));
          v.o.rotation.y = horiz ? (from ? 0 : Math.PI) : (from ? -Math.PI / 2 : Math.PI / 2);
          v.ax = horiz ? 'x' : 'z'; v.base = v.o.position[v.ax]; v.L = L; v.sgn = from ? 1 : -1; v.gh = ghost(d);
          break;
        }
        case 'plat': { // a jam-jar lid ferrying over the drop
          const col = d.key === 'm1' ? '#e8553f' : '#3a7bd5', b = bag();
          b.slab(d.w, 20, d.h, 46, 5, col, 0, 0, 0); b.slab(d.w - 22, 2, d.h - 22, 36, 0.8, ART.mix(col, '#ffffff', 0.32), 0, 1, 0);
          v.o = grp(0, 0, 0); v.o.add(mk(b));
          const db = bag(); db.add(decalGeo(25, 70, 70), '#ffffff', mat4(0, 1.3, 0, 1, 1, 1, -Math.PI / 2), 0); v.o.add(mk(db, R.mats.decal, false));
          break;
        }
        case 'plate': { // a round button; presses down under a player
          const tc = teamCol(d.route), b = bag(), c = bag();
          b.cyl(44, 46, 6, '#e9dcc4', 0, 3, 0, 28);
          c.cyl(30, 32, 10, tc, 0, 5, 0, 24); c.cyl(23, 30, 3, ART.mix(tc, '#ffffff', 0.35), 0, 11, 0, 24);
          v.o = grp(d.x, 0, d.y); v.o.add(mk(b)); v.cap = mk(c); v.cap.position.y = 5; v.o.add(v.cap);
          const t = target(d.link); if (t) thread(P, d.x, d.y, t.x + t.w / 2, t.y + t.h / 2, tc);
          break;
        }
        case 'lever': case 'twin': {
          const b = bag(), s = bag();
          b.slab(56, 22, 34, 8, 3, '#a8683f', 0, 22, 0); b.box(12, 1, 22, '#4a2a18', 0, 22.2, 0);
          s.cyl(3.2, 3.2, 46, '#d9d2c4', 0, 23, 0, 8); s.sph(9.5, 9.5, 9.5, d.type === 'twin' ? '#ffb030' : '#e8553f', 0, 48, 0, 14);
          v.o = grp(d.x, 0, d.y); v.o.add(mk(b)); v.stick = grp(0, 20, 0, v.o); v.stick.add(mk(s));
          if (d.type === 'twin') label('×2', '#ffe08a', d.x, 120, d.y, 34);
          const t = target(d.link); if (t) thread(P, d.x, d.y, t.x + t.w / 2, t.y + t.h / 2, '#ffd36a');
          break;
        }
        case 'spin': { // a pencil spinning on a pushpin
          const b = bag(), L = d.len;
          b.cyl(8.5, 8.5, 2 * L - 34, '#f6c844', -3, 0, 0, 6, 0, 0, Math.PI / 2);
          b.cyl(8.6, 8.6, 10, '#e88aa0', -L + 5, 0, 0, 10, 0, 0, Math.PI / 2); b.cyl(9, 9, 7, '#c8c8c8', -L + 13, 0, 0, 10, 0, 0, Math.PI / 2);
          b.cone(8.5, 20, '#f1d3a1', L - 10, 0, 0, 6, 0, 0, -Math.PI / 2); b.cone(3, 7, '#3a2a2a', L - 3.5, 0, 0, 6, 0, 0, -Math.PI / 2);
          b.cyl(1.8, 1.8, 30, '#cfd6de', 0, -2, 0, 6); b.sph(12, 9, 12, '#e0507a', 0, 14, 0, 16);
          v.o = grp(d.x, 0, d.y); v.rot = grp(0, 16, 0, v.o); v.rot.add(mk(b));
          ringMesh(L + 2, L + 8, '#ffffff', 0.2, v.o).position.y = 0.6;
          break;
        }
        case 'seesaw': { // a ruler on an eraser: stand on the green end, the partner lands on the orange end
          const L = Math.hypot(d.bx - d.ax, d.by - d.ay) + 90, b = bag(), p = bag();
          v.o = grp((d.ax + d.bx) / 2, 0, (d.ay + d.by) / 2); v.o.rotation.y = -Math.atan2(d.by - d.ay, d.bx - d.ax);
          b.slab(34, 24, 50, 8, 3, '#ff9fb2', 0, 24, 0); b.box(34.4, 8, 50.4, '#e46f88', 0, 6, 0); v.o.add(mk(b));
          p.add(rulerGeo(L, 40, 8), '#ffffff', mat4(-L / 2, 0, 0), 0); v.pl = grp(0, 27, 0, v.o); v.pl.add(mk(p, R.mats.ruler));
          v.rest = 0.15; v.pl.rotation.z = v.rest;
          for (const [x, y, c] of [[d.ax, d.ay, '#7fdc5a'], [d.bx, d.by, '#ff9a4a']]) { ringMesh(0, 32, c, 0.22).position.set(x, 0.7, y); ringMesh(30, 36, c, 0.85).position.set(x, 0.8, y); }
          label('ĐỨNG', '#bff7a8', d.ax, 14, d.ay + 52, 22); label('NHẢY', '#ffd2a8', d.bx, 14, d.by + 52, 22);
          // the flight, as a dotted arc
          const g = SIM.groundAt(M, R.W0, d.tx, d.ty), tz = g ? g.z || 0 : 0, n = 22, pos = new Float32Array(n * 3);
          for (let k = 0; k < n; k++) { const u = (k + 1) / (n + 1); pos[k * 3] = d.ax + (d.tx - d.ax) * u; pos[k * 3 + 1] = 20 + (tz - 20) * u + 4 * 300 * u * (1 - u); pos[k * 3 + 2] = d.ay + (d.ty - d.ay) * u; }
          const pg = keep(new T.BufferGeometry()); pg.setAttribute('position', new T.BufferAttribute(pos, 3));
          R.world.add(new T.Points(pg, keep(new T.PointsMaterial({ color: '#bff7a8', size: 11, map: R.tx.dot, transparent: true, opacity: 0.55, depthWrite: false }))));
          break;
        }
        case 'fan': { // a desk fan far below the gap, blowing up
          const cx = d.x + d.w / 2, cz = d.y + d.h / 2, r = Math.min(d.w, d.h) * 0.45, fy = -DEEP * 0.32;
          P.cyl(9, 12, DEEP + fy, '#cfd6de', cx, (fy - DEEP) / 2, cz, 10); P.cyl(60, 70, 14, '#5b78d6', cx, -DEEP + 7, cz, 24);
          P.cyl(r * 0.25, r * 0.3, 30, '#5b78d6', cx, fy - 14, cz, 16);
          for (let k = 1; k <= 4; k++) P.tor(r * k / 4, k === 4 ? 4 : 1.6, '#e6eef8', cx, fy + 10, cz, Math.PI / 2, 0, 0, Math.PI * 2, 32);
          for (let k = 0; k < 6; k++) P.box(r * 2, 1.6, 2, '#e6eef8', cx, fy + 10, cz, 0, 0, k * Math.PI / 6, 0);
          const b = bag();
          for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; b.sph(r * 0.46, 2.4, r * 0.2, '#9fd0ff', Math.cos(a) * r * 0.48, 0, -Math.sin(a) * r * 0.48, 12, 0, a, 0); }
          b.sph(r * 0.14, 6, r * 0.14, '#dfe9f5', 0, 2, 0, 12);
          v.bl = grp(cx, fy + 2, cz); v.bl.add(mk(b));
          v.fy = fy;
          break;
        }
        case 'train': { // a chunky toy engine running across the planks
          const vert = Math.abs(d.y1 - d.y0) > Math.abs(d.x1 - d.x0), lt = vert ? d.h : d.w, wt = vert ? d.w : d.h, b = bag();
          b.box(lt + 4, 12, wt - 12, '#3a2a3a', 0, 12, 0);
          b.slab(lt - 4, 34, wt - 30, 8, 3, '#e8553f', 0, 50, 0);
          b.slab(lt * 0.44, 30, wt - 24, 6, 3, '#3a7bd5', -lt * 0.26, 80, 0); b.box(lt * 0.54, 6, wt - 14, '#f6c844', -lt * 0.26, 83, 0);
          b.cyl(7, 10, 24, '#2a1f3d', lt * 0.26, 62, 0, 10); b.sph(6, 6, 6, '#fff2a0', lt / 2, 36, 0, 10);
          for (const fx of [-0.3, 0, 0.3]) for (const s of [-1, 1]) { b.cyl(12, 12, 6, '#2a1f3d', fx * lt, 12, s * (wt / 2 - 12), 14, Math.PI / 2); b.cyl(4, 4, 7, '#f6c844', fx * lt, 12, s * (wt / 2 - 12), 8, Math.PI / 2); }
          v.o = grp(0, 0, 0); v.o.add(mk(b)); v.vert = vert; v.yaw = 0;
          // the track, past both edges of the plank
          if (vert) { const x = d.x0 + d.w / 2; for (let y = d.y0; y < d.y1 + d.h; y += 26) P.box(70, 3, 8, '#8a5432', x, 1, y); for (const o of [-22, 22]) P.box(5, 4, d.y1 + d.h - d.y0, '#a9b0bc', x + o, 3.5, (d.y0 + d.y1 + d.h) / 2); }
          else { const y = d.y0 + d.h / 2; for (let x = d.x0; x < d.x1 + d.w; x += 26) P.box(8, 3, 70, '#8a5432', x, 1, y); for (const o of [-22, 22]) P.box(d.x1 + d.w - d.x0, 4, 5, '#a9b0bc', (d.x0 + d.x1 + d.w) / 2, 3.5, y + o); }
          break;
        }
        case 'sling': { // a giant wooden slingshot at the handle, its bands running to the pouch
          const dx = d.x - d.hx, dy = d.y - d.hy, l = Math.hypot(dx, dy) || 1, b = bag();
          b.slab(64, 10, 64, 14, 3, '#7a4a2e', 0, 10, 0); b.cyl(8, 10, 70, '#8a5432', 0, 40, 0, 10);
          for (const s of [-1, 1]) { b.cyl(6, 7.5, 64, '#8a5432', 0, 98, s * 15, 10, s * 0.5); b.sph(8, 8, 8, '#c98a4f', 0, 126, s * 30, 10); }
          v.o = grp(d.hx, 0, d.hy); v.o.rotation.y = -Math.atan2(dy, dx); v.o.add(mk(b));
          v.l = l; v.pouch = new T.Mesh(keep(rslab(26, 10, 44, 6, 2)), R.mats.prop); v.pouch.geometry.setAttribute('color', new T.BufferAttribute(new Float32Array(v.pouch.geometry.attributes.position.count * 3).fill(0.2), 3)); v.o.add(v.pouch);
          v.bands = [-1, 1].map(() => { const m = new T.Mesh(R.bandGeo, R.bandMat); m.castShadow = true; v.o.add(m); return m; });
          ringMesh(0, 36, '#8a5432', 0.3).position.set(d.x, 0.6, d.y); ringMesh(32, 38, '#ffe08a', 0.85).position.set(d.x, 0.7, d.y);
          ringMesh(26, 31, '#ffffff', 0.35).position.set(d.hx, 0.7, d.hy);
          break;
        }
        default: continue;
      }
      R.devs.push(v);
    }
  }
  function devices(dt, now, t) {
    const kg = 1 - Math.pow(0.0001, dt), k7 = Math.min(1, dt * 7), k10 = Math.min(1, dt * 10);
    for (const v of R.devs) {
      const d = v.d;
      switch (d.type) {
        case 'gate': { const want = WD.on.has(d.id) ? 0 : 1; v.k += (want - v.k) * kg; v.o.position.y = -(1 - v.k) * 104; v.o.visible = v.k > 0.01; break; }
        case 'bridge': { const want = WD.on.has(d.id) ? 1 : 0; v.k += (want - v.k) * k7; v.arm.rotation.z = (1 - v.k) * 0.85; v.gh.visible = v.k < 0.5; v.gh.material.opacity = 0.32 + 0.2 * Math.sin(now * 3); break; }
        case 'drawer': { const kk = SIM.drawerK(d, t); v.o.position[v.ax] = v.base + (1 - kk) * v.L * v.sgn; v.gh.visible = kk < 0.5; break; }
        case 'plat': { const p = SIM.platPos(d, t); v.o.position.set(p.x, 0, p.y); break; }
        case 'train': {
          const p = SIM.trainPos(d, t), want = v.vert ? (p.dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (p.dir > 0 ? 0 : Math.PI);
          v.yaw += angD(want - v.yaw) * Math.min(1, dt * 9); v.o.rotation.y = v.yaw; v.o.position.set(p.x + d.w / 2, 0, p.y + d.h / 2);
          break;
        }
        case 'plate': {
          let down = false; for (const w of R.views.values()) if (w.root.visible && !w.fallT && w.h < 4 && Math.hypot(w.x - d.x, w.y - d.y) < C.PLATE_R) { down = true; break; }
          v.cap.position.y += ((down ? -2 : 5) - v.cap.position.y) * k10;
          break;
        }
        case 'lever': case 'twin': {
          v.stick.rotation.z += ((WD.on.has(d.link) ? -0.7 : 0.7) - v.stick.rotation.z) * k10;
          const tt = WD.bt.get(d.link); if (tt) ringAt(d.x, 92, d.y, tt / (d.type === 'twin' ? C.TWIN_T : C.BRIDGE_T), '#ffe08a');
          break;
        }
        case 'spin': v.rot.rotation.y = -SIM.spinAng(d, t); break;
        case 'seesaw': v.tilt = Math.max(0, v.tilt - dt * 1.8); v.pl.rotation.z = v.rest - (v.rest + 0.22) * Math.min(1, v.tilt * 1.6); break;
        case 'fan': v.bl.rotation.y += dt * 13; break;
        case 'sling': {
          const pull = (WD.sl.get(d.id) || 0) / 10; v.tilt = Math.max(0, v.tilt - dt * 3);
          const px = v.l + pull * 46 - v.tilt * 70, py = 12 + pull * 4;
          v.pouch.position.set(px, py, 0);
          v.bands.forEach((m, i) => { const s = i ? 1 : -1; band(m, 0, 126, s * 30, px, py + 4, s * 18); });
          if (pull) ringAt(d.x, 70, d.y, pull, '#ffe08a');
          break;
        }
      }
    }
  }
  function band(m, ax, ay, az, bx, by, bz) { // a unit cylinder stretched between two points
    V1.set(bx - ax, by - ay, bz - az); const l = V1.length() || 1;
    m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); m.quaternion.setFromUnitVectors(UP, V1.multiplyScalar(1 / l)); m.scale.set(1, l, 1);
  }

  /* ---------- chests, pickups, the marble ---------- */
  function buildChests(M) {
    R.chests = M.chests.map((c) => {
      const gold = c.tier === 1, wood = gold ? '#e3b232' : '#b36a3a', bandC = gold ? '#fff1b0' : '#e8b44f', b = bag(), l = bag();
      b.slab(60, 30, 42, 6, 2.5, ART.shade(wood, 0.82), 0, 30, 0); for (const s of [-1, 1]) b.box(6, 30.6, 43, bandC, s * 18, 15, 0);
      b.box(13, 15, 2.4, gold ? '#ffffff' : '#ffe08a', 0, 21, 21.6); b.box(3, 5, 2.8, '#5a321e', 0, 19, 22);
      l.slab(62, 14, 44, 8, 3, ART.mix(wood, '#ffffff', 0.18), 0, 14, 22); for (const s of [-1, 1]) l.box(6, 14.6, 44.6, bandC, s * 18, 7, 22);
      const o = grp(c.x, c.z || 0, c.y), lid = grp(0, 30, -21, o);
      for (const [bg, parent] of [[b, o], [l, lid]]) { const m = mk(bg); parent.add(new T.Mesh(m.geometry, R.ink), m); }
      const glow = new T.Sprite(R.glowMat); glow.scale.set(60, 40, 1); glow.position.set(0, 28, 0); glow.visible = false; o.add(glow);
      return { c, o, lid, glow, a: c.open ? 1 : 0 };
    });
  }
  function chests(dt, S) {
    for (const cv of R.chests) {
      const c = cv.c; cv.a += ((c.open ? 1 : 0) - cv.a) * Math.min(1, dt * 6);
      cv.lid.rotation.x = -cv.a * 1.9; cv.glow.visible = cv.a > 0.3;
      if (!c.open) for (const a of S.p.values()) if (a[19] && Math.abs(a[6] - c.z) < 30 && Math.hypot(a[1] - c.x, a[2] - c.y) < C.CHEST_R + 10) { ringAt(c.x, (c.z || 0) + 78, c.y, a[19] / 10, '#ffe08a'); break; }
    }
  }
  function items(now, dt) {
    const K = R.K || (R.K = R.kit());
    for (const it of G.items) {
      let o = R.items.get(it.id);
      if (!o) {
        o = new T.Group(); const geo = K.item(it.k), m = new T.Mesh(geo, R.mats.prop), ink = new T.Mesh(geo, R.ink), spin = new T.Group();
        m.castShadow = true; spin.add(ink, m); o.add(spin); o.spin = spin;
        const gl = new T.Sprite(R.glowMat); gl.scale.set(70, 70, 1); gl.position.y = -10; o.add(gl);
        R.world.add(o); R.items.set(it.id, o);
      }
      o.seen = R.frameNo; o.position.set(it.x, (it.z || 0) + 26 + Math.sin(now * 3 + it.id) * 5, it.y); o.spin.rotation.y += dt * 1.8;
    }
    for (const [id, o] of R.items) if (o.seen !== R.frameNo) { R.world.remove(o); R.items.delete(id); }
  }
  function buildMarble(M) {
    const b = bag(), r = C.MARBLE_R;
    b.sph(r, r, r, '#5aa8f0', 0, 0, 0, 32);
    b.tor(r * 0.72, r * 0.2, '#ff6b4a', 0, 0, 0, 0.4, 0, 0, Math.PI * 1.3, 28); // the swirl inside, showing as it rolls
    R.marble = grp(0, r, 0); R.marbleIn = mk(b, R.marbleMat); R.marble.add(R.marbleIn); R.marble.visible = false;
    R.lane = new T.Mesh(keep(new T.PlaneGeometry(C.MARBLE_R * 2 + 20, C.RING_OUT * 2)), keep(new T.MeshBasicMaterial({ color: '#ff4a3a', transparent: true, opacity: 0.4, depthWrite: false })));
    R.lane.rotation.x = -Math.PI / 2; R.lane.renderOrder = 3; R.lane.visible = false; R.world.add(R.lane);
  }
  function marble(dt, now, t) {
    if (!SIM.marbleAt) return;
    const M = R.M, mb = SIM.marbleAt(M, t);
    R.lane.visible = !!mb; R.marble.visible = !!(mb && !mb.warn);
    if (!mb) return;
    const e = mb.ev, h = M.half;
    R.lane.rotation.z = e.axis ? 0 : Math.PI / 2; R.lane.position.set(e.axis ? h + e.off : h, 1.2, e.axis ? h : h + e.off);
    R.lane.material.opacity = 0.34 + 0.16 * Math.sin(now * 12);
    if (!mb.warn) {
      R.marble.position.set(mb.x, C.MARBLE_R, mb.y);
      const sp = Math.hypot(mb.vx, mb.vy) || 1; V2.set(mb.vy / sp, 0, -mb.vx / sp);
      R.marbleIn.rotateOnWorldAxis(V2, -sp * dt / C.MARBLE_R);
    }
  }

  /* ---------- players ---------- */
  // a doll on its own: body, feet, gun hand, team ring and contact shadow (players and the menu's dolls)
  function rig(team, slot) {
    const K = R.K || (R.K = R.kit()), P = K.parts(team, slot);
    const mUp = keep(toon({ map: P.face, vertexColors: true })), mProp = keep(toon({ vertexColors: true }));
    const dual = (geo, m, parent) => { const g = new T.Group(), a = new T.Mesh(geo, m), b = new T.Mesh(geo, R.ink); a.castShadow = true; g.add(b, a); parent.add(g); return g; };
    const root = grp(0, 0, 0), turn = grp(0, 0, 0, root), body = grp(0, 0, 0, turn);
    turn.rotation.order = 'YXZ';
    dual(P.up, mUp, body);
    const fL = dual(P.foot, mProp, turn), fR = dual(P.foot, mProp, turn); fL.position.z = -6.5; fR.position.z = 6.5;
    const gunG = grp(10, 27, 12, body), gun = dual(K.gun(0, team, slot), mProp, gunG);
    const ring = ringMesh(20, 25, teamCol(team), 0.9, root, 32);
    const sh = new T.Mesh(R.blobGeo, R.blobMat); sh.renderOrder = 1; root.add(sh);
    return { root, turn, body, fL, fR, gunG, gun, mUp, mProp, P, ring, sh, team, yaw: 0, blinkT: 2 + Math.random() * 3 };
  }
  function blink(v, dt) {
    v.blinkT -= dt; const closed = v.blinkT < 0; if (v.blinkT < -0.13) v.blinkT = 2 + Math.random() * 3.5;
    const map = closed ? v.P.blink : v.P.face; if (v.mUp.map !== map) v.mUp.map = map;
  }
  function view(id) {
    let v = R.views.get(id); if (v) return v;
    const I = G.info.get(id) || { team: 0, slot: 0, name: '?' }, D = rig(I.team, I.slot), root = D.root;
    const tc = teamCol(I.team), mine = id === G.myId, me = G.info.get(G.myId), ally = !!(me && me.team === I.team);
    const bz = new T.Group(); root.add(bz); bz.visible = false;
    ringMesh(0, C.BOOST_R, '#bff7a8', 0.14, bz, 48); const bzr = ringMesh(C.BOOST_R - 4, C.BOOST_R + 2, '#bff7a8', 0.9, bz, 48);
    const mk2 = new T.Sprite(keep(new T.SpriteMaterial({ map: R.tx.mark, color: mine ? '#ffe08a' : tc, sizeAttenuation: false, depthTest: false, fog: false })));
    mk2.renderOrder = 9; mk2.visible = false; root.add(mk2);
    const tag = document.createElement('div'); tag.className = 't3'; tag.innerHTML = '<b></b><i><u></u><s></s></i><em></em><q>⇧</q>'; tag.style.display = 'none'; R.tags.appendChild(tag);
    tag.firstChild.textContent = I.name; tag.firstChild.style.color = mine ? '#ffe08a' : ally ? '#bff7ec' : '#ffffff';
    v = Object.assign(D, { id, bz, bzr, mk: mk2, tag, bar: tag.children[1], em: tag.children[2], arrow: tag.children[3],
      ally, mine, w: 0, walk: 0, x: 0, y: 0, z: 0, h: 0, fallT: 0, land: 0, recoil: 0, hurt: 0, key: '', tagOn: false, seen: -1 });
    R.views.set(id, v);
    return v;
  }
  R.player = function (id, x, y, z, ang, a, dt, now, mine) {
    if (!R.world) return;
    const v = view(id), st = a[5], falling = a[17] > 0 || !!(mine && G.me && G.me.fall > 0);
    v.seen = R.frameNo;
    if (st === 2) { v.root.visible = false; v.fallT = 0; return; }
    v.root.visible = true;
    if (falling) { // off the edge: dropping into the room below, shrinking away
      if (!v.fallT) { v.fx = x; v.fy = z; v.fz = y; v.ring.visible = v.sh.visible = v.bz.visible = false; }
      v.fallT += dt; const k = Math.min(1, v.fallT / C.FALL_T);
      v.root.position.set(v.fx, v.fy - k * k * DEEP * 0.9, v.fz); v.root.scale.setScalar(1 - k * 0.5);
      v.turn.rotation.x = -k * 2.2; v.turn.rotation.y += dt * 4;
      v.x = v.fx; v.y = v.fz; v.z = v.root.position.y; v.h = 99;
      return;
    }
    if (v.fallT) { v.fallT = 0; v.root.scale.setScalar(1); v.ring.visible = v.sh.visible = true; v.turn.rotation.x = 0; }
    const g = SIM.groundAt(G.map, G.W, x, y, z + C.STEP), fl = g ? g.z || 0 : 0, h = Math.max(0, z - fl);
    const moved = Math.hypot(x - v.x, y - v.y) / Math.max(dt, 1e-3), vz = (z - v.z) / Math.max(dt, 1e-3);
    v.x = x; v.y = y; v.z = z; v.h = h;
    v.root.position.set(x, z, y);
    const air = h > 1, walking = moved > 30 && !air, brace = !!a[26], down = st === 1;
    if (v.air && !air) v.land = 1; v.air = air;
    v.land = Math.max(0, v.land - dt * 5); v.recoil = Math.max(0, v.recoil - dt * 6); v.hurt = Math.max(0, v.hurt - dt * 4);
    v.walk += dt * (walking ? 15 : 0);
    // face the aim
    v.yaw += angD(-ang - v.yaw) * Math.min(1, dt * 16); v.turn.rotation.y = v.yaw;
    // squash and stretch: stretched rising, squashed landing or bracing, breathing idle
    const sw = Math.sin(v.walk), lq = Math.sin(v.land * Math.PI) * 0.18;
    let sy = 1 + (air ? clamp(vz / 5000, -0.06, 0.14) : walking ? Math.abs(sw) * 0.04 : Math.sin(now * 2.4 + id) * 0.02) - lq;
    if (brace) sy = 0.74;
    const sxz = 1 + (1 - sy) * 0.6;
    v.turn.scale.set(sxz * DS, sy * DS, sxz * DS);
    v.turn.rotation.x = down ? -1.45 : 0; v.turn.position.y = down ? 13 * DS : 0;
    v.body.position.y = walking ? Math.abs(sw) * 3 : 0; v.body.rotation.x = walking ? sw * 0.07 : 0;
    v.fL.position.set(walking ? sw * 6 : 0, walking ? Math.max(0, Math.cos(v.walk)) * 3 : 0, -6.5); v.fR.position.set(walking ? -sw * 6 : 0, walking ? Math.max(0, -Math.cos(v.walk)) * 3 : 0, 6.5);
    v.gunG.visible = !brace && !down; v.gunG.position.x = 10 - v.recoil * 5;
    if (v.w !== a[15]) { v.w = a[15]; const geo = R.K.gun(v.w, v.team, (G.info.get(id) || {}).slot | 0); for (const m of v.gun.children) m.geometry = geo; }
    // blink, hurt flash; low on health: a pulsing warm glow (lighter knocks send them further)
    blink(v, dt);
    const low = st === 0 && a[4] < 40 ? (1 - a[4] / 40) * (0.5 + 0.5 * Math.sin(now * (6 + (40 - a[4]) * 0.2))) : 0;
    const wf = Math.max(0, v.hurt - 0.65) * 2.6; // the first instant of a hit flashes white, then red fades out
    const er = Math.max(v.hurt * 0.6, low * 0.45) + wf, eg = v.hurt * 0.08 + low * 0.08 + wf;
    v.mUp.emissive.setRGB(er, eg, eg * 0.6 + wf); v.mProp.emissive.copy(v.mUp.emissive);
    v.body.rotation.z = low ? Math.sin(now * 9) * 0.06 * low : 0;
    v.root.visible = !(a[24] && Math.sin(now * 20) < -0.2); // just respawned: blinking, can't be hurt
    // on the ground: team ring and contact shadow; the boost zone around a bracing partner
    v.ring.position.y = fl - z + 0.7; v.ring.material.opacity = air ? 0.35 : 0.9;
    const shk = Math.max(0.3, 1 - h / 380); v.sh.position.y = fl - z + 0.5; v.sh.scale.set(shk, shk, shk); v.sh.material = R.blobMat;
    v.bz.visible = brace && v.ally && !v.mine;
    if (v.bz.visible) { const inside = Math.hypot(G.vis.x - x, G.vis.y - y) < C.BOOST_R && Math.abs(G.vis.z - z) < 10; v.bz.position.y = fl - z + 0.4; v.bzr.material.opacity = inside ? 1 : 0.5 + 0.3 * Math.sin(now * 5); v.bz.scale.setScalar(inside ? 1.04 : 1); }
    v.mk.position.set(0, 40, 0);
    v.tagY = down ? 48 : (84 + v.body.position.y) * DS;
    // the tag: hp + armour, or the bleed-out bar; a ring while being picked up
    const key = a[4] + '|' + st + '|' + a[7] + '|' + a[8] + '|' + a[9] + '|' + a[19] + '|' + (brace ? 1 : 0);
    if (key !== v.key) {
      v.key = key;
      const hp = a[4], u = v.bar.firstChild, s = v.bar.lastChild;
      if (st === 0) { u.style.width = (46 * hp / C.HP) + 'px'; u.style.background = hp > 50 ? '#7fdc5a' : hp > 25 ? '#ffc04a' : '#ff5a4a'; s.style.width = (46 * a[9] / C.ARMOR) + 'px'; }
      else { u.style.width = (46 * a[7] / C.BLEED) + 'px'; u.style.background = '#ff7a6a'; s.style.width = '0px'; }
      const k = st === 0 ? 0 : a[8] / 10 / C.REVIVE_T; // a chest shows its own ring, over the chest
      v.em.style.display = k > 0 ? 'block' : 'none'; if (k > 0) { v.em.style.setProperty('--k', Math.min(1, k)); v.em.style.setProperty('--c', st === 0 ? '#ffe08a' : '#9dffb0'); }
      v.arrow.style.display = brace ? 'block' : 'none';
    }
  };

  /* ---------- effects: particles, shock rings, shots, floating numbers ---------- */
  const PT_VS = `attribute vec3 aCol; attribute float aSize; attribute float aAlpha; uniform float uScale; varying vec3 vC; varying float vA;
void main() { vC = aCol; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aAlpha > 0.0 ? aSize * uScale / -mv.z : 0.0; gl_Position = projectionMatrix * mv; }`;
  const PT_FS = `uniform sampler2D uTex; varying vec3 vC; varying float vA;
void main() { vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); }`;
  function points(cap, tex) {
    const geo = new T.BufferGeometry(), o = { cap, pos: new Float32Array(cap * 3), col: new Float32Array(cap * 3), sz: new Float32Array(cap), al: new Float32Array(cap) };
    for (const [n, a, k] of [['position', o.pos, 3], ['aCol', o.col, 3], ['aSize', o.sz, 1], ['aAlpha', o.al, 1]]) geo.setAttribute(n, new T.BufferAttribute(a, k).setUsage(T.DynamicDrawUsage));
    const mat = new T.ShaderMaterial({ uniforms: { uTex: { value: tex }, uScale: R.ptU }, vertexShader: PT_VS, fragmentShader: PT_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    o.p = new T.Points(geo, mat); o.p.frustumCulled = false; o.p.renderOrder = 7; o.geo = geo; R.scene.add(o.p);
    o.up = () => { for (const n of ['position', 'aCol', 'aSize', 'aAlpha']) geo.attributes[n].needsUpdate = true; };
    return o;
  }
  function fxInit() {
    const cap = TOUCH ? 320 : 640;
    R.fx = points(cap, R.tx.glow); Object.assign(R.fx, { vel: new Float32Array(cap * 3), life: new Float32Array(cap), a0: new Float32Array(cap), i: 0, wind: [] });
    R.glow = points(200, R.tx.glow); R.wind = points(120, R.tx.streak);
    R.dust = points(TOUCH ? 36 : 70, R.tx.glow); R.dust.seed = Float32Array.from({ length: R.dust.cap * 4 }, () => Math.random());
    R.glowMat = new T.SpriteMaterial({ map: R.tx.glow, color: '#ffd890', transparent: true, opacity: 0.32, depthWrite: false, blending: T.AdditiveBlending, fog: false });
    R.blobGeo = new T.PlaneGeometry(66, 66); R.blobGeo.rotateX(-Math.PI / 2);
    R.blobMat = new T.MeshBasicMaterial({ map: R.tx.blob, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    R.bandGeo = new T.CylinderGeometry(2.6, 2.6, 1, 6); R.bandMat = toon({ color: '#6cc24a' });
    R.marbleMat = new T.MeshPhongMaterial({ vertexColors: true, specular: '#ffffff', shininess: 90, emissive: '#10304a' });
    // shots: pellets (most weapons) and staples, instanced
    R.pellets = new T.InstancedMesh(new T.SphereGeometry(1, 10, 8), new T.MeshBasicMaterial(), 200); R.pellets.count = 0; R.pellets.frustumCulled = false;
    R.staples = new T.InstancedMesh(new T.BoxGeometry(16, 3, 5), new T.MeshBasicMaterial({ color: '#d8dde8' }), 60); R.staples.count = 0; R.staples.frustumCulled = false;
    R.pellets.setColorAt(0, C1.set('#ffffff'));
    R.scene.add(R.pellets, R.staples);
    R.shotCol = {};
    R.shocks = [];
    for (let i = 0; i < 8; i++) {
      const g = new T.RingGeometry(0.8, 1, 48); g.rotateX(-Math.PI / 2);
      const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }));
      m.visible = false; m.renderOrder = 6; R.scene.add(m); R.shocks.push({ m, t: 0, T: 0.45, r: 100 });
    }
  }
  function puff(x, y, z, hexc, n, sp = 140) {
    const F = R.fx, r = ((hexc >> 16) & 255) / 255, g = ((hexc >> 8) & 255) / 255, b = (hexc & 255) / 255;
    for (let k = 0; k < n; k++) {
      const i = F.i = (F.i + 1) % F.cap, a = Math.random() * 6.283, s = sp * (0.4 + Math.random() * 0.6), up = Math.random();
      F.pos[i * 3] = x; F.pos[i * 3 + 1] = y; F.pos[i * 3 + 2] = z;
      F.vel[i * 3] = Math.cos(a) * s; F.vel[i * 3 + 1] = 30 + up * sp * 0.8; F.vel[i * 3 + 2] = Math.sin(a) * s;
      F.col[i * 3] = r; F.col[i * 3 + 1] = g; F.col[i * 3 + 2] = b; F.sz[i] = 20 + Math.random() * 22; F.life[i] = 0.45 + Math.random() * 0.35; F.a0[i] = 0.9;
    }
  }
  function shock(x, y, z, rad, col) {
    const s = R.shocks.find((o) => !o.m.visible) || R.shocks[0];
    s.m.visible = true; s.t = 0; s.r = rad; s.m.position.set(x, y, z); s.m.material.color.set(col);
  }
  function fx(dt) {
    const F = R.fx, drag = Math.pow(0.12, dt);
    for (let i = 0; i < F.cap; i++) {
      if (F.life[i] <= 0) { F.al[i] = 0; continue; }
      F.life[i] -= dt;
      F.pos[i * 3] += F.vel[i * 3] * dt; F.pos[i * 3 + 1] += F.vel[i * 3 + 1] * dt; F.pos[i * 3 + 2] += F.vel[i * 3 + 2] * dt;
      F.vel[i * 3] *= drag; F.vel[i * 3 + 1] = F.vel[i * 3 + 1] * drag + 20 * dt; F.vel[i * 3 + 2] *= drag;
      F.al[i] = Math.min(1, F.life[i] * 2.5) * F.a0[i]; F.sz[i] += dt * 30;
    }
    F.up();
    for (const s of R.shocks) {
      if (!s.m.visible) continue; s.t += dt; const k = s.t / s.T;
      if (k >= 1) { s.m.visible = false; continue; }
      const r = 12 + (s.r - 12) * (1 - (1 - k) * (1 - k)); s.m.scale.set(r, 1, r); s.m.material.opacity = 0.9 * (1 - k);
    }
    // the fans' updraft: streaks rising out of the drop
    const W = R.wind; let n = 0; const now = performance.now() / 1000;
    for (const v of F.wind) {
      const d = v.d;
      for (let k = 0; k < 28 && n < W.cap; k++, n++) {
        const ph = (now * 0.7 + k / 28 + (k % 3) * 0.13) % 1, y = v.fy + ph * (C.FAN_TOP + 40 - v.fy);
        W.pos[n * 3] = d.x + 20 + ((k * 53) % (d.w - 40)); W.pos[n * 3 + 1] = y; W.pos[n * 3 + 2] = d.y + 20 + ((k * 97) % (d.h - 40));
        W.col[n * 3] = 0.7; W.col[n * 3 + 1] = 0.9; W.col[n * 3 + 2] = 1; W.sz[n] = 70; W.al[n] = Math.sin(ph * Math.PI) * 0.85;
      }
    }
    for (let i = n; i < W.cap; i++) W.al[i] = 0;
    W.up();
    // dust motes drifting in the lamp light around the camera target
    const U = R.dust, sd = U.seed, lx = R.cam.position.x, lz = R.lookZ || 0, wrapc = (v, c, r) => c + ((((v - c + r) % (2 * r)) + 2 * r) % (2 * r)) - r;
    for (let i = 0; i < U.cap; i++) {
      const a = sd[i * 4], b = sd[i * 4 + 1], c = sd[i * 4 + 2], e = sd[i * 4 + 3];
      U.pos[i * 3] = wrapc(a * 4000 + now * (12 + e * 20), lx, 1100); U.pos[i * 3 + 1] = -150 + b * 650 + Math.sin(now * 0.6 + e * 6) * 30; U.pos[i * 3 + 2] = wrapc(c * 4000 - now * 8, lz, 800);
      U.col[i * 3] = 1; U.col[i * 3 + 1] = 0.85; U.col[i * 3 + 2] = 0.6; U.sz[i] = 6 + e * 10; U.al[i] = (0.25 + 0.35 * Math.sin(now * 1.3 + e * 9)) * (1 - R.camF);
    }
    U.up();
  }
  function shotColor(w, team) {
    const k = w * 8 + team; if (R.shotCol[k]) return R.shotCol[k];
    const tc = teamCol(team), s = w === 1 ? tc : w === 2 ? ART.mix(tc, '#ffffff', 0.4) : w === 4 ? '#9a6be0' : w === 5 ? '#ffd0e0' : w === 6 ? '#fff6e0' : '#fff4dc';
    return (R.shotCol[k] = { c: new T.Color(s), g: rgb(tc) });
  }
  const SHOT_R = [6, 5, 3.6, 0, 11, 10, 14];
  function shots(rt) {
    let np = 0, ns = 0, ng = 0; const Gl = R.glow;
    for (const s of G.shots.values()) {
      const tt = clamp(rt - s.t + DELAY * 0.5, -0.1, 0.4), x = s.x + s.vx * tt, y = s.y + s.vy * tt; let h = (s.z || 0) + 30;
      if (s.w === 4) { if (s.r3 === undefined) s.r3 = rt; const k = clamp((rt - s.r3) / 0.62, 0, 1); h += Math.sin(k * Math.PI) * 90; }
      const col = shotColor(s.w, s.team);
      V1.set(x, h, y);
      if (s.w === 3) { if (ns < 60) { Q1.setFromAxisAngle(UP, -Math.atan2(s.vy, s.vx)); S1.set(1, 1, 1); R.staples.setMatrixAt(ns++, M1.compose(V1, Q1, S1)); } }
      else if (np < 200) { Q1.identity(); const r = SHOT_R[s.w] || 6; S1.set(r, r, r); R.pellets.setMatrixAt(np, M1.compose(V1, Q1, S1)); R.pellets.setColorAt(np++, col.c); }
      if (ng < Gl.cap) { Gl.pos[ng * 3] = x; Gl.pos[ng * 3 + 1] = h; Gl.pos[ng * 3 + 2] = y; Gl.col[ng * 3] = col.g[0]; Gl.col[ng * 3 + 1] = col.g[1]; Gl.col[ng * 3 + 2] = col.g[2]; Gl.sz[ng] = s.w === 4 ? 46 : 24; Gl.al[ng++] = 0.5; }
    }
    for (let i = ng; i < Gl.cap; i++) Gl.al[i] = 0;
    Gl.up();
    R.pellets.count = np; R.staples.count = ns;
    if (np) { R.pellets.instanceMatrix.needsUpdate = true; R.pellets.instanceColor.needsUpdate = true; }
    if (ns) R.staples.instanceMatrix.needsUpdate = true;
  }
  function floatText(x, y, z, text, col, big) {
    let f = R.floats.find((o) => o.life <= 0);
    if (!f) { if (R.floats.length >= 24) return; f = { el: document.createElement('div'), life: 0 }; f.el.className = 'f3'; R.tags.appendChild(f.el); R.floats.push(f); }
    f.el.textContent = text; f.el.style.color = col; f.el.style.fontSize = big ? '30px' : ''; f.x = x + (Math.random() - 0.5) * 24; f.y = y; f.z = z; f.life = big ? 1.4 : 0.9; f.el.style.display = '';
  }
  function ringAt(x, y, z, k, col) { const o = R.rq[R.rqn] || (R.rq[R.rqn] = {}); o.x = x; o.y = y; o.z = z; o.k = Math.min(1, k); o.c = col; R.rqn++; }

  /* ---------- events from the snapshots ---------- */
  R.event = function (e) {
    if (!R.world) return;
    const t = e[0], P = (id) => { const v = R.views.get(id); return v && v.root.visible ? v : null; };
    const gz = (x, y) => { const g = SIM.groundAt(R.M, G.W, x, y); return g ? g.z || 0 : 0; };
    let v;
    switch (t) {
      case 'hit': if ((v = P(e[1]))) { // a white flash, a burst of sparks; bigger numbers for my own hits
        const byMe = e[4] === G.myId;
        floatText(v.x, v.z + 112, v.y, '-' + e[2], e[1] === G.myId ? '#ff6b6b' : byMe ? '#ffd27a' : '#ffffff', byMe);
        v.hurt = 1; puff(v.x, v.z + 46, v.y, 0xfff4d0, byMe ? 12 : 7, 220); if (e[2] >= 20) puff(v.x, v.z + 46, v.y, 0xffb347, 8, 300);
      } break;
      case 'shot': if ((v = P(e[1]))) { v.recoil = 1; const a = -v.yaw; puff(v.x + Math.cos(a) * 40, v.z + 30, v.y + Math.sin(a) * 40, 0xfff1c0, 2, 50); } break;
      case 'pop': puff(e[1], gz(e[1], e[2]) + 30, e[2], 0xffe2b0, 6, 90); break;
      case 'boom': { const z = gz(e[1], e[2]); puff(e[1], z + 30, e[2], 0xffc070, 26, 260); puff(e[1], z + 30, e[2], 0xb48cff, 12, 180); shock(e[1], z + 3, e[2], 125, '#ffcf7a'); break; }
      case 'jump': if (e[2] === 2 && (v = P(e[1]))) { puff(v.x, v.z + 6, v.y, 0xbff7a8, 12, 150); shock(v.x, v.z + 2, v.y, 70, '#bff7a8'); } break;
      case 'launch': case 'sling': { const dv = R.devs.find((o) => o.d.id === e[2]); if (dv) dv.tilt = 1; if ((v = P(e[1]))) puff(v.x, v.z + 10, v.y, 0xfff1a0, 12, 170); break; }
      case 'shock': if ((v = P(e[1]))) { puff(v.x, v.z + 10, v.y, 0xffe08a, 24, 240); shock(v.x, v.z + 3, v.y, C.SHOCK_R, '#ffe08a'); } break;
      case 'fall': if ((v = P(e[1]))) puff(v.x, v.z + 6, v.y, 0xffe2b0, 8, 110); break;
      case 'spin': case 'train': if ((v = P(e[1]))) puff(v.x, v.z + 30, v.y, 0xfff1a0, 8); break;
      case 'marble': if ((v = P(e[1]))) puff(v.x, v.z + 30, v.y, 0x9fd8ff, 14, 200); break;
      case 'chest': { const c = R.M.chests[e[1]]; if (c) puff(c.x, (c.z || 0) + 40, c.y, 0xffe08a, 18, 160); break; }
      case 'rev': if ((v = P(e[1]))) puff(v.x, v.z + 30, v.y, 0x9dffb0, 16); break;
      case 'spawn': if ((v = R.views.get(e[1]))) puff(v.x, v.z + 30, v.y, 0xffffff, 10); break;
      case 'heal': case 'armor': if ((v = P(e[1]))) puff(v.x, v.z + 30, v.y, t === 'heal' ? 0xff8080 : 0x80b0ff, 10); break;
      case 'ko': if ((v = R.views.get(e[1]))) { // knocked off: a burst where they went over, and the score
        puff(v.x, Math.max(0, v.z) + 20, v.y, parseInt(teamCol(e[3] ?? 0).slice(1), 16), 22, 220);
        const me = G.info.get(G.myId); floatText(v.x, Math.max(0, v.z) + 110, v.y, '+1', me && me.team === e[3] ? '#ffe08a' : '#ffffff', true);
      } break;
    }
  };

  /* ---------- camera, light, quality ---------- */
  function size() {
    const W = innerWidth, Hh = innerHeight, q = R.q;
    if (W === R.w && Hh === R.h && R.prSet === q.pr) return;
    R.w = W; R.h = Hh; R.prSet = q.pr;
    R.ren.setPixelRatio(q.pr); R.ren.setSize(W, Hh, false);
    R.cam.aspect = W / Hh; R.fit = null;
    const tanH = Math.tan(FOV * Math.PI / 360), bh = Hh * q.pr;
    R.inkU.value.set(1.5 * q.pr, bh); R.ptU.value = bh / (2 * tanH);
    R.markS = 2 * tanH / Hh; // sprite scale for 1 screen pixel (sizeAttenuation off)
  }
  function quality(dt) {
    const q = R.q;
    if (R.warm > 0) { R.warm -= dt; return; }
    q.ft += (dt - q.ft) * 0.05;
    q.slow = q.ft > (TOUCH ? 1 / 27 : 1 / 50) ? q.slow + dt : Math.max(0, q.slow - dt);
    if (q.slow < 2.5 || q.lvl >= 4) return;
    q.slow = 0; q.lvl++; R.warm = 2; q.ft = 1 / 60;
    if (q.lvl === 1) { q.pr = Math.max(1, q.pr * 0.8); for (const d of [...R.vig.querySelectorAll('.ts3')]) d.remove(); }
    else if (q.lvl === 2) { q.map = 1024; R.sun.shadow.mapSize.set(1024, 1024); if (R.sun.shadow.map) { R.sun.shadow.map.dispose(); R.sun.shadow.map = null; } }
    else if (q.lvl === 3) q.pr = Math.max(0.7, q.pr * 0.8);
    else { R.ren.shadowMap.enabled = false; R.sun.castShadow = false; }
    console.info('3D quality lowered to level', q.lvl);
  }
  // how far the camera must be to show the whole desk at the overview tilt
  function fitDist() {
    const M = R.M, c = M.half, e = M.half - 130, cam = R.fitCam || (R.fitCam = new T.PerspectiveCamera());
    cam.fov = FOV; cam.aspect = R.w / R.h; cam.near = 10; cam.far = 1e6; cam.updateProjectionMatrix();
    let lo = 300, hi = 300000;
    for (let i = 0; i < 36; i++) {
      const d = (lo + hi) / 2; cam.position.set(c, d * Math.sin(PITCH_FAR), c + d * Math.cos(PITCH_FAR)); cam.lookAt(c, 0, c); cam.updateMatrixWorld();
      let ok = true; for (const [x, z] of [[c - e, c - e], [c + e, c - e], [c - e, c + e], [c + e, c + e]]) { V1.set(x, 0, z).project(cam); if (Math.abs(V1.x) > 0.96 || Math.abs(V1.y) > 0.92) ok = false; }
      if (ok) hi = d; else lo = d;
    }
    return hi;
  }
  function camera(dt) {
    const W = R.w, Hh = R.h, M = R.M, tanH = Math.tan(FOV * Math.PI / 360);
    const z0 = Math.max(W / (TOUCH ? 1300 : 1600), Hh / (Hh > W ? 1650 : 950)), zo = Math.min(W / (M.w - 300), Hh / (M.h - 300));
    const zs = G.cam.zs || z0, f = z0 > zo ? clamp((z0 - zs) / (z0 - zo), 0, 1) : 0, fe = f * f * (3 - 2 * f);
    if (!R.fit) R.fit = fitDist();
    const base = Hh / zs / (2 * tanH), baseO = Hh / zo / (2 * tanH), dist = base * (1 + (R.fit / baseO - 1) * f);
    const pitch = PITCH + (PITCH_FAR - PITCH) * fe;
    // the 2D camera's target, minus the fake lift it adds for height (same filter, so it cancels); height from the ground
    const look = IN.look || IN.keys.KeyQ || IN.keys.Tab || IN.peek;
    R.cz += ((look ? 0 : 30 + (G.vis.z || 0) * LIFT) - R.cz) * (1 - Math.pow(look ? 0.00002 : 0.0008, dt));
    const g = look ? null : SIM.groundAt(M, G.W, G.vis.x, G.vis.y, (G.vis.z || 0) + C.STEP);
    R.gy += ((g ? g.z || 0 : 0) - R.gy) * (1 - Math.pow(0.08, dt));
    const lx = G.cam.x, lz = G.cam.y + R.cz, ly = R.gy * (1 - f);
    let sx = 0, sz = 0; if (G.shake > 0) { const s = G.shake / zs; sx = (Math.random() - 0.5) * s; sz = (Math.random() - 0.5) * s; }
    const cam = R.cam;
    cam.position.set(lx + sx, ly + dist * Math.sin(pitch), lz + dist * Math.cos(pitch) + sz); cam.lookAt(lx + sx, ly, lz + sz);
    cam.near = Math.max(10, dist * 0.25); cam.far = dist * 3 + DEEP * 4 + 6000; cam.updateProjectionMatrix();
    R.scene.fog.near = dist * 1.02; R.scene.fog.far = dist * 2.8 + 1200;
    R.camF = f; R.dist = dist; R.lookZ = lz;
    shadowFollow(lx, ly, lz, dist);
  }
  function shadowFollow(lx, ly, lz, dist) {
    if (!R.sun.castShadow) return;
    const S = clamp(dist * Math.tan(FOV * Math.PI / 360) * Math.max(1, R.w / R.h) * 1.2 + 260, 650, 5200), sc = R.sun.shadow.camera;
    if (!R.shS || Math.abs(S - R.shS) > R.shS * 0.08) { R.shS = S; sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.updateProjectionMatrix(); }
    // centred a little up the screen (more of the desk shows there), snapped to whole shadow texels so edges don't crawl
    V1.set(lx, ly, lz - R.shS * 0.2);
    const tx = 2 * R.shS / R.q.map, a = V1.dot(R.lright), b = V1.dot(R.lup);
    V1.addScaledVector(R.lright, Math.round(a / tx) * tx - a).addScaledVector(R.lup, Math.round(b / tx) * tx - b);
    R.sun.target.position.copy(V1); R.sun.position.copy(V1).addScaledVector(R.ldir, 4000);
  }
  R.screenToWorld = function (sx, sy, h) {
    if (!R.cam || !R.w) return R.aim;
    R.ndc.set(sx / R.w * 2 - 1, 1 - sy / R.h * 2); R.ray.setFromCamera(R.ndc, R.cam);
    R.plane.constant = -h;
    if (R.ray.ray.intersectPlane(R.plane, R.hit)) { R.aim.x = R.hit.x; R.aim.y = R.hit.z; }
    return R.aim;
  };

  /* ---------- the frame ---------- */
  function toScreen(x, y, z) {
    V3.set(x, y, z).project(R.cam);
    if (V3.z > 1) return false;
    R.sx = (V3.x + 1) / 2 * R.w; R.sy = (1 - V3.y) / 2 * R.h;
    return R.sx > -80 && R.sx < R.w + 80 && R.sy > -80 && R.sy < R.h + 80;
  }
  function overlay(dt) {
    const far = !!G.cam.far;
    for (const v of R.views.values()) {
      const show = v.root.visible && !v.fallT && v.seen === R.frameNo && !far && toScreen(v.x, v.z + v.tagY, v.y);
      if (show !== v.tagOn) { v.tagOn = show; v.tag.style.display = show ? '' : 'none'; }
      if (show) v.tag.style.transform = `translate3d(${R.sx.toFixed(1)}px,${R.sy.toFixed(1)}px,0)`;
      v.mk.visible = far && v.root.visible && !v.fallT && v.seen === R.frameNo;
      if (v.mk.visible) { const s = R.markS * (v.mine ? 26 : 19); v.mk.scale.set(s, s, 1); }
    }
    for (let i = 0; i < R.rqn || i < R.rings.length; i++) {
      let el = R.rings[i];
      if (i >= R.rqn) { if (el && el.on) { el.on = false; el.style.display = 'none'; } continue; }
      if (!el) { el = R.rings[i] = document.createElement('div'); el.className = 'r3'; R.tags.appendChild(el); }
      const o = R.rq[i], ok = toScreen(o.x, o.y, o.z);
      if (ok !== el.on) { el.on = ok; el.style.display = ok ? '' : 'none'; }
      if (ok) { el.style.transform = `translate3d(${R.sx.toFixed(1)}px,${R.sy.toFixed(1)}px,0)`; el.style.setProperty('--k', o.k.toFixed(3)); el.style.setProperty('--c', o.c); }
    }
    R.rqn = 0;
    for (const f of R.floats) {
      if (f.life <= 0) { if (f.el.style.display !== 'none') f.el.style.display = 'none'; continue; }
      f.life -= dt; f.y += 55 * dt;
      if (f.life <= 0 || !toScreen(f.x, f.y, f.z)) { f.el.style.display = 'none'; continue; }
      f.el.style.display = ''; f.el.style.opacity = Math.min(1, f.life * 2.2).toFixed(2);
      f.el.style.transform = `translate3d(${R.sx.toFixed(1)}px,${R.sy.toFixed(1)}px,0)`;
    }
  }
  /* ---------- the menu: the desk as a slow cinematic backdrop behind the title card ----------
     A fixed map (seed 7). The camera starts low on duo 0's start box where two dolls idle (one waves, one hops),
     follows that route to the ring, then circles the board with its towers, and cuts back. The subject is framed on the
     right two thirds of a landscape screen (the card is on the left) and in the upper half of a portrait one.
     It runs its own frame loop, since game.js does not draw in the menu. */
  const MENU_SEED = 7;
  R.menu = function (on) {
    if (!R.on) return;
    if (!on) {
      const mn = R.mn; if (!mn) return;
      R.mn = null; cancelAnimationFrame(mn.raf); R.cam.clearViewOffset(); R.q.pr = mn.pr; R.fade.style.opacity = 0;
      return;
    }
    if (R.mn) return;
    if (!R.isMenu) menuBuild();
    const mn = R.mn = { t0: performance.now() / 1000, last: 0, raf: 0, pr: R.q.pr };
    R.q.pr = Math.min(R.q.pr, 1.25);
    const loop = () => { if (R.mn !== mn) return; mn.raf = requestAnimationFrame(loop); menuFrame(mn); };
    mn.raf = requestAnimationFrame(loop);
  };
  function menuBuild() {
    const M = SIM.makeMap(MENU_SEED); R.build(M); R.isMenu = true;
    R.mW = { on: new Set(), bt: new Map(), sl: new Map(), gates: M.dev.filter((d) => d.type === 'gate' || d.type === 'bridge').map((d) => d.id) };
    // the dolls: duo 0 on its start box, duo 1 on the next box round, two more scuffling on the board
    const h = M.half, at = (team, slot) => { const [x, y] = SIM.basePos(M, team, 0), [x1, y1] = SIM.basePos(M, team, 1); return [(x + x1) / 2 + (slot ? 44 : -44), (y + y1) / 2 + (slot ? 10 : -10)]; }; // side by side, facing the camera
    R.mDolls = [[0, 0, ...at(0, 0), -Math.PI / 2 + 0.45, 'wave'], [0, 1, ...at(0, 1), -Math.PI / 2 - 0.35, 'hop'],
      [1, 0, ...at(1, 0), -Math.PI / 2, 'idle'], [1, 1, ...at(1, 1), -Math.PI / 2 + 0.6, 'hop'],
      [2, 1, h - 150, h + 40, 0.15, 'fight'], [3, 0, h + 110, h - 20, Math.PI + 0.15, 'fight']].map(([team, slot, x, y, yaw, act], i) => {
      const v = rig(team, slot); v.root.position.set(x, 0, y); v.turn.rotation.y = v.yaw = yaw; v.act = act; v.ph = i * 1.7; v.turn.scale.setScalar(DS);
      return v;
    });
    // the camera's path: keys of target (sim x, height, sim y) and (distance, tilt, turn)
    const P = (x, y, z) => new T.Vector3(x, y, z), d0 = R.mDolls[0].root.position, d1 = R.mDolls[1].root.position;
    const start = P((d0.x + d1.x) / 2, 52, (d0.z + d1.z) / 2), keys = [[0, start, P(470, 0.44, -0.42)], [11, start, P(560, 0.52, 0.08)]];
    const mods = new Map(); for (const g of M.ground) if (g.route === 0 && g.mod > 0 && g.mod < 10) { const m = mods.get(g.mod) || [0, 0, 0]; m[0] += g.x + g.w / 2; m[1] += g.y + g.h / 2; m[2]++; mods.set(g.mod, m); }
    let t = 14;
    for (const k of [...mods.keys()].sort((a, b) => a - b)) { const m = mods.get(k); keys.push([t, P(m[0] / m[2], 20, m[1] / m[2]), P(950, 0.8, 0.3 * Math.sin(k * 1.3))]); t += 3.2; }
    keys.push([t, P(M.ringCp[0][0], 20, M.ringCp[0][1]), P(1000, 0.72, 0.15)]); t += 4;
    keys.push([t, P(h, 40, h), P(2000, 0.86, 0)]); t += 16;
    keys.push([t, P(h, 40, h), P(1750, 0.8, 0.85)]);
    R.mKeys = keys.map((k) => k[0]); R.mEnd = t + 1.2;
    R.mTgt = new T.CatmullRomCurve3(keys.map((k) => k[1])); R.mDps = new T.CatmullRomCurve3(keys.map((k) => k[2]));
    R.mS = { p: new Map() };
  }
  function menuDolls(dt, now) {
    for (const v of R.mDolls) {
      const t = now + v.ph; blink(v, dt);
      let y = 0, sy = 1 + Math.sin(t * 2.4) * 0.025;
      v.body.position.y = Math.abs(Math.sin(t * 2)) * 1.5; v.gunG.rotation.set(0, 0, 0); v.gunG.position.set(10, 27, 12);
      if (v.act === 'wave') { v.gunG.position.set(4, 44, 16); v.gunG.rotation.set(Math.sin(t * 7) * 0.55, 0, 1.1); v.body.rotation.z = Math.sin(t * 3.5) * 0.05; }
      else if (v.act === 'hop' || v.act === 'fight') {
        const ph = t % (v.act === 'hop' ? 3.4 : 2.2), H = v.act === 'hop' ? 46 : 22;
        if (ph < 0.5) { const k = ph / 0.5; y = Math.sin(k * Math.PI) * H; sy = 1 + Math.sin(k * Math.PI) * 0.12 - (k > 0.85 ? (k - 0.85) * 1.2 : 0); }
        else if (ph < 0.62) sy = 0.84;
        if (v.act === 'fight') { v.turn.rotation.y = v.yaw + Math.sin(t * 0.9) * 0.35; if (Math.abs(ph - 1.3) < dt) { const a = -v.turn.rotation.y; puff(v.root.position.x + Math.cos(a) * 45 * DS, 40, v.root.position.z + Math.sin(a) * 45 * DS, 0xfff1c0, 4, 70); } }
        else v.turn.rotation.y = v.yaw + Math.sin(t * 0.5) * 0.25;
      } else v.turn.rotation.y = v.yaw + Math.sin(t * 0.4) * 0.4;
      const sxz = 1 + (1 - sy) * 0.6; v.turn.scale.set(sxz * DS, sy * DS, sxz * DS); v.turn.position.y = y;
      const k = Math.max(0.4, 1 - y / 200); v.sh.scale.set(k, k, k);
    }
  }
  function menuCam(t) {
    const n = R.mKeys.length, ks = R.mKeys; let i = 0; while (i < n - 2 && t >= ks[i + 1]) i++;
    let u = clamp((t - ks[i]) / (ks[i + 1] - ks[i]), 0, 1);
    if (i === 0) u = u * u * (3 - 2 * u); else if (i === 1) u = u * u; else if (i === n - 3) u = 1 - (1 - u) * (1 - u); else if (i === n - 2) u = u * u * (3 - 2 * u);
    const s = (i + u) / (n - 1), tg = R.mTgt.getPoint(s, V2), dp = R.mDps.getPoint(s, V3);
    const W = R.w, Hh = R.h, port = Hh > W, d = dp.x * (port ? 1.9 : 1), p = dp.y, yw = dp.z + Math.sin(t * 0.13) * 0.06, cam = R.cam;
    cam.position.set(tg.x + Math.sin(yw) * Math.cos(p) * d, tg.y + Math.sin(p) * d, tg.z + Math.cos(yw) * Math.cos(p) * d); cam.lookAt(tg);
    cam.near = Math.max(10, d * 0.15); cam.far = d * 3 + DEEP * 4 + 6000;
    // the card covers the left of a landscape screen and the bottom half of a portrait one
    cam.setViewOffset(W, Hh, port ? 0 : -0.17 * W, port ? 0.27 * Hh : -0.04 * Hh, W, Hh);
    R.scene.fog.near = d * 1.05; R.scene.fog.far = d * 2.8 + 1200; R.camF = 0; R.lookZ = tg.z;
    shadowFollow(tg.x, Math.min(tg.y, 0), tg.z, d * 1.1);
  }
  function menuFrame(mn) {
    const now = performance.now() / 1000, dt = Math.min(0.05, mn.last ? now - mn.last : 1 / 60); mn.last = now;
    let t = now - mn.t0; if (t > R.mEnd) { mn.t0 = now; t = 0; }
    size();
    const Wm = R.mW; Wm.on.clear(); if (t % 9 > 4) for (const id of Wm.gates) Wm.on.add(id); // gates open and bridges drop now and then
    WD.on = Wm.on; WD.bt = Wm.bt; WD.sl = Wm.sl;
    devices(dt, now, t + 20); tiles(dt, t + 20); chests(dt, R.mS); marble(dt, now, t + 20); menuDolls(dt, now); fx(dt);
    menuCam(t);
    R.fade.style.opacity = Math.max(0, 1 - t / 1.2, 1 - (R.mEnd - t) / 1.2).toFixed(2);
    R.ren.render(R.scene, R.cam);
  }

  R.frame = function (dt, now, drawT, S, rt) {
    if (!R.world || !S) return;
    size(); quality(dt);
    for (const v of R.views.values()) if (v.seen !== R.frameNo && v.root.visible) v.root.visible = false;
    WD.on = G.W.on; WD.bt = G.bt; WD.sl = G.sl;
    devices(dt, now, drawT); tiles(dt, drawT); chests(dt, S); items(now, dt); marble(dt, now, drawT); shots(rt); fx(dt);
    camera(dt);
    R.ren.render(R.scene, R.cam);
    overlay(dt);
    R.frameNo++;
  };
})();
