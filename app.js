/* =========================================================================
   Exhibition — app
   - Infinite canvas: a toroidally-wrapped plane of tiles with drag + inertia
   - Grid: every work laid out responsively, re-sortable with a FLIP animation
   ========================================================================= */
(function () {
  'use strict';

  const DATA = window.EXHIBITION_DATA || [];

  const els = {
    body:        document.body,
    canvas:      document.getElementById('canvas'),
    scene:       document.getElementById('scene'),
    hint:        document.getElementById('canvasHint'),
    grid:        document.getElementById('grid'),
    sortbar:     document.getElementById('sortbar'),
    sortGroup:   document.getElementById('sortGroup'),
    dirBtn:      document.getElementById('dirBtn'),
    workCount:   document.getElementById('workCount'),
    detail:      document.getElementById('detail'),
    detailImg:   document.getElementById('detailImg'),
    detailTitle: document.getElementById('detailTitle'),
    detailFacts: document.getElementById('detailFacts'),
    detailClose: document.getElementById('detailClose')
  };

  els.workCount.textContent = String(DATA.length).padStart(2, '0') + ' works';

  /* Lazily fade images in once decoded. */
  function loadImg(imgEl, src) {
    const probe = new Image();
    probe.onload = () => { imgEl.src = src; requestAnimationFrame(() => imgEl.classList.add('is-loaded')); };
    probe.onerror = () => {};               // fallback colour stays visible
    probe.src = src;
  }

  /* ======================================================== INFINITE CANVAS
     A true 3D field: tiles scattered across x/y *and* z. CSS perspective gives
     automatic parallax + perspective scaling; JS adds depth-of-field blur and
     an opacity fade so works vanish into the distance and recycle seamlessly
     as you travel forward (wheel / vertical swipe). Dragging pans the field. */
  const Canvas = (function () {
    // Depth model (translateZ values, px). Focus plane is sharp; everything
    // fore/aft of it blurs. Far + front ends fade to 0 so the z-wrap is unseen.
    const PERSP    = 1200;
    const Z_FOCUS  = -360;
    const Z_FRONT  = 520;     // recycle point (closest); faded out before here
    const Z_BACK   = -2760;   // spawn point (vanishing distance); faded in
    const Z_PERIOD = Z_FRONT - Z_BACK;
    const MAX_BLUR = 13;

    let tiles = [];
    let cols = 0, rows = 0, cellW = 0, cellH = 0, worldW = 0, worldH = 0;
    let panX = 0, panY = 0, velX = 0, velY = 0;
    let travel = 0, velT = 0;
    let dragging = false, axis = null, isTouch = false, moved = 0;
    let pointerId = null, lastX = 0, lastY = 0;
    let raf = null, active = false;

    const wrap   = (v, s) => ((v % s) + s) % s;
    const clamp  = (v, a, b) => v < a ? a : v > b ? b : v;
    const AMBIENT = 0.45;     // gentle constant forward drift, so it's alive

    // Deterministic PRNG so the scatter is identical every load.
    function rng(seed) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function build() {
      const vw = window.innerWidth, vh = window.innerHeight;
      const small = vw < 700;

      cellW = small ? 360 : 520;
      cellH = small ? 320 : 440;
      cols = Math.max(5, Math.round((vw * 1.5) / cellW) + 2);
      rows = Math.max(4, Math.round((vh * 1.5) / cellH) + 2);
      worldW = cols * cellW;
      worldH = rows * cellH;

      els.scene.innerHTML = '';
      tiles = [];
      const rand = rng(98765);
      const PHI = 0.6180339887;
      const frag = document.createDocumentFragment();
      let n = 0;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const work = DATA[n % DATA.length];

          // Scatter within the cell so it doesn't read as a grid.
          const homeX = c * cellW + (rand() - 0.5) * cellW * 0.8;
          const homeY = r * cellH + (rand() - 0.5) * cellH * 0.8;

          // Spread depth phases evenly so all distances are populated at once.
          const phase = (n * PHI) % 1;

          // Mixed sizes; a few heroes read large when they pass close.
          const hero = rand() < 0.16;
          const w = (hero ? 360 : 180) + rand() * (hero ? 150 : 150);
          const h = w / work.aspect;

          const el = document.createElement('div');
          el.className = 'tile';
          el.style.width = w + 'px';
          el.style.height = h + 'px';
          el.style.setProperty('--c', work.color);

          const img = document.createElement('img');
          img.alt = work.title;
          img.draggable = false;
          el.appendChild(img);
          el.addEventListener('click', () => { if (moved < 7) openDetail(work); });

          frag.appendChild(el);
          tiles.push({ el, img, homeX, homeY, phase, work,
                       loaded: false, lastBlur: -1, lastOp: -1 });
          n++;
        }
      }
      els.scene.appendChild(frag);
      render();
    }

    function render() {
      const vw = window.innerWidth, vh = window.innerHeight;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];

        // Depth: march along z with travel, wrap into [Z_BACK, Z_FRONT).
        const z = Z_BACK + wrap(t.phase * Z_PERIOD + travel, Z_PERIOD);

        // Lateral world position, panned + toroidally wrapped, centred on origin.
        const x = wrap(t.homeX + panX, worldW) - worldW / 2;
        const y = wrap(t.homeY + panY, worldH) - worldH / 2;

        t.el.style.transform =
          `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) translate(-50%, -50%)`;

        // Depth of field: sharp at focus, blurrier with distance either way.
        const d = z - Z_FOCUS;
        const blur = d <= 0 ? Math.min(MAX_BLUR, -d / 185)
                            : Math.min(MAX_BLUR, d / 130);

        // Fade in from the far plane and out before the front recycle point.
        let op = 1;
        if (z < Z_BACK + 620)  op = Math.min(op, (z - Z_BACK) / 620);
        if (z > Z_FRONT - 420)  op = Math.min(op, (Z_FRONT - z) / 420);
        op = clamp(op, 0, 1);

        // Only touch the DOM when values actually change (cheaper).
        const bq = Math.round(blur * 2) / 2;
        if (bq !== t.lastBlur) { t.el.style.filter = bq < 0.2 ? 'none' : `blur(${bq}px)`; t.lastBlur = bq; }
        const oq = Math.round(op * 100) / 100;
        if (oq !== t.lastOp) { t.el.style.opacity = oq; t.lastOp = oq; }

        if (!t.loaded && oq > 0.04) {
          t.loaded = true;
          loadImg(t.img, t.work.img);
        }
      }
    }

    function loop() {
      if (!active) return;
      if (!dragging) {
        panX += velX; panY += velY;
        velX *= 0.92; velY *= 0.92;
        if (Math.abs(velX) < 0.05) velX = 0;
        if (Math.abs(velY) < 0.05) velY = 0;
      }
      travel += velT + AMBIENT;
      velT *= 0.9;
      if (Math.abs(velT) < 0.05) velT = 0;
      render();
      raf = requestAnimationFrame(loop);
    }

    /* ---- input ------------------------------------------------------ */
    function onDown(e) {
      dragging = true; moved = 0; axis = null;
      isTouch = e.pointerType === 'touch';
      pointerId = e.pointerId;
      lastX = e.clientX; lastY = e.clientY;
      velX = velY = velT = 0;
      els.canvas.classList.add('is-dragging');
      els.canvas.setPointerCapture(pointerId);
      hideHint();
    }
    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);

      // Touch has no wheel: lock each swipe to pan (horizontal) or travel
      // (vertical) so phones can still fly through the depth.
      if (isTouch) {
        if (axis === null && moved > 12) axis = Math.abs(dy) > Math.abs(dx) ? 'z' : 'xy';
        if (axis === 'z') { travel -= dy * 1.4; velT = -dy * 1.4; return; }
      }
      panX += dx; panY += dy;
      velX = dx; velY = dy;
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      els.canvas.classList.remove('is-dragging');
      try { els.canvas.releasePointerCapture(pointerId); } catch (_) {}
    }
    function onWheel(e) {
      e.preventDefault();
      travel += e.deltaY * 0.9;
      velT = e.deltaY * 0.5;
      hideHint();
    }

    let hintTimer = null;
    function hideHint() { els.hint.classList.add('is-hidden'); }

    function start() {
      if (active) return;
      active = true;
      if (!tiles.length) build();
      els.hint.classList.remove('is-hidden');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(hideHint, 4600);
      raf = requestAnimationFrame(loop);
    }
    function stop() {
      active = false;
      if (raf) cancelAnimationFrame(raf);
    }

    els.canvas.addEventListener('pointerdown', onDown);
    els.canvas.addEventListener('pointermove', onMove);
    els.canvas.addEventListener('pointerup', onUp);
    els.canvas.addEventListener('pointercancel', onUp);
    els.canvas.addEventListener('wheel', onWheel, { passive: false });

    let rt = null;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (active) build(); }, 200);
    });

    return { start, stop };
  })();

  /* ================================================================== GRID */
  const Grid = (function () {
    const cards = new Map();   // work.id -> card element
    let built = false;
    let sortKey = 'name';
    let dir = 1;               // 1 asc, -1 desc

    const COMPARATORS = {
      name:     (a, b) => a.title.localeCompare(b.title),
      color:    (a, b) => a.hue - b.hue || a.title.localeCompare(b.title),
      category: (a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title),
      mood:     (a, b) => a.mood.localeCompare(b.mood) || a.title.localeCompare(b.title),
      client:   (a, b) => a.client.localeCompare(b.client) || a.title.localeCompare(b.title)
    };

    // Secondary label shown under the title, contextual to the active sort.
    function subFor(work) {
      switch (sortKey) {
        case 'color':    return work.colorName;
        case 'category': return work.category;
        case 'mood':     return work.mood;
        case 'client':   return work.client;
        default:         return work.category;
      }
    }

    function build() {
      const frag = document.createDocumentFragment();
      DATA.forEach(work => {
        const card = document.createElement('article');
        card.className = 'card';
        card.style.setProperty('--c', work.color);

        const img = document.createElement('img');
        img.alt = work.title;
        img.loading = 'lazy';

        const info = document.createElement('div');
        info.className = 'card__info';
        info.innerHTML =
          `<div><div class="card__title">${work.title}</div>` +
          `<div class="card__sub" data-sub>${subFor(work)}</div></div>` +
          `<span class="card__swatch" style="background:${work.color}"></span>`;

        card.appendChild(img);
        card.appendChild(info);
        card.addEventListener('click', () => openDetail(work));
        card._work = work;
        card._img = img;
        cards.set(work.id, card);
        frag.appendChild(card);
      });
      els.grid.appendChild(frag);
      built = true;
      applySort(false);
    }

    function loadVisibleImages() {
      cards.forEach(card => {
        if (card._loaded) return;
        card._loaded = true;
        loadImg(card._img, card._work.img);
      });
    }

    // FLIP: animate cards from old to new positions after re-ordering.
    function applySort(animate) {
      const ordered = [...DATA].sort((a, b) => COMPARATORS[sortKey](a, b) * dir);

      const nodes = [...els.grid.children];
      const first = animate ? new Map(nodes.map(n => [n, n.getBoundingClientRect()])) : null;

      ordered.forEach(work => {
        const card = cards.get(work.id);
        card.querySelector('[data-sub]').textContent = subFor(work);
        els.grid.appendChild(card);
      });

      if (!animate) return;

      nodes.forEach(card => {
        const last = card.getBoundingClientRect();
        const f = first.get(card);
        const dx = f.left - last.left;
        const dy = f.top - last.top;
        if (!dx && !dy) return;
        card.style.transition = 'none';
        card.style.transform = `translate(${dx}px, ${dy}px)`;
      });
      requestAnimationFrame(() => {
        nodes.forEach(card => {
          card.style.transition = 'transform .6s cubic-bezier(.22,1,.36,1)';
          card.style.transform = '';
        });
      });
    }

    function setSort(key) {
      if (key === sortKey) return;
      sortKey = key;
      applySort(true);
    }
    function toggleDir() {
      dir *= -1;
      applySort(true);
    }

    function show() {
      if (!built) build();
      loadVisibleImages();
    }

    return { show, setSort, toggleDir, getKey: () => sortKey };
  })();

  /* ============================================================ MODE SWITCH */
  function setMode(mode) {
    const grid = mode === 'grid';
    els.body.classList.toggle('mode-grid', grid);
    els.grid.hidden = !grid;
    els.sortbar.setAttribute('aria-hidden', String(!grid));

    document.querySelectorAll('.modeswitch__btn').forEach(btn => {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });

    if (grid) { Canvas.stop(); Grid.show(); window.scrollTo({ top: 0 }); }
    else      { Canvas.start(); }
  }

  document.querySelectorAll('.modeswitch__btn').forEach(btn =>
    btn.addEventListener('click', () => setMode(btn.dataset.mode))
  );

  els.sortGroup.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    els.sortGroup.querySelectorAll('.chip').forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    Grid.setSort(chip.dataset.sort);
  });

  els.dirBtn.addEventListener('click', () => {
    els.dirBtn.classList.toggle('is-desc');
    Grid.toggleDir();
  });

  /* ========================================================= DETAIL OVERLAY */
  function openDetail(work) {
    els.detailImg.src = work.img;
    els.detailImg.alt = work.title;
    els.detailTitle.textContent = work.title;
    els.detailFacts.innerHTML =
      row('Category', work.category) +
      row('Mood', work.mood) +
      row('Client', work.client) +
      row('Colour', `<span class="swatch" style="background:${work.color}"></span>${work.colorName}`) +
      row('Year', work.year);
    els.detail.hidden = false;
  }
  function row(label, value) {
    return `<dt>${label}</dt><dd>${value}</dd>`;
  }
  function closeDetail() { els.detail.hidden = true; }

  els.detailClose.addEventListener('click', closeDetail);
  els.detail.addEventListener('click', e => { if (e.target === els.detail) closeDetail(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

  /* =================================================================== BOOT */
  setMode('canvas');
})();
