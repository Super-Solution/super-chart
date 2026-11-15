# Startup and local dependency follow-up — 2026-11-15

This follow-up addresses the initial-load result and missing development dependency
reported in PR #23. It does not add tests, assertions, fixtures, snapshots or CI.

## First-load work removed

- Native MA, EMA and RSI rows now use fixed property shapes for their usual field
  names. The prior dynamic property allocation was particularly costly before V8
  had optimized the loops. Formulas, nulls, seeding, last-bar checkpoints and
  alternate SuperScript kernel keys are unchanged.
- The closed indicator menu updates its count without building every hidden
  editor. It builds the current registry and editor rows when opened and keeps
  unchanged drafts on subsequent close/open. Initial duplicate options were removed.
- The manual demo distinguishes module load, synchronous construction, data-ready
  and first paint observation. The older `constructReadyMs` was navigation-relative,
  not an elapsed constructor duration. Historical samples are retained rather than
  relabeled as measurements they never made. No production profiling hooks remain.

## Browser observations

Fixed before: `255a00497881fde66647798fafa1e8482d563a0a`.
After: this follow-up's literal-row and lazy-editor source.
Same IAB tab, 1280×720, DPR 1, visible, 50,000 synthetic bars,
MA/EMA/BOLL/VOL/RSI, three alternating before/after pairs. Each navigation creates
a new workspace; the browser process, JIT and caches were not independently reset.
There was one geometry build and one plot paint in every first-frame observation.

| Pair | Navigation-to-paint proxy before / after, ms | First data frame CPU before / after, ms | Constructor-to-ready before / after, ms |
| --- | --- | --- | --- |
| 1 | 497.4 / 107.7 | 30.0 / 20.4 | 31.4 / 35.7 |
| 2 | 97.9 / 83.8 | 27.8 / 19.4 | 26.8 / 24.1 |
| 3 | 87.3 / 79.2 | 26.1 / 18.7 | 24.2 / 23.7 |
| Median | 97.9 / 83.8 | 27.8 / 19.4 | 26.8 / 24.1 |

First-frame CPU median improved by about 30%; the navigation proxy median by
about 14%. The 497.4ms outlier is retained: its recorded module load was 11.8ms,
constructor-to-ready 31.4ms and ready-to-paint 33.1ms, so most of that sample
preceded the measured library work. These are local observations, not a guaranteed
cold-network loading speed or a comparison against KLineCharts/TradingView.
The before/after history-generation medians were 15.3 / 14.9ms; module-load medians
were 11.8 / 12.2ms. The improvement is chiefly first-frame CPU, not downloaded bytes.

Fresh Node processes also exposed a regression hidden by warmed timings:
the 50k/five-indicator cold-compute median was 32.8005ms before and 23.5605ms after.
This isolated measurement does not include browser layout, paint or downloading.

Manual UI observations: zero indicator editor rows before first opening, five
after opening; an unsubmitted MA parameter of 25 survived closing/reopening.
Applying it updated the displayed configuration to MA 25; adding MACD updated
the summary and list to six indicators.

## Real protocol dependency

The chat plugin still declares the actual `@supersolutions/super-protocol@0.1.0`.
Both that name and the former singular-scope candidate returned 404 from the
official npm registry during this work. The canonical source is the sibling
super-chat repository's `packages/protocol`; its package manifest and documentation
agree on the plural scope. No package was published and no dummy declarations
were substituted.

`npm run setup:local -- ../super-chat` builds and packs those real sources using
their official build configuration, then installs the resulting package and this
workspace's tools. It preserves the sibling checkout, public dependency manifests
and registry lockfiles, records the source commit/integrity locally, and keeps
generated files under ignored `.local-deps`. A fresh development checkout needs
access to that real source until the protocol is published; this does not make
the public registry dependency available.

The protocol source used here was commit
`cce6aec680d7a59cfdf8530ba455d3f2c959923a`, with a clean protocol source directory.
Its real ESM and declaration build completed. A damaged existing C-drive npm
cache interrupted the first root-tool installation; the retry uses a D-local
cache and did not delete the C cache.

Windows declaration generation now launches the installed JavaScript CLI through
Node instead of trying to execute the extensionless Unix npm shim.

## Completed validation

- Real protocol build and local workspace setup completed; no stub or registry
  manifest rewrite was used. Successful generated protocol staging was removed,
  leaving the installed package, small tarball/source receipt and D-local npm cache.
- `npm run typecheck`: passed for the complete public runtime graph, including
  the chat plugin and its real protocol types. Explicit `types: []` prevents
  unrelated automatically installed Node globals from contaminating the portable
  runtime; strict mode and `skipLibCheck: false` remain enabled.
- `npm run build`: all four packages' ESM and declarations, both Web global
  entries, and package checks passed. Dry-run packed totals: 38 files; rounded
  compressed package sizes core 136kB, SuperScript 41kB, Web 191kB, plugin 18kB.
  This is a local build, not a release or publication.
- `npm run lint`: 81 runtime files, zero errors and 146 warnings, exit 0.
  The existing 380-warning budget and all rule severities are unchanged.
  Forty existing errors were fixed using only severity-2 format fixes in four
  runtime files; warnings were not mass-rewritten.
- Relevant existing TA cases: 51 passed after the literal-row change.
  A bounded in-memory observation compared 240,011 numeric fields over eight
  initial/update/correction/prepend/truncate/alias scenarios with zero differences.
  No test cases or assertions were added. The prior 187-case integration result
  remains in the earlier report; the full suite was not unnecessarily repeated.
- Independent review of runtime changes, timing, setup, type configuration and
  Windows tooling finished with no confirmed findings.
- `git diff --check` passed. No workflow, test, fixture or snapshot changed.

Package checking also now invokes npm portably on Windows and reports spawn
errors correctly. It retains the original dry-run packing, declared-dependency,
export, size and DOM-free import checks. This did not replace any check with a skip.
