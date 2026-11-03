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
- Drag, two-pointer pinch/centroid pan and anchored wheel zoom; buttons also
  provide zooming. Releasing one finger rebases to a one-pointer drag without
  changing the zoom. Left/right keys pan; Page Up/Down pan most of a window;
  +/- zoom; Home follows latest; Escape cancels the current gesture.
- Follow latest, jump to the nearest loaded local time, raw/Heikin Ashi display,
  time/equal-bar spacing and MA20/EMA21 visibility.
- Cursor inspection uses a separate Canvas overlay and the existing frame. Pointer
  movement does not rebuild the price model. Cursor paints coalesce to one per
  animation frame using the latest position. Backing Canvas buffers resize only
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

## Gesture adapter follow-up

Web pointer handling now lives in demo/gestures.ts rather than the data/render host.
It keeps at most two captured pointers, rebases when a finger joins/leaves or the
loaded length/plot geometry changes, and converts wheel pixel/line/page units.
It uses the existing core viewport math; it is a Web demo adapter, not a replacement
for React Native gestures. Uniform synthetic candle spacing is the demonstrated
interaction case, not arbitrary gapped-market gesture calibration.

Pointer cancel, lost capture, element/window blur, background visibility and Escape
clear the active gesture. Disposal removes the adapter listeners and cancels the
pending cursor frame. Independent review found the initial missing window-blur
cleanup; this was fixed before submitting the PR.

Manual Chrome touch input (trusted browser pointer events) narrowed 160 candles to
80 during pinch, translated with two fingers, then emitted pointerup for the second
finger and continued dragging with the remaining finger while staying at80. The
initial driver probe omitted a touch from touchMove, which is not a release; the
final probe explicitly used touchEnd and verified the resulting pointerup.
Keyboard Home/PageUp/+/Escape and mouse drag were exercised. A dispatched window
blur followed by mouse movement left notification/draw counts unchanged. A burst
of120 synthetic hover events caused one cursor-layer clear in the next frame.
These are bounded manual browser observations, not a new automated regression suite
or physical-phone/pinch latency measurement. No page errors were recorded.

## Canvas boundary, inspection work and PNG export

The Web-only `demo/canvasRenderer.ts` accepts prepared shared geometry and owns
painting/PNG encoding, without feeds, subscriptions or gesture state. The candle
and indicator drawing order is unchanged; no speculative batching was introduced.
React Native keeps its own renderer. This module is not a new published package API.

Cursor inspection now skips clearing, painting and formatting when both the frame
and inspected candle are unchanged. New data, options or dimensions produce a new
frame and invalidate that reuse. Leaving the chart clears the overlay and readout.

Export PNG captures the current chart layer at its DPR backing resolution, with an
opaque background. It excludes the cursor overlay and external readout/controls.
A queued viewport update is painted before capture. Encoding operates on a separate
canvas, so subsequent live updates or resize do not change the captured image.
The filename identifies raw/HA synthetic candles; this is an offline demonstration,
not export of real market data. Disposal during encoding suppresses the download.

Manual installed-Chrome observations at 1000x900, DPR2:
- Same candle, 60 pointer events over separate animation frames: main baseline
  cleared the cursor 60 times; this change cleared it 0 times after initial hover.
  Moving to a different candle caused one clear and changed the readout.
- Export in HA mode downloaded a PNG with 1904x884 pixels, matching the backing
  canvas, with an opaque background. Resize to390px, burst/live-data delivery and
  disposal worked without page errors. This is not a native-device/FPS benchmark.
- Existing TypeScript configuration, extended locally to include the demo, passed.
  Independent source review found no confirmed issues. No tests, fixtures,
  snapshots or pipelines were added; unchanged core/package checks were not rerun.
