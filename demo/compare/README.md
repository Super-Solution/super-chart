# Local new / previous Super Chart playground

Run from this repository with Bun (no dependency install or build output):

```powershell
bun run demo/compare/serve.ts
```

Open http://127.0.0.1:4317/ . Stop with Ctrl+C in that terminal.

This manual playground compares the current owned `ChartWorkspace` source with the
actual previously published `@super-solution/super-chart@0.0.53` Pro UMD and
KLineCharts 9.8.12. The previous package is read directly from the existing local
npm cache; it is not added to a package entry, installed, or copied into this repo.
The server bundles current source in memory with Bun and binds only 127.0.0.1.
For the owned-engine before/after comparison, `build-owned.ts` reads the fixed Git
revision `c8a8e9e098204f14ca7856a8bdc885c8ad9e814f` using one `git archive` call
captured entirely in memory. A Bun virtual-source plugin compiles those bytes;
there is no extracted baseline tree, tar file, generated JavaScript file or cache.
The baseline commit must be present in this checkout's local Git objects. If it
is missing, startup stops with an explicit error; it does not silently use HEAD.
The current side always compiles the working tree when the server starts. Restart
the server after source edits; it does not watch or rebuild in the background.

The default cache paths match this workstation. On another workstation, supply
`SUPER_CHART_LEGACY_TGZ` (the 0.0.53 tarball) and
`SUPER_CHART_LEGACY_ENGINE` (the 9.8.12 engine UMD file).
The existing root LICENSE and NOTICE continue to apply.
No third-party implementation is copied into this demo.

Both iframes independently consume the same deterministic synthetic OHLCV formula,
fixed time anchor, history size, and parent-issued update sequence. No exchange,
wallet, account, analytics, or external font service is used. CSP blocks external
connections. Each frame owns its own subscription and chart lifecycle.

Controls support 1k / 10k / 50k history, baseline or multiple indicators, 1 / 10 / 50
target updates per second, replay, reset, and single-version or side-by-side view.
Changing the top-level market / period / data / indicator settings resets both
charts and their drawings. Native chart controls are deliberately not restyled or
replaced. Internal market / interval changes can diverge; the header identifies it.

The main page is a manual experience comparison, not an automated test or
regression snapshot. `/bench.html` provides an optional one-shot measurement UI
for isolated legacy / owned-before / owned-after runs. It reports the selected
synthetic workload; it is not a product CI gate or a general performance score. Side-by-side charts share CPU/GPU resources, timer rates are not FPS,
and the two native replay clocks need not stay frame-synchronized. Same indicator
names and parameters do not imply identical seeding or numeric conventions.
It does not demonstrate a React Native renderer or claim a speedup percentage.

The first-round measurement reports used the retained local snapshot 5b9b7d0.
The PR playground pins the remotely available initial 0.1 snapshot c8a8e9e so a
fresh clone can reproduce it. Historical measurements retain their original labels.
