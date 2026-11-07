# Browser validation migration to the owned engine

The owner chose the new `EngineChart` / `ChartWorkspace` API and a migration guide, rather than a compatibility facade for the old Pro and upstream-engine APIs. The maintained browser suite exercises the built owned package. No new test cases, snapshot baselines or CI pipeline were invented. Existing cases and assertions were migrated or restored from the original suite.

The previous suite defined **175 unique cases**. Its two full upstream-version projects plus one four-case lifecycle leg expanded that to **354 scheduled cases**. The owned configuration selects **70 migrated existing cases in 13 files, once**. Three initially excluded cases were restored with the corresponding owned features. This is an inventory comparison, not a measured speedup or a claim of identical feature coverage.

**105 old case contracts are no longer executed:** 78 remain in 12 excluded legacy spec files; 27 were retired while their mixed suites were migrated. The files and legacy helper pages are retained for review. Excluded tests are not counted as passed. Some old cases covered intentionally removed functional APIs, not merely appearance. The broader Node unit suite remains separate.

## Maintained cases

| Suite | Before | Owned | Preserved behavior and removed contracts |
| --- | ---: | ---: | --- |
| `analysis-overlays` | 5 | 4 | Optional order-block/FVG layers, previous-day levels, pan/zoom and removal. Removed the old searchable indicator-picker contract. Analyses now attach through their optional module. |
| `api-core` | 5 | 5 | Load promises, coalesced market changes, invalid periods, JSON state, visible data, search retry and container resize. Invalid periods throw instead of returning the old error object. |
| `chart-interaction` | 17 | 9 | Wheel zoom, keyboard navigation, host input isolation, follow latest, scale controls, keyboard symbol selection/Escape and type-to-search. Restored timestamp-selected replay and live countdown progression/independence from drawing deletion. Replay selection now uses `startReplayAt`, without the old armed pick UI. Countdown is independent workspace chrome and hides during replay; old last-price-style coupling is not retained. Old legend colours/icons, exact pane ratios, screenshot filename and hover contracts remain unexecuted. |
| `commands` | 8 | 5 | Type/market/indicator operations, replay, future drawing projection, drawings during replay and market-scoped drawings. Uses direct owned methods. Removed generic command-palette, drawing-cross alert and `drawingLevelsAt` query contracts. |
| `drawing-editor` | 1 | 1 | Lock/visibility, immutable anchors, JSON restoration, actual Delete/Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y and inline note creation/Enter/double-click/Escape without `window.prompt`. Those shortcut/text assertions were restored from the existing helper. The old wrapper ran 101 editor state checks; this migration does not retain all of them. Per-drawing colour/font controls, duplicate/copy/paste/nudge, context-menu and objects-panel contracts remain unexecuted. |
| `drawing-input` | 1 | 1 | Actual segment creation and Escape cancellation, plus the original create-once/zero-removal and selected-on-completion brush assertions. Magnet, stay-mode and old rail/hotkey contracts remain unexecuted. |
| `indicators` | 5 | 1 | Removing one indicator does not remove a separate host instance. Old checked picker rows, settings gears, search and name-routing aliases are retired; the new API intentionally allows explicit multiple instances. |
| `interaction` | 4 | 3 | Period controls, live updates and numeric Fibonacci levels. Removed old Settings/Restore-default UI and exact formatted Fibonacci labels. |
| `lifecycle` | 4 | 3 | Repeated disposal/remount, rejecting mutations after disposal, enum validation. Removed monkey-patching upstream `dispose`, old error-class/metadata text and theme fallback contracts. |
| `loader` | 18 | 16 | Stale loads/ticks, same-tick coalescing, unchanged market reuse, range math, dedup/paging, retry, empty/live transitions, batching, replay, gap filling and sparse feeds. Removed upstream synchronous short-page paging and deprecation-log contracts. Explicit older-page requests remain. Old spinner/empty wording, `dataStates` presentation and autoplay button/timer assertions are removed. |
| `motion` | 17 | 12 | Cursor-anchored zoom, optional inertia, hold/reduced-motion suppression and eight existing chart modes. Removed exact tween timing, private custom-series overlay identity, High/Low tag styling, clock wording and favourites menu. Mode names use the new hyphenated values; Heikin Ashi is a view mode. |
| `smoke` | 3 | 2 | Built ESM and UMD mount, data and canvas lifecycle. Removed comparison of side-effect registration in a global upstream overlay registry. |
| `superscript` | 9 | 8 | Coexisting lines/MA, zero-baseline histogram, nonfinite gaps, symbol changes, parameter updates, invalid source, builtin-name protection, bounded AI chart context and the existing Studio formulas. Removed exact legend formatting, pixel colour counts and arbitrary-language registration. Source editing requires explicit replacement via the new API; the parameter case does not claim old in-place source replacement. |

## Retained legacy files excluded from the owned run

