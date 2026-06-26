/* =========================================================================
   Exhibition — dataset
   Each work carries curatorial metadata so it can be sorted/grouped:
     title, hue (0–360 for colour sorting), color (hex), colorName,
     category, mood, client, year, aspect.
   Images are deterministic placeholders (picsum seed = id); the metadata
   colour is used as a fallback background so the grid stays meaningful
   even if an image fails to load.
   ========================================================================= */
(function () {
  'use strict';

  const COUNT = 96;            // pool size: denser canvas field + richer grid

  const WORDS = [
    'Drift', 'Halcyon', 'Aperture', 'Undertow', 'Vesper', 'Meridian',
    'Cinder', 'Lustre', 'Threshold', 'Murmur', 'Solstice', 'Fathom',
    'Ember', 'Quartz', 'Verdant', 'Nocturne', 'Cascade', 'Pollen',
    'Static', 'Marrow', 'Glimmer', 'Tide', 'Coil', 'Plume',
    'Relic', 'Saffron', 'Hush', 'Pivot', 'Bloom', 'Granite',
    'Reverie', 'Signal', 'Velour', 'Crest', 'Ashen', 'Lattice',
    'Drape', 'Forge', 'Mirage', 'Cobalt', 'Anvil', 'Brume',
    'Cusp', 'Dune', 'Fable', 'Gossamer', 'Indigo', 'Juniper'
  ];
  const SUFFIX = ['', ' II', ' III'];   // keeps titles unique past WORDS.length

  const CATEGORIES = ['Photography', 'Painting', 'Sculpture', 'Digital', 'Typography'];
  const MOODS      = ['Calm', 'Vibrant', 'Melancholic', 'Playful', 'Bold'];
  const CLIENTS    = ['Aerie Studio', 'Northwind', 'Marlowe & Co.', 'Format Press', 'Helios Lab', 'Self-initiated'];
  const RATIOS     = [[4, 5], [5, 4], [1, 1], [3, 4], [4, 3], [2, 3], [3, 2], [16, 10], [10, 16]];

  function colorName(h) {
    if (h < 15 || h >= 345) return 'Red';
    if (h < 45)  return 'Orange';
    if (h < 70)  return 'Yellow';
    if (h < 160) return 'Green';
    if (h < 200) return 'Teal';
    if (h < 255) return 'Blue';
    if (h < 290) return 'Violet';
    if (h < 345) return 'Magenta';
    return 'Red';
  }

  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
      const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rand = mulberry32(20260626);
  const works = [];

  for (let i = 0; i < COUNT; i++) {
    const hue = Math.floor(rand() * 360);
    const sat = 55 + Math.floor(rand() * 35);
    const lig = 45 + Math.floor(rand() * 20);

    const [rw, rh] = RATIOS[Math.floor(rand() * RATIOS.length)];
    const aspect = rw / rh;
    const long = 640;
    const aw = aspect >= 1 ? long : Math.round(long * aspect);
    const ah = aspect >= 1 ? Math.round(long / aspect) : long;

    const title = WORDS[i % WORDS.length] + SUFFIX[Math.floor(i / WORDS.length)];

    works.push({
      id: i + 1,
      title,
      hue,
      color: hslHex(hue, sat, lig),
      colorName: colorName(hue),
      category: CATEGORIES[Math.floor(rand() * CATEGORIES.length)],
      mood:     MOODS[Math.floor(rand() * MOODS.length)],
      client:   CLIENTS[Math.floor(rand() * CLIENTS.length)],
      year:     2018 + Math.floor(rand() * 8),
      aspect,
      img:      `https://picsum.photos/seed/exh-${i + 1}/${aw}/${ah}`
    });
  }

  window.EXHIBITION_DATA = works;
})();
