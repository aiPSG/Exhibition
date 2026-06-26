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
    focusbar:    document.getElementById('focusbar'),
    focusSwatch: document.getElementById('focusSwatch'),
    focusTitle:  document.getElementById('focusTitle'),
    focusFacts:  document.getElementById('focusFacts'),
    focusClose:  document.getElementById('focusClose')
  };

  els.workCount.textContent = String(DATA.length).padStart(2, '0') + ' works';

  function loadImg(imgEl, src) {
    const probe = new Image();
    probe.onload = () => { imgEl.src = src; requestAnimationFrame(() => imgEl.classList.add('is-loaded')); };
    probe.onerror = () => {};
    probe.src = src;
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

    // view morph: 0 = canvas, 1 = grid
    let morph = 0, morphTarget = 0;

    // focus: a screen-space dolly to full screen that works from either view
    // (the clicked tile scales up to centre, the rest fade in place)
    let focusActive = false, focusTile = null, focusAmt = 0;

    // grid layout
    let cols = 4, cell = 200, stride = 222, gridLeft = 0, gridTop = 96;
    let gridScrollY = 0, gridScrollTarget = 0, gridMaxScroll = 0;

    // sorting
    let sortKey = 'name', sortDir = 1;
    const orderPos = new Array(DATA.length).fill(0);

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
          op: 0, gx: 0, gy: 0, lastOp: -1, lastZ: 0, lastPE: '', loaded: false
        };
        // NB: clicks are handled in onUp (pointer capture swallows the
        // element's own click event), so no per-tile click listener here.

        frag.appendChild(el);
        tiles.push(t);
      });

      els.scene.appendChild(frag);
      computeOrder();
      tiles.forEach(t => { const g = gridTargetFor(t); t.gx = g.x; t.gy = g.y; });
    }

    function computeOrder() {
      const sorted = DATA.map((_, i) => i)
        .sort((a, b) => COMPARATORS[sortKey](DATA[a], DATA[b]) * sortDir);
      sorted.forEach((workIdx, pos) => { orderPos[workIdx] = pos; });
    }
    function gridTargetFor(t) {
      const pos = orderPos[t.idx];
      const r = Math.floor(pos / cols), c = pos % cols;
      return {
        x: gridLeft + c * stride + cell / 2,
        y: gridTop + r * stride + cell / 2 - gridScrollY
      };
    }

    /* ---- focus (screen-space dolly to full screen) --------------------- */
    function focusOn(t) {
      if (focusActive) return;
      focusActive = true; focusTile = t;
      // freeze any field momentum so the work returns to the same spot on exit
      vel.x = vel.y = vel.z = tvel.x = tvel.y = tvel.z = scrollAccum = 0;
      els.body.classList.add('mode-focus');
      els.hint.classList.add('is-hidden');
      els.focusSwatch.style.background = t.work.color;
      els.focusTitle.textContent = t.work.title;
      els.focusFacts.textContent = factsLine(t.work);
      els.focusbar.classList.add('is-on');
      // swap in a higher-resolution image so it's crisp full screen
      if (t.work.imgHi && !t.hiLoaded) {
        const hi = new Image();
        hi.onload = () => { t.img.src = t.work.imgHi; t.img.classList.add('is-loaded'); t.hiLoaded = true; };
        hi.src = t.work.imgHi;
      }
    }
    function exitFocus() {
      if (!focusActive) return;
      focusActive = false;
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
      if (morph !== morphTarget) {
        morph += (morphTarget - morph) * 0.1;
        if (Math.abs(morphTarget - morph) < 0.0015) morph = morphTarget;
      }
      const m = easeInOut(morph);

      // focus dolly amount (0..1). The camera is frozen while focusing so the
      // work returns to exactly where it left when you exit.
      const focusGoal = focusActive ? 1 : 0;
      focusAmt += (focusGoal - focusAmt) * 0.09;
      if (Math.abs(focusGoal - focusAmt) < 0.001) focusAmt = focusGoal;
      if (focusAmt === 0) focusTile = null;

      if (!focusActive && focusAmt < 0.002 && morph < 0.002) simCamera();

      gridScrollY += (gridScrollTarget - gridScrollY) * 0.16;

      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];

        const g = gridTargetFor(t);
        t.gx += (g.x - t.gx) * 0.2;
        t.gy += (g.y - t.gy) * 0.2;
        const gScale = Math.min(cell / BASE, cell / (BASE * t.work.aspect));

        const relX = wrap(t.wx - cam.x + period / 2, period) - period / 2;
        const relY = wrap(t.wy - cam.y + period / 2, period) - period / 2;
        const depth = wrap((cam.z - t.wz) + 40, PZ) - 40;     // [-40, 320]
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

        let px = lerp(csx, t.gx, m);
        let py = lerp(csy, t.gy, m);
        let s  = lerp(cDom, gScale, m);
        let op = lerp(t.op, 1, m);

        // focus: the chosen work dollies to centre + full screen, the rest fade
        if (focusAmt > 0.001) {
          if (t === focusTile) {
            const fitS = Math.min((2 * cy * FIT) / BASE, (2 * cx * FIT) / (BASE * t.work.aspect));
            px = lerp(px, cx, focusAmt);
            py = lerp(py, cy, focusAmt);
            s  = lerp(s, fitS, focusAmt);
            op = lerp(op, 1, focusAmt);
          } else {
            op *= (1 - focusAmt);
          }
        }

        t.el.style.transform =
          `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%) scale(${s.toFixed(4)})`;

        const oq = Math.round(op * 100) / 100;
        if (oq !== t.lastOp) { t.el.style.opacity = oq; t.lastOp = oq; }

        // depth sorting: nearer (smaller depth) paints on top
        const zi = (t === focusTile && focusAmt > 0.01) ? 900000 : Math.round(100000 - depth * 10);
        if (zi !== t.lastZ) { t.el.style.zIndex = zi; t.lastZ = zi; }

        // don't let invisible tiles intercept clicks
        const pe = oq < 0.04 ? 'none' : 'auto';
        if (pe !== t.lastPE) { t.el.style.pointerEvents = pe; t.lastPE = pe; }

        if (!t.loaded && oq > 0.03) { t.loaded = true; loadImg(t.img, t.work.img); }
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
      if (focusActive) exitFocus();
      morphTarget = view === 'grid' ? 1 : 0;
      if (view === 'grid') { gridScrollTarget = gridScrollY = 0; }
      els.body.classList.toggle('mode-grid', view === 'grid');
      els.sortbar.setAttribute('aria-hidden', String(view !== 'grid'));
      if (view === 'grid') { clearTimeout(hintTimer); hideHint(); }
      else { els.hint.classList.remove('is-hidden'); clearTimeout(hintTimer); hintTimer = setTimeout(hideHint, 4600); }
    }
    function setSort(key) {
      if (key === sortKey) return;
      sortKey = key; computeOrder();
      tiles.forEach(t => { t.label.textContent = subFor(t.work); });
    }
    function toggleDir() {
      sortDir *= -1; computeOrder();
      tiles.forEach(t => { t.label.textContent = subFor(t.work); });
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
            const g = gridTargetFor(t); t.gx = g.x; t.gy = g.y;
          });
        }, 180);
      });

      els.hint.classList.remove('is-hidden');
      hintTimer = setTimeout(hideHint, 4600);
      requestAnimationFrame(frame);
    }

    return { init, setView, setSort, toggleDir, exitFocus };
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

  /* =================================================================== BOOT */
  Field.init();
})();
