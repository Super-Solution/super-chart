# Draw by holding — 0.0.39

Source base: `bc9483b38681fff3f83dd95079dd8451d6bad18c` in
`ZzyzxLabs/zzyzx-full-repo`. The bounded change owns Super Chart's gesture
controller, recognition, guide, native editor transactions, option wiring,
tests and package documentation. It does not change SupWallet/Broker clients,
wallet vendor pins, contracts, credentials, release workflows or deployments.
The Trading Project consumer separately pins the private build tarball.

## API and behavior

`new SuperChart({ ..., drawByHolding: true })` opts in. An object accepts
`delayMs` (333 by default, bounded to 150–2000 ms) and `guide` (true by default).
Omitting the option keeps existing interaction. The help button opens on
request; closing it writes no storage. Recognition uses bounded CSS-pixel
geometry locally, with no model call, server or backend dependency.

Trend/ray/horizontal/vertical/rectangle/ellipse/Fibonacci/path/arrow become
native user drawings. Tab changes the latest reading, Shift+Tab goes back,
and Escape removes it through drawing history. Every replacement/removal is
undoable. History, another selection or press, tools, symbol/period changes
and cancellation invalidate the temporary affordance. A quick drag retains
native pan. A stroke crossing actual visible/unlocked user geometry can erase
several drawings in one history action; host annotations and locked/hidden
drawings are excluded again at the mutation boundary.

The klinecharts compatibility seam is deliberately isolated: `ChartImp` has
`_chartEvent`, whose `Event` owns `_event` (`SyntheticEvent`). After holding,
only its click/tap flags and long-tap timer are cancelled. Native release is
left alone to clear pressed state and root listeners. Supported shipped
9.7.2 and 9.8.12 implementations are exercised directly in non-browser tests;
unknown peers fail closed rather than enabling an incomplete hold path.

0.0.37 limits result shortcuts to the plot, exact chart root or dispatcher-owned
default document focus. Native/ARIA controls, editable fields, toolbar/Objects
content and their SVG descendants yield normal keys. Captured document presses
and focus changes invalidate old candidates before chart chrome can navigate;
returning to the plot cannot revive them. The guide's scroll height is bounded
by its chart container as well as the viewport, keeping Got it reachable in a
short embedded chart.

0.0.38 uses the chart's existing popover layer for guide controls, above native
pane dividers. Consumer CUA inspection found a divider at z-index 20 receiving
clicks meant for Got it while the old guide was at 10. The existing popover
token is 99 and remains within the chart root's stacking isolation.

0.0.39 compacts only the build representation of the three locale tables:
shared keys use consecutive common prefixes, and each language retains its
complete string row. The authored JSON, public lookup/registration behavior,
hold gesture modules, drawing editor, toolbar and CSS stay unchanged. Built
dictionaries use the shared English key order; every key, translation,
placeholder and explicit empty value is retained. This is synchronous and
adds no lazy chunks or network work. The production webpack root drops from
551,929 to 539,845 bytes, below its existing 540,000-byte limit; the unchanged
lite entry is 2,726 bytes, for 542,571 bytes across the two emitted assets.

The optimization passed 105 files / 1,606 unit tests, including seven new
locale regressions. Deliberately decoding rows in each dictionary's own key
order and removing the own-key guard each failed their corresponding tests;
the helper was restored byte-for-byte before the final full suite. Independent
packed-runtime verification compared all 939 translations and 939 lookups,
host overrides, immutable English fallback, empty overrides and formatting.
That source-only 0.0.39 candidate did not refresh the wallet vendor package;
its remote CI passed the chart suites and then refused the missing 0.0.39
tarball. The convergence below completes that separate consumer requirement.

## Main and wallet convergence (0.0.40)

Existing PR #1062 normally merges main `95985a1ae3873f765aa9dd8edc20745854798b15`,
including merged #1047/#1064/#1065. It retains the bounded harness startup
diagnostics and all Harness/Vibe changes, restores the 540,000-byte production
bundle gate and repacks version 0.0.40 for SupWallet. The version bump prevents
reuse of a cached private 0.0.39 tarball. The wallet's artifact, SHA guard,
manifest, lockfile and provenance must change together; source byte parity
remains mandatory. Broker's registry pin and all activation/signing gates
remain unchanged. This source change itself publishes no registry or cloud release.

