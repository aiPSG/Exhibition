# Exhibition

A responsive gallery website that combines an **infinite canvas** (in the spirit
of [Tympanus' Infinite Canvas](https://tympanus.net/Tutorials/InfiniteCanvas/))
with a **sortable grid** view. Browse works by dragging around an endless plane,
then flip to a grid and re-arrange everything by **Name, Colour, Category, Mood,
or Client**.

## Features

- **Infinite canvas** — a camera is simulated in JS and flies through an
  infinitely-tiled 3D field of works. Motion and the "vanishing" fade use the
  **exact constants** from [edoardolunardi/infinite-canvas](https://github.com/edoardolunardi/infinite-canvas)
  (velocity lerp `0.16`, decay `0.9`, clamp `±3.2`, wheel `0.006` with `0.8`
  accumulation decay, depth fade `140 → 260` squared, fov `60`, sizes `12–20`).
  Like the reference there is **no blur** — depth reads through opacity fade and
  perspective scaling alone. Drag to pan, scroll to travel, pinch to zoom.
- **One pool, two views** — the canvas and the grid are the *same* tiles. There
  is no hard switch: the works fly from their scattered positions and **arrange
  themselves into the grid** (and back again).
- **Sortable grid** — re-sort by Name (A–Z), Colour (by hue), Category, Mood, or
  Client; tiles re-flow with eased motion. Sort ascending/descending.
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
| `index.html` | Markup: top bar, view switch, sort bar, scene, overlay.        |
| `styles.css` | All styling, theming, and responsive rules.                    |
| `data.js`    | The catalogue — works with curatorial metadata.                |
| `app.js`     | The unified field: JS camera + projection, the canvas↔grid morph, and sorting. |

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
