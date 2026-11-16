# Playground

**Target:** web. **Run:** `npm run examples`, then *Playground* (or `npm run dev` and open `/examples/playground/index.html`).

One page that exposes the levers of `ChartWorkspace` against the shared synthetic feed (`../_shared/feed.ts`):

- **Market:** five markets, including `EMPTY` (no data) and `BROKEN` (the feed throws), six intervals, live ticking on or off.
- **Look:** light, dark and a registered custom theme, locale, density, layout (`auto`, `regular`, `compact`, `narrow`).
- **Width:** desktop, 768, 390 and 320 px frames, to see the layout change by the workspace's own width.
- **Parts:** every `ui.parts` switch, including the left tool rail.
- **Overrides:** `--sc-accent`, `--sc-radius`, `--sc-control-height`, `--sc-font-size` set on the workspace root, which is
  what a host stylesheet or `ui.variables` does.
- **Drawings and indicators:** sample drawings, the selection toolbar, undo, hold-to-draw, and a few indicators.
- **Release check:** a checklist stored in the browser per package version, and a counter of window errors,
  unhandled rejections and `console.error` calls (it must stay at 0).

The playground is a test page, not a design reference: its own page chrome is deliberately plain. Do not copy it into an app.
