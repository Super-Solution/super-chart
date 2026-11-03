# Visible geometry, cursor inspection and time navigation

Private candidate 0.0.49 adds an opt-in rendering bridge for the shared realtime
view. It provides geometry and data only: Canvas, SVG, React Native views, gestures,
axes/text painting and device pixel scaling remain with the host. No original App
or deployed renderer is changed.

## Build one frame per visible snapshot/layout

```ts
import { createRealtimeChartFrame } from '@zzyzxlabs/super-chart/core'

// view is a RealtimeView connected to the existing DataLoader/RealtimeSeries.
const snapshot = view.getSnapshot()
const frame = createRealtimeChartFrame(snapshot, 800, 400, {
  spacing: 'time',
  indicators: ['MA20', 'EMA21'],
  colors: { MA20: '#f59e0b', EMA21: '#3b82f6' }
})
// Draw frame.model.plottedCandles and frame.model.plottedSeries with your renderer.
const selected = frame.inspect(chartLocalX)
// selected.index is global within the loaded history, at this snapshot.
```

Rebuild when snapshot identity, dimensions or options change. Reuse that frame for
pointer movement; `inspect` does not rebuild geometry. The geometry is the existing
financial model applied only to the visible window, including already-computed
indicator values, so warmup and seed history are not restarted at the window edge.
The default includes both native MA20 and EMA21; `indicators: []` hides both.
`spacing: 'time'` preserves time gaps; `'category'` uses equal candle spacing.

`model.start/end/allKeys` and its candle/point indexes describe the local visible
window. Use snapshot.length/viewport for the full-history range rail. Use inspect's
index when a global candle index is needed. Model objects remain mutable-typed for
compatibility with existing financial-model renderers; hosts must treat them as
read-only, or recreate a frame after changes. The frame is tied to the captured
snapshot and does not observe newer data automatically.

## Cursor values and coordinate convention

`frame.inspect(chartX)` expects **chart-local logical x including the left axis
 gutter**, the same coordinates as `model.xPositions`. If a gesture reports x relative
to the plot area's left edge, add `model.geometry.left`. Convert screen coordinates,
CSS transforms or native/device pixels to the model's logical coordinates first.

Inspection returns the nearest visible candle (earlier point wins equal-distance
ties); out-of-range x clamps to the visible edge. Empty data or non-finite x returns
null. It returns the candle timestamp, global loaded-history index at the captured
snapshot, display mode, displayBar and raw-price MA20/EMA21 values. Missing/warmup
or non-finite indicator values return null. Hidden indicators remain inspectable
from the snapshot, even when omitted from drawing options.

In `heikin-ashi` mode, displayBar contains synthetic OHLC. The explicit mode and
`indicatorBasis: 'raw'` distinguish it from the original-price indicators. These
are chart readouts, not executable quotes or transaction inputs. Metadata retains
the same shallow-immutability rules as RealtimeView.

## Navigate by time

`view.seek(timestamp, anchor = 0.5)` binary-searches the loaded history and pins the
current-size window around the nearest candle. Anchor 0 puts it toward the left,
1 toward the right; edge clamping can prevent the exact requested placement.
Timestamps outside loaded history select the nearest loaded edge. No history fetch
is initiated. The return value means a loaded candle was found, not that the time
matched exactly or that the viewport changed. Empty/disposed views and non-finite
inputs return false. `followLatest()` restores live following.

The underlying `nearestBarIndex(bars, timestamp)` is also exported for other hosts.
It assumes ascending, unique timestamps, returns null for empty/invalid queries,
and uses O(log n) lookup without building an index or caching mutable arrays.

## Actual measurement and validation

Manual Bun 1.3.10 Windows workload: 20,000 bars with precomputed native MA20/EMA21,
40 successive pan windows of 160 bars at 800x400. The baseline already has its full
financial data prepared and calls the existing model with a viewport. The new path
includes setViewport, visible snapshot copying/freezing and frame construction.
Four warmup pairs plus 11 alternating samples: median 1,273.0107 ms baseline versus
27.4914 ms new for all 40 windows. Visible geometry, price domain, candle coordinates
and indicator point coordinates matched. This is core-model cost, not browser or
native-device FPS; initial history/indicator calculation is excluded.

Manual HA navigation/inspection selected the requested timestamp at global index
10,000, pinned the view, returned synthetic OHLC plus raw MA/EMA, clamped outside x
to the visible edge, and returned null for NaN. Independent review checked indexing,
empty/warmup handling and coordinate conventions.

Existing financial-model tests were run through the established read-only resolver:
7 functional tests passed, 3 unrelated component cases filtered out. Type/lint and
the existing full package/consumer build provide additional validation. No tests,
fixtures, pipeline, dependencies or package publication were added. New API behavior
has manual validation and review rather than a dedicated new regression suite.
