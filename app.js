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
    plane:       document.getElementById('plane'),
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

  /* ======================================================== INFINITE CANVAS */
  const Canvas = (function () {
    let tiles = [];            // { el, img, baseX, baseY, work }
    let cols = 0, rows = 0, tileW = 0, tileH = 0, totalW = 0, totalH = 0;
    let offX = 0, offY = 0;    // pan offset
    let velX = 0, velY = 0;    // inertia
    let dragging = false, moved = 0;
    let pointerId = null, lastX = 0, lastY = 0;
    let raf = null, active = false;

    const wrap = (v, size) => ((v % size) + size) % size;

    function tileSize() {
      const w = window.innerWidth;
      if (w < 560) return 180;
      if (w < 900) return 230;
      return 300;
    }

    function build() {
      const vw = window.innerWidth, vh = window.innerHeight;
      const gap = 28;
      tileW = tileSize() + gap;
      tileH = tileW;
      document.documentElement.style.setProperty('--tile', tileSize() + 'px');

      // Enough columns/rows to cover the viewport twice over so wrapping is seamless.
      cols = Math.ceil((vw + 2 * tileW) / tileW) + 1;
      rows = Math.ceil((vh + 2 * tileH) / tileH) + 1;
      cols = Math.max(cols, 5);
      rows = Math.max(rows, 5);
      totalW = cols * tileW;
      totalH = rows * tileH;

      els.plane.innerHTML = '';
      tiles = [];
      let n = 0;
      const frag = document.createDocumentFragment();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const work = DATA[n % DATA.length];
          n++;
          const el = document.createElement('div');
          el.className = 'tile';
          el.style.width = tileSize() + 'px';
          el.style.height = tileSize() + 'px';
          el.style.setProperty('--c', work.color);
          const img = document.createElement('img');
          img.alt = work.title;
          img.draggable = false;
          el.appendChild(img);
          el.addEventListener('click', () => { if (moved < 6) openDetail(work); });
          frag.appendChild(el);
          tiles.push({ el, img, baseX: c * tileW, baseY: r * tileH, work, loaded: false });
        }
      }
      els.plane.appendChild(frag);

      // Start roughly centred on the cluster.
      offX = -totalW / 2 + vw / 2;
      offY = -totalH / 2 + vh / 2;
      render(true);
    }

    function render(loadVisible) {
      const vw = window.innerWidth, vh = window.innerHeight;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        const x = wrap(t.baseX + offX + tileW, totalW) - tileW;
        const y = wrap(t.baseY + offY + tileH, totalH) - tileH;
        t.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;

        if (loadVisible && !t.loaded &&
            x > -tileW && x < vw + tileW && y > -tileH && y < vh + tileH) {
          t.loaded = true;
          loadImg(t.img, t.work.img);
        }
      }
    }

    function loop() {
      if (!active) return;
      if (!dragging) {
        offX += velX;
        offY += velY;
        velX *= 0.93;
        velY *= 0.93;
        if (Math.abs(velX) < 0.05) velX = 0;
        if (Math.abs(velY) < 0.05) velY = 0;
      }
      render(true);
      raf = requestAnimationFrame(loop);
    }

    function onDown(e) {
      dragging = true;
      moved = 0;
      pointerId = e.pointerId;
      lastX = e.clientX; lastY = e.clientY;
      velX = velY = 0;
      els.canvas.classList.add('is-dragging');
      els.canvas.setPointerCapture(pointerId);
      hideHint();
    }
    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      offX += dx; offY += dy;
      velX = dx; velY = dy;
      moved += Math.abs(dx) + Math.abs(dy);
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      els.canvas.classList.remove('is-dragging');
      try { els.canvas.releasePointerCapture(pointerId); } catch (_) {}
    }
    function onWheel(e) {
      e.preventDefault();
      offX -= e.deltaX;
      offY -= e.deltaY;
      velX = -e.deltaX * 0.25;
      velY = -e.deltaY * 0.25;
      hideHint();
    }

    let hintTimer = null;
    function hideHint() {
      els.hint.classList.add('is-hidden');
    }

    function start() {
      if (active) return;
      active = true;
      if (!tiles.length) build();
      els.hint.classList.remove('is-hidden');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(hideHint, 4200);
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
