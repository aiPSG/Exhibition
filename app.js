/* =========================================================================
   Exhibition — app

   One pool of tiles serves BOTH views:
     • Infinite canvas — a camera is simulated in JS and flies through an
       infinitely-tiled 3D field. Motion + vanishing use the exact constants
       from edoardolunardi/infinite-canvas (velocity lerp/decay/clamp, wheel
       accumulation, depth fade 140→260 squared, fov 60, sizes 12–20). No blur,
       like the reference — depth reads through fade + perspective alone.
       Tiles are z-index sorted by depth every frame so nearer works occlude
       farther ones correctly.
     • Grid — the same tiles animate (morph) into a sortable grid instead of a
       hard switch.
   Clicking a work flies the camera to centre on it and dollies in until the
   image fits the frame (contain), fading the rest of the field away.
   ========================================================================= */
(function () {
  'use strict';

  const DATA = window.EXHIBITION_DATA || [];

  const els = {
    body:        document.body,
    canvas:      document.getElementById('canvas'),
    scene:       document.getElementById('scene'),
    hint:        document.getElementById('canvasHint'),
    sortbar:     document.getElementById('sortbar'),
    sortGroup:   document.getElementById('sortGroup'),
    dirBtn:      document.getElementById('dirBtn'),
    workCount:   document.getElementById('workCount'),
    focusview:   document.getElementById('focusview'),
    focusImg:    document.getElementById('focusImg'),
    focusbar:    document.getElementById('focusbar'),
    focusSwatch: document.getElementById('focusSwatch'),
    focusTitle:  document.getElementById('focusTitle'),
    focusFacts:  document.getElementById('focusFacts'),
    focusClose:  document.getElementById('focusClose'),
    loader:      document.getElementById('loader'),
    loaderBar:   document.getElementById('loaderBar'),
    loaderPct:   document.getElementById('loaderPct'),
    settings:      document.getElementById('settings'),
    settingsToggle:document.getElementById('settingsToggle'),
    settingsPanel: document.getElementById('settingsPanel'),
    durRange:      document.getElementById('durRange'),
    durInput:      document.getElementById('durInput'),
    easeSelect:    document.getElementById('easeSelect')
  };

  els.workCount.textContent = String(DATA.length).padStart(2, '0') + ' works';

  // Throttled image loader with retries. Firing ~200 requests at once makes a
  // remote host (picsum) drop some, leaving black/fallback tiles — so we cap
  // concurrency and retry transient failures. References aren't retained, so
  // this only warms the HTTP cache (no decoded-bitmap RAM build-up).
  const ImageQueue = (function () {
    const queue = [];
    let active = 0;
    const MAX = 8;
    function startOne(item) {
      active++;
      const img = new Image();
      img.decoding = 'async';
      const done = ok => {
        active--; img.onload = img.onerror = null;
        if (ok) { if (item.cb) item.cb(true, item.src); }
        else if (item.attempts < 2) { item.attempts++; queue.push(item); }   // retry later
        else if (item.cb) item.cb(false, item.src);
        pump();
      };
      img.onload = () => done(true);
      img.onerror = () => setTimeout(() => done(false), 300 * (item.attempts + 1));
      img.src = item.src;
    }
    function pump() { while (active < MAX && queue.length) startOne(queue.shift()); }
    function enqueue(src, cb, front) {
      const item = { src, cb, attempts: 0 };
      if (front) queue.unshift(item); else queue.push(item);
      pump();
    }
    return { enqueue };
  })();

  // Load a field/grid image (via the queue) then fade it into its <img>. If it
  // ultimately fails, keep re-trying with backoff so blanks self-heal instead of
  // staying lost (the loading bar only counts the first settle).
  function loadImg(imgEl, src, tries) {
    tries = tries || 0;
    ImageQueue.enqueue(src, ok => {
      if (ok) { imgEl.src = src; requestAnimationFrame(() => imgEl.classList.add('is-loaded')); }
      else if (tries < 6) { setTimeout(() => loadImg(imgEl, src, tries + 1), 1500 * (tries + 1)); }
      if (tries === 0) bumpProgress();       // count each image once, on first settle
    });
  }

  // Loading-bar progress across every image (low-res field + hi-res focus).
  let imgTotal = DATA.length * 2, imgDone = 0, revealed = false;
  function bumpProgress() {
    imgDone++;
    const pct = Math.min(100, Math.round((imgDone / imgTotal) * 100));
    els.loaderBar.style.width = pct + '%';
    els.loaderPct.textContent = pct + '%';
    if (imgDone >= imgTotal && !revealed) {
      revealed = true;
      setTimeout(() => els.loader.classList.add('is-done'), 300);
    }
  }

  const lerp  = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const wrap  = (v, s) => ((v % s) + s) % s;
  const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  /* ====================================================== THE UNIFIED FIELD */
  const Field = (function () {
    /* ---- constants copied from the reference repo --------------------- */
    const VELOCITY_LERP  = 0.16;
    const VELOCITY_DECAY = 0.9;
    const MAX_VELOCITY   = 3.2;
    const WHEEL_MULT     = 0.006;
    const SCROLL_DECAY   = 0.8;
    const DRAG_MULT      = 0.025;
    const TOUCH_MULT     = 0.02;
    const PINCH_MULT     = 0.006;
    const FADE_START     = 140;
    const FADE_END       = 260;
    const OPACITY_LERP   = 0.18;
    const SIZE_MIN       = 12;
    const SIZE_SPAN      = 8;     // size = 12 + r*8  →  12..20
    const FOV_DEG        = 60;

    /* ---- our framing of that world ------------------------------------ */
    const PZ   = 360;   // depth tiling period (> FADE_END so the z-wrap is unseen)
    const BASE = 220;   // tile DOM height in px (scaled per frame)
    const FIT  = 0.9;   // focus: image fills 90% of the limiting axis

    let tiles = [];
    const cam = { x: 0, y: 0, z: 0 };
    const vel = { x: 0, y: 0, z: 0 };
    const tvel = { x: 0, y: 0, z: 0 };
    let scrollAccum = 0;

    let focal = 0, cx = 0, cy = 0, period = 360;

    // view morph: 0 = canvas, 1 = grid. The canvas→grid transition is staged
    // per axis (X, then Y, then Z/scale) and is a time-based tween whose
    // duration + easing are editable from the settings UI.
    let morphTarget = 0;                 // 0 canvas, 1 grid (discrete target)
    let morphing = false, morphT0 = 0;   // tween running? + start timestamp
    let ax = 0, ay = 0, az = 0;          // per-axis progress (0 canvas → 1 grid)
    let axS = 0, ayS = 0, azS = 0;       // per-axis start values for this tween

    const cfg = { duration: 1400, easing: 'easeInOutCubic' };
    const EASINGS = {
      linear:         t => t,
      easeInQuad:     t => t * t,
      easeOutQuad:    t => 1 - (1 - t) * (1 - t),
      easeInOutQuad:  t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
      easeInCubic:    t => t * t * t,
      easeOutCubic:   t => 1 - Math.pow(1 - t, 3),
      easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
      easeOutBack:    t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
      easeInOutBack:  t => { const c2 = 1.70158 * 1.525; return t < 0.5 ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2 : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2; }
    };

    // focus. Canvas view: a real camera dolly (centre + fly toward the work)
    // with a crisp full-size <img> overlay tracking the focused tile so it
    // stays sharp. Grid view: a screen-space overlay dolly (unchanged).
    let focusActive = false, focusReturning = false, focusTile = null, focusAmt = 0;
    let focusMode = 'canvas';
    let focusReady = false;        // hi-res decoded? (gates the overlay → no flash)
    let flight = false;            // canvas focus: suspend wrapping so the camera
                                   // can fly straight at the work without it jumping
    const fstart = { sx: 0, sy: 0, scale: 1, restH: 1 };
    const camTarget = { x: 0, y: 0, z: 0 };
    const preCam = { x: 0, y: 0, z: 0 };
    // focus flight tween (time-based, honours cfg.duration + cfg.easing)
    const camStart = { x: 0, y: 0, z: 0 };
    let focusT0 = 0, focusDur = 1400, focusEase = 'easeInOutCubic', focusFrom = 0, focusTo = 0;

    // grid layout
    let cols = 4, cell = 200, stride = 222, gridLeft = 0, gridTop = 96;
    let gridScrollY = 0, gridScrollTarget = 0, gridMaxScroll = 0;

    // sorting (re-sort reflow is a time-based tween honouring cfg.duration/easing)
    let sortKey = 'name', sortDir = 1;
    const orderPos = new Array(DATA.length).fill(0);
    let sorting = false, sortT0 = 0, sortP = 1, sortEased = 1;

    let dragging = false, isTouch = false, moved = 0, multi = false;
    let lastX = 0, lastY = 0;
    const pointers = new Map();
    let pinchDist = 0;

    function rng(seed) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    const COMPARATORS = {
      name:     (a, b) => a.title.localeCompare(b.title),
      color:    (a, b) => a.hue - b.hue || a.title.localeCompare(b.title),
      category: (a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title),
      mood:     (a, b) => a.mood.localeCompare(b.mood) || a.title.localeCompare(b.title),
      client:   (a, b) => a.client.localeCompare(b.client) || a.title.localeCompare(b.title)
    };
    function subFor(work) {
      switch (sortKey) {
        case 'color':    return work.colorName;
        case 'category': return work.category;
        case 'mood':     return work.mood;
        case 'client':   return work.client;
        default:         return work.category + ' · ' + work.year;
      }
    }
    function factsLine(work) {
      return `${work.category} · ${work.mood} · ${work.client} · ${work.colorName} · ${work.year}`;
    }

    /* ---- build ---------------------------------------------------------- */
    function metrics() {
      const vw = window.innerWidth, vh = window.innerHeight;
      focal = (vh / 2) / Math.tan((FOV_DEG / 2) * Math.PI / 180);
      cx = vw / 2; cy = vh / 2;

      const halfW = (150 * (vw / 2)) / focal;
      period = Math.max(300, halfW * 2.6);

      const small = vw < 700;
      const pad = small ? 16 : 30;
      const gap = small ? 14 : 22;
      cell = small ? 150 : 210;
      cols = Math.max(2, Math.floor((vw - 2 * pad + gap) / (cell + gap)));
      stride = cell + gap;
      const contentW = cols * stride - gap;
      gridLeft = (vw - contentW) / 2;
      gridTop = 104;
      const rows = Math.ceil(DATA.length / cols);
      const contentH = rows * stride - gap;
      gridMaxScroll = Math.max(0, gridTop + contentH + 110 - vh);
    }

    function build() {
      metrics();
      els.scene.innerHTML = '';
      tiles = [];
      const rand = rng(424242);
      const frag = document.createDocumentFragment();

      DATA.forEach((work, idx) => {
        const el = document.createElement('div');
        el.className = 'tile';
        el.style.height = BASE + 'px';
        el.style.width = (BASE * work.aspect) + 'px';
        el.style.setProperty('--c', work.color);

        const img = document.createElement('img');
        img.alt = work.title;
        img.draggable = false;
        el.appendChild(img);

        const label = document.createElement('div');
        label.className = 'tile__label';
        label.innerHTML =
          `<div><div class="tile__title">${work.title}</div>` +
          `<div class="tile__sub" data-sub>${subFor(work)}</div></div>` +
          `<span class="tile__swatch" style="background:${work.color}"></span>`;
        el.appendChild(label);

        const t = {
          el, img, work, idx, label: label.querySelector('[data-sub]'),
          wx: rand() * period, wy: rand() * period, wz: rand() * PZ,
          size: SIZE_MIN + rand() * SIZE_SPAN,
          op: 0, gx: 0, gy: 0, lpx: 0, lpy: 0, ls: 0, fx: 0, fy: 0, fz: 0,
          g0x: 0, g0y: 0,
          lastOp: -1, lastZ: 0, lastPE: '', loaded: false
        };
        // NB: clicks are handled in onUp (pointer capture swallows the
        // element's own click event), so no per-tile click listener here.

        frag.appendChild(el);
        tiles.push(t);
      });

      els.scene.appendChild(frag);
      computeOrder();
      tiles.forEach(t => { const c = cellOf(orderPos[t.idx]); t.g0x = c.x; t.g0y = c.y;
                           const g = gridTargetFor(t); t.gx = g.x; t.gy = g.y; });
      // eager-load every low-res image so the field is fully populated
      tiles.forEach(t => { t.loaded = true; loadImg(t.img, t.work.img); });
    }

    function computeOrder() {
      const sorted = DATA.map((_, i) => i)
        .sort((a, b) => COMPARATORS[sortKey](DATA[a], DATA[b]) * sortDir);
      sorted.forEach((workIdx, pos) => { orderPos[workIdx] = pos; });
    }
    function cellOf(pos) {                    // content-space (scroll applied later)
      const r = Math.floor(pos / cols), c = pos % cols;
      return { x: gridLeft + c * stride + cell / 2, y: gridTop + r * stride + cell / 2 };
    }
    // Re-sort tween: interpolate from where the tile actually is at sort start
    // (t.g0*, so interrupts don't jump) to its new cell, then apply live scroll.
    function gridTargetFor(t) {
      const b = cellOf(orderPos[t.idx]);
      return {
        x: lerp(t.g0x, b.x, sortEased),
        y: lerp(t.g0y, b.y, sortEased) - gridScrollY
      };
    }

    /* ---- focus --------------------------------------------------------- */
    function focusOn(t) {
      if (focusActive) return;
      focusActive = true; focusReturning = false; focusTile = t;
      focusMode = morphTarget === 1 ? 'grid' : 'canvas';
      vel.x = vel.y = vel.z = tvel.x = tvel.y = tvel.z = scrollAccum = 0;

      const vw = 2 * cx, vh = 2 * cy;
      fstart.restH = Math.min(0.9 * vh, (0.9 * vw) / t.work.aspect);   // full-screen fit
      // grid: overlay dolls from the tile's current rect to the fit
      fstart.sx = t.lpx; fstart.sy = t.lpy;
      fstart.scale = fstart.restH > 0 ? (BASE * t.ls) / fstart.restH : 0.2;

      if (focusMode === 'canvas') {
        // Freeze each tile's *unwrapped* world position (its currently-visible
        // copy) so the camera can fly anywhere without the toroidal tiling
        // jumping. Projection is identical at this instant, then continuous.
        for (let k = 0; k < tiles.length; k++) {
          const tk = tiles[k];
          tk.fx = cam.x + (wrap(tk.wx - cam.x + period / 2, period) - period / 2);
          tk.fy = cam.y + (wrap(tk.wy - cam.y + period / 2, period) - period / 2);
          tk.fz = cam.z - (wrap((cam.z - tk.wz) + 40, PZ) - 40);
        }
        flight = true;
        preCam.x = cam.x; preCam.y = cam.y; preCam.z = cam.z;
        camStart.x = cam.x; camStart.y = cam.y; camStart.z = cam.z;
        // Fly straight at the work: centre it (cam.xy → its xy) and dolly until
        // it fills the frame (depth → depthFit).
        const depthFit = (t.size * focal) / fstart.restH;
        camTarget.x = t.fx;
        camTarget.y = t.fy;
        camTarget.z = t.fz + depthFit;
      }

      // time-based flight tween (honours the settings)
      focusFrom = focusAmt; focusTo = 1;
      focusT0 = performance.now();
      focusDur = cfg.duration; focusEase = cfg.easing;

      // Only reveal the overlay once the hi-res has actually decoded, so there's
      // no empty/stale flash during the low→hi handoff.
      focusReady = false;
      els.focusImg.alt = t.work.title;
      els.focusImg.src = t.work.imgHi || t.work.img;     // pre-loaded → from cache
      if (els.focusImg.decode) {
        els.focusImg.decode().then(() => { focusReady = true; }, () => { focusReady = true; });
      } else {
        els.focusImg.onload = () => { focusReady = true; };
        if (els.focusImg.complete) focusReady = true;
      }

      els.body.classList.add('mode-focus');
      els.hint.classList.add('is-hidden');
      els.focusSwatch.style.background = t.work.color;
      els.focusTitle.textContent = t.work.title;
      els.focusFacts.textContent = factsLine(t.work);
      els.focusbar.classList.add('is-on');
    }
    function exitFocus() {
      if (!focusActive || focusReturning) return;
      focusReturning = true;                 // canvas: fly camera back; grid: fade out
      // time-based return tween (honours the settings), from wherever we are now
      camStart.x = cam.x; camStart.y = cam.y; camStart.z = cam.z;
      focusFrom = focusAmt; focusTo = 0;
      focusT0 = performance.now();
      focusDur = cfg.duration; focusEase = cfg.easing;
      els.body.classList.remove('mode-focus');
      els.focusbar.classList.remove('is-on');
    }
    function toggleFocus(t) { if (focusActive) exitFocus(); else focusOn(t); }

    /* ---- per-frame ------------------------------------------------------ */
    function simCamera() {
      tvel.z += scrollAccum;
      tvel.x = clamp(tvel.x, -MAX_VELOCITY, MAX_VELOCITY);
      tvel.y = clamp(tvel.y, -MAX_VELOCITY, MAX_VELOCITY);
      tvel.z = clamp(tvel.z, -MAX_VELOCITY, MAX_VELOCITY);
      vel.x = lerp(vel.x, tvel.x, VELOCITY_LERP);
      vel.y = lerp(vel.y, tvel.y, VELOCITY_LERP);
      vel.z = lerp(vel.z, tvel.z, VELOCITY_LERP);
      cam.x += vel.x; cam.y += vel.y; cam.z += vel.z;
      tvel.x *= VELOCITY_DECAY; tvel.y *= VELOCITY_DECAY; tvel.z *= VELOCITY_DECAY;
      scrollAccum *= SCROLL_DECAY;
    }

    function frame() {
      // Staged canvas↔grid tween: X first, then Y, then Z (scale). Time-based
      // with editable duration + easing. Reverse order (Z,Y,X) when returning.
      if (morphing) {
        const t = clamp((performance.now() - morphT0) / cfg.duration, 0, 1);
        const e = EASINGS[cfg.easing] || EASINGS.easeInOutCubic;
        const step = k => e(clamp((t - k / 3) * 3, 0, 1));   // 3 sequential thirds
        if (morphTarget === 1) {                 // canvas → grid: X, then Y, then Z
          ax = lerp(axS, 1, step(0));
          ay = lerp(ayS, 1, step(1));
          az = lerp(azS, 1, step(2));
        } else {                                 // grid → canvas: Z, then Y, then X
          az = lerp(azS, 0, step(0));
          ay = lerp(ayS, 0, step(1));
          ax = lerp(axS, 0, step(2));
        }
        if (t >= 1) { morphing = false; ax = ay = az = morphTarget; }
      }

      // re-sort reflow tween (time-based, cfg-driven)
      if (sorting) {
        sortP = clamp((performance.now() - sortT0) / cfg.duration, 0, 1);
        if (sortP >= 1) { sorting = false; sortP = 1; tiles.forEach(t => { const c = cellOf(orderPos[t.idx]); t.g0x = c.x; t.g0y = c.y; }); }
      }
      sortEased = (EASINGS[cfg.easing] || easeInOut)(sortP);

      // focus flight (time-based, cfg-driven). Camera flies to (or back from)
      // the work over cfg.duration with cfg.easing; otherwise normal momentum.
      if (focusActive || focusReturning) {
        const prog = clamp((performance.now() - focusT0) / focusDur, 0, 1);
        const f = (EASINGS[focusEase] || easeInOut)(prog);
        focusAmt = lerp(focusFrom, focusTo, f);
        if (focusMode === 'canvas') {
          const tgt = focusReturning ? preCam : camTarget;
          cam.x = lerp(camStart.x, tgt.x, f);
          cam.y = lerp(camStart.y, tgt.y, f);
          cam.z = lerp(camStart.z, tgt.z, f);
        }
        if (prog >= 1) {
          focusAmt = focusTo;
          if (focusReturning) { focusActive = false; focusReturning = false; focusTile = null; flight = false; }
        }
      } else if (!morphing && morphTarget === 0) {
        simCamera();
      }

      // overlay crossfade — held at 0 until the hi-res is decoded (no flash);
      // canvas ramps in fast then tracks the centring tile, grid follows the dolly.
      const overlayOp = !focusReady ? 0
                      : focusMode === 'canvas' ? Math.min(1, focusAmt * 6)
                      : focusAmt;

      gridScrollY += (gridScrollTarget - gridScrollY) * 0.16;

      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];

        const g = gridTargetFor(t);   // already tweened + scroll-adjusted
        t.gx = g.x; t.gy = g.y;
        const gScale = 0.8 * Math.min(cell / BASE, cell / (BASE * t.work.aspect));  // 20% smaller in grid

        // During a canvas flight, wrapping is suspended: tiles use their frozen
        // unwrapped positions so the camera can fly straight at the work.
        let relX, relY, depth;
        if (flight) {
          relX = t.fx - cam.x;
          relY = t.fy - cam.y;
          depth = cam.z - t.fz;
        } else {
          relX = wrap(t.wx - cam.x + period / 2, period) - period / 2;
          relY = wrap(t.wy - cam.y + period / 2, period) - period / 2;
          depth = wrap((cam.z - t.wz) + 40, PZ) - 40;     // [-40, 320]
        }
        const dd = Math.max(depth, 4);
        const pScale = focal / dd;
        const csx = cx + relX * pScale;
        const csy = cy - relY * pScale;
        const cDom = (t.size * pScale) / BASE;

        let target = depth <= FADE_START ? 1
                   : Math.max(0, 1 - (depth - FADE_START) / (FADE_END - FADE_START));
        target = target * target;
        if (depth <= 2) target = 0;
        t.op += (target - t.op) * OPACITY_LERP;

        // staged blend: X, Y and scale(Z) each on their own progress
        const px = lerp(csx, t.gx, ax);
        const py = lerp(csy, t.gy, ay);
        const s  = lerp(cDom, gScale, az);
        let op = lerp(t.op, 1, Math.max(ax, ay, az));

        // No image should come "from in front of the screen" (negative z) when
        // moving to the grid. Tiles that start larger than the screen plane
        // (cDom > 1) stay hidden through the X/Y slide and only fade in as they
        // shrink to grid scale (the Z phase) — so nothing looms in from the front.
        if (morphTarget === 1 && cDom > 1) op *= az;

        // remember the on-screen rect so the overlay can track / dolly from here
        t.lpx = px; t.lpy = py; t.ls = s;

        // focus: field flies past + fades; the clicked tile gives way to the
        // crisp overlay that tracks it
        if (focusAmt > 0.001) {
          if (t === focusTile) op *= (1 - overlayOp);
          else op *= (1 - focusAmt);
        }

        t.el.style.transform =
          `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%) scale(${s.toFixed(4)})`;

        const oq = Math.round(op * 100) / 100;
        if (oq !== t.lastOp) { t.el.style.opacity = oq; t.lastOp = oq; }

        // Stacking. Canvas: by depth (nearer on top). Grid: flat, but a tile
        // in motion rides above settled ones (z grows with distance-to-cell) so
        // a re-sorting tile never ducks behind its neighbours and vanishes.
        let zi;
        if (morphTarget === 1) {
          const tc = cellOf(orderPos[t.idx]);
          const dist = Math.abs(t.gx - tc.x) + Math.abs(t.gy - (tc.y - gridScrollY));
          zi = 200000 + Math.round(dist);
        } else {
          zi = Math.round(100000 - depth * 10);
        }
        if (zi !== t.lastZ) { t.el.style.zIndex = zi; t.lastZ = zi; }

        // don't let invisible tiles intercept clicks
        const pe = oq < 0.04 ? 'none' : 'auto';
        if (pe !== t.lastPE) { t.el.style.pointerEvents = pe; t.lastPE = pe; }
      }

      // Crisp full-size overlay. Canvas: track the focused tile as the camera
      // flies it to centre + full screen (scale ≤ 1 ⇒ only downscaled ⇒ sharp).
      // Grid: a snapshot dolly from the tile's rect to the centred fit.
      if (focusAmt > 0.0005 && focusTile) {
        let tx, ty, sc;
        if (focusMode === 'canvas') {
          sc = Math.min(1, (BASE * focusTile.ls) / fstart.restH);
          tx = focusTile.lpx - cx;
          ty = focusTile.lpy - cy;
        } else {
          const fa = easeInOut(focusAmt);
          tx = (fstart.sx - cx) * (1 - fa);
          ty = (fstart.sy - cy) * (1 - fa);
          sc = 1 - (1 - fa) * (1 - fstart.scale);
        }
        els.focusImg.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${sc.toFixed(4)})`;
        els.focusview.style.opacity = overlayOp;
      } else if (els.focusview.style.opacity !== '0') {
        els.focusview.style.opacity = '0';
      }

      requestAnimationFrame(frame);
    }

    /* ---- input ---------------------------------------------------------- */
    function onDown(e) {
      els.canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) { moved = 0; multi = false; }
      dragging = true;
      isTouch = e.pointerType === 'touch';
      lastX = e.clientX; lastY = e.clientY;
      tvel.x = tvel.y = tvel.z = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        multi = true;
      }
      els.canvas.classList.add('is-dragging');
      hideHint();
    }
    function onMove(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2 && !focusActive) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist) scrollAccum += (pinchDist - d) * PINCH_MULT;
        pinchDist = d;
        return;
      }
      if (!dragging) return;

      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);

      if (focusActive) return;                 // no panning while focused
      if (morphTarget === 1) {
        gridScrollTarget = clamp(gridScrollTarget - dy, 0, gridMaxScroll);
        return;
      }
      const k = isTouch ? TOUCH_MULT : DRAG_MULT;
      tvel.x -= dx * k;
      tvel.y += dy * k;
    }
    function onUp(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      try { els.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      if (pointers.size === 0) {
        dragging = false;
        els.canvas.classList.remove('is-dragging');
        // a tap (not a drag, not part of a pinch) selects / deselects a work
        if (!multi && moved < 9) handleTap(e.clientX, e.clientY);
      }
    }

    function handleTap(x, y) {
      if (focusActive) { exitFocus(); return; }
      const el = document.elementFromPoint(x, y);
      const tileEl = el && el.closest ? el.closest('.tile') : null;
      if (!tileEl) return;
      const t = tiles.find(tt => tt.el === tileEl);
      if (t) focusOn(t);
    }
    function onWheel(e) {
      e.preventDefault();
      if (focusActive) return;
      if (morphTarget === 1) gridScrollTarget = clamp(gridScrollTarget + e.deltaY, 0, gridMaxScroll);
      else scrollAccum += e.deltaY * WHEEL_MULT;
      hideHint();
    }

    let hintTimer = null;
    function hideHint() { els.hint.classList.add('is-hidden'); }

    /* ---- public --------------------------------------------------------- */
    function setView(view) {
      const next = view === 'grid' ? 1 : 0;
      if (next === morphTarget && !morphing) return;
      if (focusActive) exitFocus();
      morphTarget = next;
      // start the staged tween from wherever the axes currently are
      axS = ax; ayS = ay; azS = az;
      morphT0 = performance.now();
      morphing = true;
      if (view === 'grid') { gridScrollTarget = gridScrollY = 0; }
      els.body.classList.toggle('mode-grid', view === 'grid');
      els.sortbar.setAttribute('aria-hidden', String(view !== 'grid'));
      if (view === 'grid') { clearTimeout(hintTimer); hideHint(); }
      else { els.hint.classList.remove('is-hidden'); clearTimeout(hintTimer); hintTimer = setTimeout(hideHint, 4600); }
    }
    function setDuration(ms) { cfg.duration = clamp(ms, 100, 8000); }
    function setEasing(name) { if (EASINGS[name]) cfg.easing = name; }
    function startSortTween() {
      // start from where each tile actually is right now (content-space), so an
      // interrupted sort keeps moving smoothly instead of snapping.
      tiles.forEach(t => { t.g0x = t.gx; t.g0y = t.gy + gridScrollY; });
      computeOrder();                                          // compute new targets
      sortP = 0; sortT0 = performance.now(); sorting = true;
      tiles.forEach(t => { t.label.textContent = subFor(t.work); });
    }
    function setSort(key) {
      if (key === sortKey) return;
      sortKey = key; startSortTween();
    }
    function toggleDir() {
      sortDir *= -1; startSortTween();
    }

    function init() {
      build();
      els.canvas.addEventListener('pointerdown', onDown);
      els.canvas.addEventListener('pointermove', onMove);
      els.canvas.addEventListener('pointerup', onUp);
      els.canvas.addEventListener('pointercancel', onUp);
      els.canvas.addEventListener('wheel', onWheel, { passive: false });

      let rt = null;
      window.addEventListener('resize', () => {
        clearTimeout(rt);
        rt = setTimeout(() => {
          metrics();
          tiles.forEach(t => {
            t.el.style.width = (BASE * t.work.aspect) + 'px';
            const c = cellOf(orderPos[t.idx]); t.g0x = c.x; t.g0y = c.y;
            const g = gridTargetFor(t); t.gx = g.x; t.gy = g.y;
          });
        }, 180);
      });

      els.hint.classList.remove('is-hidden');
      hintTimer = setTimeout(hideHint, 4600);
      requestAnimationFrame(frame);
    }

    return { init, setView, setSort, toggleDir, exitFocus, setDuration, setEasing };
  })();

  /* ============================================================ UI WIRING */
  document.querySelectorAll('.modeswitch__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      document.querySelectorAll('.modeswitch__btn').forEach(b => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
      Field.setView(mode);
    });
  });

  els.sortGroup.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    els.sortGroup.querySelectorAll('.chip').forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    Field.setSort(chip.dataset.sort);
  });
  els.dirBtn.addEventListener('click', () => {
    els.dirBtn.classList.toggle('is-desc');
    Field.toggleDir();
  });

  els.focusClose.addEventListener('click', () => Field.exitFocus());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') Field.exitFocus(); });

  /* ---- settings: transition duration + easing ---- */
  els.settingsToggle.addEventListener('click', () => {
    const open = els.settingsPanel.hidden;
    els.settingsPanel.hidden = !open;
    els.settings.classList.toggle('is-open', open);
    els.settingsToggle.setAttribute('aria-expanded', String(open));
  });
  function applyDuration(v) {
    const ms = Math.max(100, Math.min(8000, Math.round(v) || 0));
    els.durRange.value = Math.max(200, Math.min(4000, ms));
    els.durInput.value = ms;
    Field.setDuration(ms);
  }
  els.durRange.addEventListener('input', () => applyDuration(+els.durRange.value));
  els.durInput.addEventListener('input', () => applyDuration(+els.durInput.value));
  els.easeSelect.addEventListener('change', () => Field.setEasing(els.easeSelect.value));

  /* =================================================================== BOOT */
  Field.init();                          // builds the field (enqueues low-res first)

  // Then preload every full-resolution image through the same throttled+retrying
  // queue. References aren't retained → warms the cache, no decoded-RAM build-up.
  DATA.forEach(w => ImageQueue.enqueue(w.imgHi, bumpProgress));
})();
