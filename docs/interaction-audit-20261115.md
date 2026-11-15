# Interaction and viewport audit — 2026-11-15

Scope: the owned engine in this repository. This is a runtime change and engineering inventory, not a new test suite, assertion set, snapshot baseline, fixture or CI workflow. The SupWallet monorepo and published packages are unchanged.

The inventory contains **15 actual improvement opportunities and 30 concrete details**. Items 1–6 and 14 are implemented in this round (items 6 and 14 are the parent task's chart integration); items 7–13 and 15 are source-confirmed gaps or costs, explicitly **not implemented**. Existing safeguards are documented separately and are not counted as improvements. No end-to-end speedup is claimed from an isolated core measurement.

## Improvement inventory

| # | Improvement / status | Detail A | Detail B |
| --- | --- | --- | --- |
| 1 | Reuse sampled data during fractional movement — implemented | `RealtimeView._read` keeps frozen bar and indicator arrays when floor/ceil sampling bounds stay unchanged, avoiding repeated copies of the same visible candles. | Reuse requires the same series version and candle mode; changed data, integral sample range or mode resamples. This removes redundant sampling rather than caching stale prices. |
| 2 | Bound zoom consistently — implemented | Optional `ViewportLimits` is used by discrete and continuous helpers and by view construction, programmatic navigation, follow and limit changes; previously loaded history was the only upper bound. | Core/native defaults remain 12 bars through loaded history. Web now defaults to 20–1200 with host overrides; short histories can show fewer. The latest-view helper retains the newest right edge when the maximum caps a requested count. |
| 3 | Smooth wheel zoom and immediate reversals — implemented | Wheel input updates a bounded target, then time-based exponential easing interpolates candle spacing multiplicatively instead of jumping straight to every event's result. | Targets clamp before accumulation. Direction reversal starts from the visible viewport, avoiding a backlog at zoom limits; reduced motion settles on the next frame. |
| 4 | Stabilize release velocity and coast — implemented | Release velocity uses elapsed-time smoothing instead of the last event alone; direction changes and pauses remove stale velocity. | Owned Web enables configurable inertia by default, with exponential deceleration, bounded duration and edge stops. Motion no longer ends abruptly at every release; reduced motion disables coast. |
| 5 | Preserve final drag position and interrupt smoothly — implemented | Pointer-up consumes its final coordinate if it differs from the last move event, fixing devices that deliver the final drag segment only on release. | A new pointer/keyboard interaction cancels an unfinished wheel ease at the visible viewport rather than jumping to an unseen target; the current view becomes the starting point of the next gesture. |
| 6 | Invalidate only the necessary chart work — implemented by parent; reviewed | `chart.ts` detects viewport identity changes even when sampled arrays are reused, so fractional motion still rebuilds geometry correctly. | A repeated cursor X no longer schedules another cursor update. View/data notifications continue to refresh the cursor, so unchanged mouse coordinates do not suppress live-price changes. |
| 7 | Support horizontal trackpad navigation — not implemented | `gestures.ts` reads `WheelEvent.deltaY` only; horizontal `deltaX` motion cannot pan the time viewport. A directional wheel policy could make two-axis trackpads usable without a mouse drag. | Mixed-axis input needs an explicit axis-lock or modifier policy, with the same bounds and gesture interruption behavior; simply treating all diagonal movement as zoom would remain surprising. |
| 8 | Add a distinct time-axis scale interaction — not implemented | `paneInteraction.ts` identifies only pane separators and the left price axis. It already supports price scaling and double-click reset; this is specifically a missing horizontal time-axis drag-to-zoom interaction. | A time-axis hit area could offer drag sensitivity and reset without competing with plot panning or drawing selection. The current generic gesture path treats its horizontal drag as pan. |
| 9 | Allow bounded future whitespace — not implemented | `clampContinuousViewport` restricts the right edge to `length - 1`; users cannot pan the latest candle left to leave space for projection or annotations. | A right-offset policy should keep loaded candle sampling separate from virtual empty slots and never synthesize prices or imply future market data. This requires a coordinated core/projection change. |
| 10 | Provide navigation back/forward — not implemented | `RealtimeView` offers pan, zoom, seek and follow but retains no viewport navigation history. Existing drawing undo/redo is separate and must not be presented as viewport undo. | A small bounded history committed at gesture end could restore accidental zoom/seek positions without storing every animation frame; history must be rebased or reset when symbol/history changes. |
| 11 | Reduce high-rate pointer event overhead — not implemented | `movePointer` reads `getBoundingClientRect` on every event and builds a position from the pointer map; delivered event frequency can exceed frame frequency even though rendering is coalesced. | No `getCoalescedEvents` path exists. Frame-scoped bounds caching/coalescing may reduce work, but must preserve final coordinates and pinch/capture transitions, and should be justified by browser measurements. |
| 12 | Make inertia respect real elapsed time through stalls — not implemented | Coast advancement still caps one elapsed step to 50 ms. A heavily stalled foreground frame makes the simulated coast last longer in wall-clock time. | Absolute-time displacement/decay could avoid delayed momentum after long frames; it should retain immediate hidden-tab cancellation rather than trying to animate through a suspended page. |
| 13 | Derive readable density from plot width — partially addressed, adaptive policy not implemented | The new Web min/max count prevents arbitrary zoom density, but 20–1200 remains a fixed bar-count range across narrow and ultrawide plots. | Hosts could choose limits/opening count from minimum readable candle spacing and available plot width, without resetting a deliberately pinned viewport on every resize. Renderer candle-body widths are a separate change. |
| 14 | Remove full-history validation from pane drag hot paths — implemented by parent; independently reviewed | `setLayout` now revalidates stored candles only when the effective price-scale mode changes. Pane weights, axis range and reversal keep their layout/range validation without rescanning unchanged OHLC on every pointer move. | The series is private, public data-port writes delegate to validated ingestion, public bar reads return copies, and configuration restore validates before mutation. `setData`, `update`, `prependData` and `updateBatch` still validate under the current scale; entering log/percentage mode still performs the full price-domain check before applying the new layout. |
| 15 | Add deliberate touch inspection behavior — not implemented | A touch in the plot starts navigation immediately, and pointer-up clears the cursor for non-mouse pointers. There is no persistent touch inspection/long-press mode in `gestures.ts`. | A deliberate inspection mode could keep a crosshair and values visible after release while allowing pinch/pan to take ownership predictably; it must remain distinct from the existing drawing selection/edit gestures. |

## Existing safeguards retained, not counted above

- Pointer cancel, capture loss, blur, hidden document, Escape and disposal clear active input. Frame validity still rejects stale geometry, history length or externally changed viewport.
- Drawing and pane gestures retain ownership/cancellation hooks. Editable controls, composing keyboard input and native platform gestures remain separate.
- Beginning-of-history navigation still uses the existing load-more API. A pinned viewport stays pinned until explicit follow; no network transport was added.
- OHLC normalization, indicator formulae and transaction/signing code were not changed by these gesture/view edits. This is a source-level boundary observation, not a claim of newly executed financial-parity tests.

## Bounded before/after observation

An inline local Bun observation used the same 100,000 synthetic OHLC bars, `RealtimeSeries({ referenceIndicators: false })`, a continuous `RealtimeView` of 1,000 bars and five rounds of 2,000 fractional viewport updates. Every update stayed within the same floor/ceil sample bounds. A temporary in-memory wrapper counted calls to `series.snapshot`; no product fixture, assertion or test file was created.

- Before, elapsed milliseconds by round: 474.2339, 460.6057, 457.7147, 459.4220, 458.2367. Median: **459.4220 ms**. Snapshot calls: 1,999 in the first round and 2,000 in each later round.
- After, elapsed milliseconds by round: 1.9054, 1.2032, 1.2079, 1.2303, 1.2660. Median: **1.2303 ms**. Snapshot calls: **0 per measured round** after the initial sample.
- This demonstrates removal of redundant sampling/copying in this particular same-sample navigation case. It is **not** a 373× chart/FPS improvement, a complete browser benchmark or a general result for viewports crossing sample boundaries.
- A bounded manual readout after setting limits to 20/1200 showed spans of 20 and 1200 for extreme zoom-in/out inputs. It used no assertions and does not replace browser interaction verification.

## Validation and review status

- Read `AGENTS.md` and `MAINTAINING.md`; no new tests, assertions, fixtures, snapshots or CI pipelines were added by this work.
- The existing complete TypeScript command was attempted once with cached TypeScript 4.9.5. It failed in the chat-plugin graph because `@supersolutions/super-protocol` is not installed, plus related unresolved-type errors. No error was reported in these four runtime files. The full repository check is **not** reported as passing.
- The UI agent is handling a focused existing compiler check for the available core/Web/SuperScript graph; its result belongs in the combined report. The full command was not retried.
- Focused source review of `chart.ts` confirms viewport invalidation, Web defaults and inertia wiring. An independent agent reviewed the four runtime files below plus the viewport invalidation integration and reported zero confirmed material findings. Final browser outcomes should be appended by the parent task.

- After the layout-validation delta, an independent source review found no confirmed material issue. The existing TypeScript 4.9.5 compiler was run with `chart.ts` as its entry under the existing tsconfig: **55 reachable runtime files, 0 diagnostics, exit 0**. This checks the affected chart dependency graph, not the unavailable plugin or browser behavior.

## Changed runtime scope

- `packages/core/src/viewport.ts`
- `packages/core/src/continuousViewport.ts`
- `packages/core/src/realtimeView.ts`
- `packages/bindings/web/src/gestures.ts`

The parent task also changes `chart.ts`, renderer and workspace UI files. This document distinguishes those integration changes from this subtask's edits. No push or publication was performed.
