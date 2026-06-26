# Exhibition

A responsive gallery website that combines an **infinite canvas** (in the spirit
of [Tympanus' Infinite Canvas](https://tympanus.net/Tutorials/InfiniteCanvas/))
with a **sortable grid** view. Browse works by dragging around an endless plane,
then flip to a grid and re-arrange everything by **Name, Colour, Category, Mood,
or Client**.

## Features

- **Infinite canvas** — a toroidally-wrapped plane of tiles with pointer drag,
  inertia/momentum, and trackpad/wheel panning. Works on desktop and touch.
- **Grid view** — every work in a responsive grid, re-sortable with a smooth
  [FLIP](https://aerotwist.com/blog/flip-your-animations/) transition between
  arrangements. Sort ascending/descending.
- **Sort criteria** — Name (A–Z), Colour (by hue), Category, Mood, Client.
- **Detail overlay** — click any work to see its image and curatorial metadata.
- **Resilient images** — each work has a fallback colour swatch, so the layout
  stays meaningful even if a remote image fails to load.
- **Responsive** — tile sizes and chrome adapt from mobile to desktop;
  respects `prefers-reduced-motion`.

## Run it

It's plain HTML/CSS/JS — no build step. Serve the folder over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly also works, but a local server avoids any
browser file-access quirks.)

## Files

| File         | Purpose                                                        |
| ------------ | -------------------------------------------------------------- |
| `index.html` | Markup: top bar, view switch, sort bar, canvas, grid, overlay. |
| `styles.css` | All styling, theming, and responsive rules.                    |
| `data.js`    | The catalogue — works with curatorial metadata.                |
| `app.js`     | Infinite-canvas engine, grid + FLIP sorting, mode switching.   |

## Customising the catalogue

Edit the vocabularies (`TITLES`, `CATEGORIES`, `MOODS`, `CLIENTS`) at the top of
`data.js`, or replace the generated array on `window.EXHIBITION_DATA` with your
own works. Each work needs:

```js
{
  id, title, hue,          // hue 0–360 drives colour sorting
  color, colorName,        // hex + readable name for the swatch
  category, mood, client,  // grouping/sorting facets
  year, img                // image URL
}
```