Convergence validation on the committed package source
`ee89af4e56ff51c49e093b183ae32873cf171497`:

- Frozen source/e2e and clean wallet installs passed with lifecycle scripts and
  browser downloads disabled. Actual wallet installation resolves 0.0.40;
  all 297 installed package files match the new artifact.
- All 105 files / 1,606 unit tests passed; lint has zero errors / 367 existing
  warnings under the unchanged 380-warning ratchet. Private guard/selftests
  and the 14 package-check selftests passed.
- ES/CommonJS/UMD/declarations and consumer package checks passed:
  297 files / 742,689 packed bytes under the unchanged 775,000-byte gate.
- The existing bundle specs passed all four tests in installed Chrome on
  klinecharts 9.7.2 and 9.8.12: production root 539,845 bytes, lite 2,726.
  Every extension overlay registers. Full browser-suite execution remains
  a separate CI result; the local four-test run is not that claim.
- Source-to-vendor and clean-install byte parity passed. Packed-runtime checks
  compared all 939 translations and 939 lookups, plus host overrides, empty
  strings, immutable English fallback and formatting. Vendored gate and all
  five mutation selftests passed; the full wallet Web typecheck passed.
- Artifact SHA-256:
  `2fb01f48d2ca7b960652442ad10bb078967bb93c3143666ceaf6c11158306c2c`.
  The superseded 0.0.38 file was removed only after absolute-path, old/new hash
  and new source-byte parity checks; its bytes remain recoverable in Git.

## Verification evidence

- Frozen source dependency installation passed. Existing `e2e` dependencies
  were also installed frozen because the pre-existing legend unit regression
  imports its 9.7.2 alias. No Playwright/browser runner was invoked.
- `node node_modules/vitest/vitest.mjs run`: 104 files, 1599 tests passed.
  The hold feature contributes 52 tests, including actual shipped native
  mouse/touch lifecycle code on both peer versions, pointer timing and
  cancellation, chart context, recognition, geometry and editor history.
- `bun run lint`: zero errors, 367 existing warnings within the 380-warning
  ratchet. New `src/draw-by-holding` files pass `--max-warnings 0`.
- Type checking passed. The full build includes declaration generation and
  the consumer-oriented package checker (ES/CommonJS exports, CSS scope,
  standalone imports, packed files and consumer declarations).
- Package-size budget increases from 740,000 to 775,000 bytes for the new
  recognizer/controller/guide across ES, CommonJS and UMD builds (~760 KB
  actual). Source-map, external-import and CSS-scope gates remain enabled.

The original three 0.0.36 mutations and the new 0.0.37 focus mutation were
executed one at a time, then restored:

| Mutation | Relevant test result |
| --- | --- |
| Default hold delay 333 → 100 ms | timing gate failed: 1 failed, 13 passed |
| Quick-pan cancellation threshold 5 → 50,000 px | immediate drag/pan regression failed: 1 failed, 13 passed |
| Remove user/lock/visibility guard from gesture erase | protected eraser batch failed: 1 failed, 13 passed |
| Remove the hold key's control/plot focus guard (0.0.37) | control navigation, plot ownership and text-entry tests failed: 3 failed, 13 passed |

The final full suite above was rerun after restoring all mutations. Local
logs are task evidence, not packed files. Independent review covered the
controller, native adapter, editor history and safety boundaries; the
recognizer author's self-review is identified separately. Consumer browser QA
checks actual gestures and control navigation separately. Non-browser timer
and native-peer tests do not establish precise physical 333 ms timing.

## Consumer delivery

Commit source before `npm pack --pack-destination <consumer>/frontend/vendor`.
Pin the source SHA, version and tarball SHA-256 in the consumer's vendor
README, update its exact file dependency and lockfile, and retain exactly one
Super Chart tarball there. This task publishes no registry package or mirror
tag, merges no upstream branch and changes no other consumer. App activation
is opt-in; read-only/AI scene charts should leave it disabled. Rollback is the
previous consumer file pin, with its matching lockfile.
