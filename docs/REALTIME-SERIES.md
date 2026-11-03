# Realtime series for renderer-owned views

`RealtimeSeries` is an opt-in, DOM-free `ChartDataPort` exported by `./core` and
`./native`. It lets a Web or React Native host consume the existing DataLoader
without implementing its own history array and full-history MA/EMA recalculation.
It does not install a renderer or gesture handler, or change the deployed Mobile app.

## Data and indicators

- Initial history, a complete history correction and prepended history rebuild
  MA20 and EMA21. Use `applyNewData` with the complete corrected history; do not
  mutate `getDataList()` and expect a cache to detect the change.
- Append calculates one row. Replacing the latest candle restores the checkpoint
  preceding that candle before calculating, including repeated replacements.
- MA20 preserves the existing native rolling-sum arithmetic. EMA21 preserves the
  native first-close seed and 20 hidden warmup rows. This is deliberately not the
  Web indicator's SMA-seeded EMA. Both series are always calculated by this sink.
- `updateDataBatch` validates the whole ordered batch before changing anything,
  ignores ticks older than the current tail, and sends one notification for the
  accepted batch. Equal timestamps replace the last bar; timestamps cannot decrease
  inside a batch. Historical corrections require a reset, not a tail update.
- The loader already coalesces same-candle ticks per frame. It now uses an optional
  `updateDataBatch` sink for live flushes and cached-history tail refreshes. Existing
  Web sinks without this method retain ordered `updateData` calls. Cached tail
  refresh also forwards fresh history availability via the optional second
  batch argument; live batches leave availability unchanged.
- Inputs to the sink must already have finite OHLC and sorted, unique timestamps
  for history (equal timestamps allowed in tail batches). Direct callers should
  use `normalizeBars` and retain its chosen time unit. DataLoader already does this.

## Host integration

```ts
import { RealtimeSeries, createNativeDataLoader } from '@zzyzxlabs/super-chart/native'

const series = new RealtimeSeries()
const loader = createNativeDataLoader({ datafeed, appState: AppState })
const stopData = series.subscribe(change => {
  // The host chooses its visible range. This copies 160 bars, not all history.
  setChartState(series.snapshot(-160))
})
const stopStatus = loader.on('status', status => setLoadState(status))
const stopReplay = loader.on('replay', active => setReplayActive(active))
loader.attach(series)
loader.request(symbol, period)
// On reaching the oldest visible bar: series.requestMore()
// On unmount: stopData(); stopStatus(); stopReplay(); loader.dispose()
```

The host owns rendering, viewport, gestures, mount/unmount and reconnect signals.
Web hosts can use the same sink with the existing browser DataLoader adapter.
Loading/error/retry and replay APIs remain on DataLoader; this does not duplicate
that state machine or claim to infer network connectivity from quote silence.
Use loader.reload() to retry initial history; resync(), enterReplay(), replayStep()
and exitReplay() retain the existing loader behavior. `requestMore()` respects `hasMore`; loader handles
in-flight pagination and retry backoff. Empty pagination results that change
`hasMore` emit an `availability` notification.

Changes carry kind, first affected index, total length and a monotonic version.
`subscribe` does not emit an initial value: read `snapshot` when mounting.
Snapshots copy OHLC objects and indicator arrays, but extension metadata is only
shallow-copied. Treat nested metadata as immutable. `getDataList` is a borrowed,
mutable-typed compatibility view for DataLoader and must not be changed by hosts.
`snapshot` creates a new object per call: it is an on-demand render-state copy,
not a stable `useSyncExternalStore.getSnapshot` function. Listeners should not
throw or mutate the series during notification.

## Measurement and validation

Manual Bun 1.3.10 / Windows measurement: 20,000 history bars, 300 live updates in
30 batches, MA20 plus EMA21 and 160-bar render snapshots. Baseline already batches
notifications and runs the existing nativeIndicatorSeries once per batch; the new
sink calculates the tail. Four warmup pairs, 21 alternating samples, median
4.9320 ms baseline versus 0.1301 ms new. Final MA/EMA arrays matched in this workload;
30 notifications were emitted. Initial history computation is outside both timings.
This measures core work, not renderer, browser FPS, native device, GC or network.

Existing loader, normalization, cache, replay and waiter tests pass (132 tests),
with scoped lint and the package build/consumer validation. No new test case or
pipeline is added; the opt-in sink has manual workload validation and independent
review, not a dedicated automated regression suite yet. No package publication.

A manual loader/coalescer integration run applied 300 quotes in one frame,
emitted one tail notification, and ended with 329 bars from 300 initial bars.
Disposal left zero timers, frames and environment listeners.

Independent review found stale cached history availability; the fix forwards fresh
availability with cached tail batches. Manual loader flow observed cached false ->
fresh true and one new older-history request. Final review: no remaining confirmed findings.
