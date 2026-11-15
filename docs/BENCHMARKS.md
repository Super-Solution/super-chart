# Benchmarks

`node scripts/benchmark.mjs` is a reproducible browser benchmark. It starts the repository's Vite server, opens
`demo/benchmark.html` in headless Chromium with synthetic data, runs the scenarios below and prints one JSON document.
It needs Playwright with a Chromium build (`npm i -D playwright`, `npx playwright install chromium`, or an existing
install on `NODE_PATH`). Nothing is sent over a network, and nothing is published or committed by it.

```bash
node scripts/benchmark.mjs                                   # 50,000 bars, 5 indicators, desktop
node scripts/benchmark.mjs --bars 100000 --indicators 12     # heavier
node scripts/benchmark.mjs --mobile                          # Pixel 7 viewport, DPR 2.6, CPU 4x slower
node scripts/benchmark.mjs --live-hz 100 --out run.json      # save the result
```

Options: `--bars`, `--indicators`, `--steps` (pan and zoom steps, one per frame), `--live-hz`, `--live-seconds`,
`--switches` (market switches), `--mobile`, `--cpu-throttle <n>`, `--out <file>`.

## Scenarios and fields

| Scenario | What runs | Fields |
| --- | --- | --- |
| `engine.loadMs` | create `EngineChart`, `setData(bars)`, add the indicators, wait two frames | milliseconds |
| `engine.pan`, `engine.zoom` | `steps` viewport changes, one per animation frame | `frameGapMs` and `flushCpuMs`: count, p50, p95, p99, max, `over25` (frames slower than 25 ms) |
| `engine.live` | `chart.update` at `--live-hz` for `--live-seconds` | `targetHz`, `ticks`, `actualHz` (what the page really delivered), plus the same two stats |
| `engine.longTasks` | the browser's Long Tasks entries during pan, zoom and live | `count`, `totalMs` |
| `engine.heapBytes` | JS heap after a forced collection | bytes (Chromium only; `null` elsewhere) |
| `switching.switches` | `workspace.setMarket` between two markets `--switches` times, each until data is applied and one frame has painted | latency stats |
| `switching.heapGrowthBytes` | heap after the switches minus heap before, both after a forced collection | bytes; growth that scales with `--switches` is a leak |
| `switching.domNodesAfterDispose` | DOM node count after `workspace.dispose()` | should return to the page's own nodes |

## Reading the numbers

- `frameGapMs` is the interval between animation frames. Headless Chromium is vsync-bound, so a healthy chart reads about
  16.7 ms and the gap only moves when the main thread cannot keep up. **`flushCpuMs`** is the chart's own time to build and
  paint one flush (`chart.getMetrics().lastFrameMs`); it is the number that moves when the renderer changes.
- `actualHz` is reported next to `targetHz` because a throttled device may not deliver the target. A result is never
  presented as the target rate.
- Mobile is emulation: a phone viewport and pixel ratio with the CPU slowed by a factor. It is a useful floor for
  regressions and a bad predictor of a particular phone. Run on the device for a claim about the device.
- Runs are not isolated from other work on the machine; no randomisation, no pinned CPU. Compare runs from the same
  machine, repeat three times, and treat differences under about 10% as noise.
- The data is synthetic and smooth. Real feeds with gaps, many drawings or many panes cost more.

## What is not measured here

Cold network loads, real exchange feeds, paint cost of a specific GPU, memory on iOS Safari, and battery. The older manual
measurements in [browser-measurements-20261115.md](browser-measurements-20261115.md) used a different harness and are not
comparable number for number.
