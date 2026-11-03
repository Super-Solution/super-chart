# Realtime viewport and candle modes

Private candidate 0.0.48 adds `RealtimeView` to `./core` and `./native`, on top of
RealtimeSeries and the existing viewport math. No React, DOM or native runtime is
imported. Original app adoption, rendering and gesture handling remain with hosts.

## View lifetime and state

Create one view for the chart lifetime, outside render-time allocation. It subscribes
to its series immediately. Dispose it on unmount, alongside your DataLoader; do not
create a view on every React render. `getSnapshot` and `subscribe` are bound functions
suitable for client-side `useSyncExternalStore`. Unlike `series.snapshot()`, repeated
`view.getSnapshot()` calls return the same object until visible state changes.
React/React Native are not added as package dependencies. SSR hydration policy remains
with the host; this does not provide a server snapshot or renderer.

```ts
import { RealtimeSeries, RealtimeView } from '@zzyzxlabs/super-chart/core'

const series = new RealtimeSeries()
const view = new RealtimeView(series, { count: 160, mode: 'heikin-ashi' })
// Attach your existing DataLoader to series, not to view.
const stop = view.subscribe(() => draw(view.getSnapshot()))
draw(view.getSnapshot())
// Client React hook alternative: useSyncExternalStore(view.subscribe, view.getSnapshot)
view.pan(-40)          // Move toward older bars; stop following live data.
view.zoom(2, 0.5)      // Zoom in around the center, using existing viewport rules.
view.followLatest()   // Resume following, retaining the selected window size.
view.setMode('raw')    // Indicator prices never switch to synthetic HA prices.
// On teardown: stop(); view.dispose(); loader.dispose()
```

The host translates pixels/gestures into bars and zoom factors, using the existing
viewport helpers if desired. There are no new gesture listeners or UI widgets.
`requestMore()` forwards the pagination request to the series/loader; it does not
fetch automatically on pan. Existing loader status/replay subscriptions remain separate.

- Default follows the latest 160 bars. Count must be positive and finite; the existing
  minimum of 12 bars applies when enough data exists. Panning/zooming an empty series
  is a no-op, so the desired initial window is retained.
- `setViewport({i0, i1})` uses inclusive indexes and pins the view; pan/zoom also pin.
  `followLatest(count?)` resumes live tracking. Invalid gesture numbers are ignored.
- Prepending history shifts pinned indexes by the new history length, keeping the
  same candle timestamps in view. Indicators and HA rebuild because earlier history
  changes their seed. A complete reset (new market, history correction or replay
  reset) resumes following the newest available bar, using the selected window size.
- Replacing the last candle while viewing an earlier window does not publish a new
  snapshot. New candles still notify, even offscreen, because total length/range-rail
  state changed. Availability changes also notify. Live-frame coalescing remains in
  DataLoader; the view adds no timers and no second batching loop.
- Snapshots contain viewport, total length, following, mode, hasMore, candles and raw
  MA20/EMA21. Objects/arrays are frozen at the top level. Nested extension metadata
  remains shallow and must be treated as immutable.
- `version` is the series version when that snapshot was made, not a viewport revision.
  Pan/zoom can create a new snapshot with the same version; suppressed offscreen tail
  updates leave the visible snapshot's earlier version intact. Use snapshot identity
  for rendering, not version alone. Do not mutate series during a notification.
- `dispose` detaches the series subscription and clears view listeners; the last
  snapshot stays readable, subsequent mutations are ignored. Other views still work.

## Incremental Heikin Ashi

`series.snapshot(start, end, 'heikin-ashi')` enables lazy full-history HA computation.
After first use, append/latest-candle replacement calculates only the affected HA row;
reset/prepend rebuilds. It always uses the preceding transformed candle, never the
visible window's first candle as a new seed. Raw mode remains the default.

The cache uses O(history) additional candle objects after HA has been requested and
remains maintained for the lifetime of the series, allowing multiple views/mode switches.
Initial computation and history changes remain O(history); steady tail updates are O(1)
per changed bar. The finite-input contract of RealtimeSeries is unchanged; standalone
`toHeikinAshi` retains its invalid-bar fallback. MA20/EMA21 always use original prices,
not synthetic Heikin Ashi prices. No change to the existing Web overlay renderer.

## Actual validation and measurement

Existing HA/overlay/normalization/loader tests: 118 passed. Scoped lint and typecheck
passed. New view behavior is manually exercised and independently reviewed; no new
regression tests or pipeline were added without owner approval.

Manual Bun 1.3.10 Windows workload: 20,000 history bars, 300 updates in 30 batches,
160 visible candles, HA plus raw MA20/EMA21. The baseline already uses incremental
MA/EMA and batch updates (phase 8) but transforms all HA history on each batch. New
path includes frozen view snapshots; initial history/initial HA is excluded on both
sides. Four warmup pairs and 21 alternating samples: median 14.3619 -> 2.4669 ms.
Visible HA, MA and EMA results matched in this workload. Not device or browser FPS.

Manual view flow observed zero notifications and unchanged snapshot identity for an
offscreen tail replacement; the same first candle timestamp after a 100-bar prepend;
visible HA matching full-history conversion after prepend; zoom from 160 to 80 bars;
follow returning to latest; and an unchanged snapshot after dispose. No production
feed, React renderer or actual Mobile application was exercised.
