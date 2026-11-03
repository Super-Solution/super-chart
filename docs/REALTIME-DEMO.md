# Interactive shared-core demo

Run the existing `bun run dev` command and open `/demo/realtime.html` on the local
Vite URL. The root KLineChart demo now links to this separate page; its engine and
existing SuperScript example are unchanged. This is a development page, not part
of the library build's published output and not a deployed application.

The page demonstrates the previously added shared APIs together:
DataLoader -> RealtimeSeries -> RealtimeView -> createRealtimeChartFrame.
A small host-owned Canvas renderer consumes the shared geometry. It does not
replace the production KLineChart or React Native renderer.

## What can be used

- Initial 20,000 generated one-minute candles; 500-candle older pages, bounded by
  a total 25,000 historical candles before simulated future updates.
- Start/pause synthetic live updates, or send a 300-quote burst through the actual
  DataLoader frame coalescer. Every ten burst quotes advances one candle.
- Drag, left/right keys and anchored wheel zoom; buttons also provide zooming.
  Touch supports one-pointer dragging, not a new multi-touch pinch implementation.
- Follow latest, jump to the nearest loaded local time, raw/Heikin Ashi display,
  time/equal-bar spacing and MA20/EMA21 visibility.
- Cursor inspection uses a separate Canvas overlay and the existing frame. Pointer
  movement does not rebuild the price model. Backing Canvas buffers resize only
  when dimensions change; CSS/logical positions are converted using devicePixelRatio.
- Dispose stops the feed timer, pending draw, subscriptions, ResizeObserver and
  event handlers. Controls disable; New session reloads the page. A pagehide/HMR
  cleanup uses the same disposal path. A restored disposed page needs New session.

All prices are generated locally. No provider, wallet, model, credential or external
API is called. HA readouts are labelled synthetic; indicators always use raw closes.
The page does not produce a transferable quote, transaction, published package or
production deployment. Its UI is demonstration-only; it has no persisted settings.

## Validation performed

An explicit local TypeScript check included this demo plus existing src files.
Manual installed Chrome 156.0.8078.80 interactions at 1280x1000, DPR2 and a resized
390x844 viewport exercised initial load, burst, HA/readout, drag, wheel zoom, history,
spacing/indicator toggles, seek, follow, live/pause, resize and dispose.
No page errors were recorded.

The burst produced one additional notification and one main draw, increasing
20,000 to 20,029 bars. History added 500 rows while pinned; the displayed inspected
time remained unchanged. Disposal disabled all eight buttons and the metrics stayed
unchanged after waiting. This observes stopped UI activity; it is not a heap/leak
profiler or a React Native device run.

The displayed model+draw median was about 0.5-0.9 ms during this local interaction
sequence (initial sample 2.8 ms). It is a rolling 200-sample local diagnostic, excludes
browser compositing and is not FPS or a before/after production benchmark.
Independent source review found no confirmed issues. No tests, screenshot assertions,
fixtures, pipelines or runtime dependencies were added. Existing library package
consumer checks are retained; no size threshold is changed.