| File | Cases | Reason |
| --- | ---: | --- |
| `bundle.spec.ts` | 2 | Old webpack size budgets and global overlay side effects. Owned package import/build checks are handled by package validation. |
| `chrome-layout.spec.ts` | 21 | Old Pro popovers, menus, responsive rail, fullscreen selectors, feature-part flags and exact CSS layout. Owned controls, search and resize are covered above; fullscreen is available through native workspace controls, but these old selectors/contracts are not claimed as migrated. Full legacy chrome parity is not claimed. |
| `chrome.spec.ts` | 11 | Font, hover colour, token border/shadow/radius and old modal stacking expectations. |
| `entries.spec.ts` | 1 | Removed lite entry and shared upstream registry/image-figure escape hatch. |
| `i18n-a11y.spec.ts` | 9 | Legacy locale registration, timezone popover and forced-colour styling. Named native controls remain; complete localization and accessibility parity with the old UI is not claimed. |
| `legend-format.spec.ts` | 2 | Exact old legend formatting and version-specific tiny-price folding. |
| `motion-layers.spec.ts` | 8 | Private upstream time-scale/canvas tracing and template overlay hooks. Public owned pan/zoom and inertia contracts migrated above; the old per-layer hook checks are not reported as passing. |
| `script-indicator.spec.ts` | 1 | Duplicate two-line crash contract against old upstream versions; the creation-order and Studio-formula cases remain. |
| `style-stack.spec.ts` | 12 | Upstream style merging/recreation hooks, fixed fonts/colours and old theme overlay contracts. |
| `theme.spec.ts` | 3 | Light/dark presentation and canvas colour assertions. |
| `toolbar-host.spec.ts` | 5 | Removed header-slot/compact toolbar and indicator-badge presentation. |
| `watermark-and-text.spec.ts` | 3 | Removed watermark node/string API. Its old injection case does not validate any new text-bearing API. |

## Running

Build the root package, then run `bun run test:browser` from `e2e`. The existing Playwright version and installed Chrome are used; do not download browser binaries. The E2E lock now contains only Playwright and its dependencies, with no upstream engine aliases or webpack. The static harness imports the built owned ESM/UMD and optional script/indicator/overlay modules; it does not provide a fake old API.

OHLC inputs in a few migrated live-feed cases now include coherent high/low bounds. Their previous close replacements lay outside the candle's high/low. The owned engine's validation is preserved; malformed data is not accepted to make the migrated cases pass.

## Validation performed for this migration

The initial 67 distinct maintained cases passed in targeted batches. The initial histogram adapter used the wrong pane identifier, then mixed global pane offsets with local scale coordinates; these migration errors were corrected and that case alone rerun. No source error was suppressed. After the final workspace count changes, the affected existing API/loader/replay set passed again: 21/21. The terminal's `FORCE_COLOR`/`NO_COLOR` warnings remain; this is not a warning-free claim.

A separate temporary browser observation loaded 100,000 synthetic bars through `ChartWorkspace` and its actual `DataLoader`, then applied 100 tail ticks with frame waits. It observed 100 data events, one subscription, unchanged bar count, the expected latest close, and zero full-history `Array.map` or full-history `slice` calls during that live phase while reading replay counts. This is bounded instrumentation, not a permanent test, a production throughput guarantee, or proof that every operation avoids copying.

Independent review found no blocking issue in this migration. The optional-overlay attach/pan and previous-day-level cases retain their original smoke-test intent; they do not prove complete numeric or pixel parity with the retired engine.

The complete 65-tool catalog has since been restored in the owned drawing model,
geometry and input layer; see `docs/OWNED-DRAWING-CATALOG.md`. That catalog has
separate bounded real-browser creation, serialization and numeric observations.
It is not represented as 65 new browser test cases. Against the final built
package, both existing drawing wrappers passed again with their restored brush,
keyboard-history and inline-text assertions (2/2, 3.2 seconds). These checks do
not make the remaining old editor UI contracts passed or prove pixel parity.

The affected existing period/live/Fibonacci file was also run. Its period and
live-feed cases passed, while the previously migrated Fibonacci expectation
still used the early owned engine's reversed anchor convention. The original
case explicitly made the first anchor 100%; the migrated numeric expectation
was corrected to retain that behavior and the original two-decimal numeric
precision. Only that failed case was rerun, and passed. The renderer was not
changed to satisfy the old incorrect expectation.

The restored chart-interaction file now contains nine existing cases, all of
which passed across targeted runs. Its first full run passed eight and failed
the wheel case because loaded data had not yet produced the initial painted
frame. Waiting two animation frames after initial loading synchronized that
existing input check, and the wheel case alone passed. A later attempted
geometry-counter readiness alternative failed because it could count an empty
frame; the exact already-passed two-frame synchronization was restored. No
runtime behavior or assertions were weakened to make that check pass. This is
not a fresh single-run nine-case aggregate or a rerun of the entire 70-case
suite. Keyboard search, type-to-search, timestamp replay selection and the
countdown were checked against the final built package. Countdown assertions
check progression and lifecycle, without requiring particular English wording.
