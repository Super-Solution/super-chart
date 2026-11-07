import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

import webpack from 'webpack'

import { test, expect, pageErrors } from './fixtures'
// @ts-expect-error plain ESM helper without types
import { untar } from '../../scripts/check-vendored.mjs'

// SC-187: the package is tree-shakeable in a webpack production build (what
// `next build` uses for SupWallet and Broker), and its "sideEffects" list does
// not let webpack drop the `.` entry's overlay registration.
//
// Budgets (bytes, minified, klinecharts external): chartStyles alone from
// ./lite, and { SuperChart } from `.`. Measured when this spec was added:
// 1,328 and 225,799 (before this PR: 17,562 and 260,080). chartStyles then
// grew to 2,726 when it started setting every text path, all nine candle
// bar keys and whole indicator bar elements (SC-038, SC-041, SC-049); what
// it bundles is that style object and a 20-line deep merge, nothing else.
const BUDGET_LITE_CHARTSTYLES = 3_072
//
// { SuperChart } grows on purpose as the optimisation stack lands: 225,799
// after PR 01, 246,488 with PR 02 (data loader) and PR 03 (TA core,
// SuperScript diagnostics), 255,135 with PR 04 (canvas theme, style stack,
// design tokens). The budget catches accidental growth, not planned
// features: a PR that crosses it raises it here and says why in its body.
// 2026-09-27: 313,910 with PR 05 (API v2 core) — the whole additive surface
// this batch adds and exports from `.`: the event bus (src/api/events.ts),
// getState/getContext (src/api/state.ts), ChartError + its validators
// (src/api/errors.ts), the Promise<LoadResult> load-coalescing queue
// (src/data/loadWaiters.ts), the history cache (src/data/historyCache.ts),
// price-precision derivation (src/data/precision.ts), the day+-bar/timezone
// formatter (src/time/formatBarDate.ts, src/time/resolveTz.ts), loadUntil
// (setVisibleRange/scrollToTime) and a corrected DefaultDatafeed. Then PR 06
// (i18n/a11y) adds locale resolution + zh-TW.json, the canvas-locale and
// drawing-label bridges, TradingView-unit number formatting, the rewritten
// timezone popover, and the chart's aria name/description wiring in
// ChartProComponent, raising it to 350,000 (measured 339,068 with PR 05 +
// PR 06 combined). Then PR 07 (chrome-layout) adds the chart key dispatcher,
// the top bar's fit and menus, the dialog and combobox keyboard patterns,
// full screen with its fallback, parts and the typed setters, measuring
// 372,162 bytes with PR 05 + PR 06 + PR 07 combined, raised again to
// 400,000. Then PR 08 (indicators) adds 15 SC_ templates on the shared ta
// core, the indicator/drawing-tool catalogue, and the catalogue-driven
// picker/settings form, measuring 404,693 bytes; raised again 2026-09-27
// (400,000 -> 430,000). Then PR 09 (chart-interaction) adds the candle
// legend, VOL pane styling, crisp-line snapping, the bar-close countdown,
// the pane layout policy, wheel/keyboard/crosshair/cursor navigation, the
// price-scale corner, the "scroll to latest" button, the rebuilt replay
// controller + ReplayBar, the theme-correct screenshot/snapshot, and
// symbol-search search-as-you-type/keyboard-nav/recents — measured alone
// against its own (pre-stack) base at 318,127, 300,000 -> 330,000. Stacked
// on top of PR 05 + PR 06 + PR 07 + PR 08, it measures 433,057 bytes;
// raised again 2026-09-27 (430,000 -> 450,000). PR 10 (drawing-input) fit
// inside this budget on its own. Then PR 11 (drawing-editor) adds undo/redo
// (history.ts), the right-click context menu, the inline text/image editor,
// the object tree, copy/paste/nudge, per-tool style memory and per-symbol
// persistence, plus their public ChartPro API surface (undo/redo,
// getDrawings/setDrawings, listDrawings, setDrawingDefaults, ...) — measured
// alone against its own (pre-stack) base at 320,906, up from 290,248
// (300,000 -> 325,000 on its own). Stacked on top of PR 05 + PR 06 + PR 07 +
// PR 08 + PR 09 + PR 10, it measures 454,726 bytes; raised again 2026-09-27
// (450,000 -> 480,000). Then PR 12 (ai-mcp-commands) adds the command
// registry (schema + per-instance bind: execute/getCommands/
// toToolDefinitions), the drawings/annotations/layout APIs, the future-time/
// replay anchoring helper and the opt-in command palette, all exported from
// `.` — measured stacked on top of PR 05 through PR 11 at 491,256 bytes;
// raised again 2026-09-27 (480,000 -> 510,000). Then SC-NEXT #1/#2/#3 (motion,
// the eight custom-series chart types plus their overlay renderer, the
// grouped/favourited chart-type menu, High/Low axis tags, the UTC/local
// clock) — measured at 515,433 bytes; raised again 2026-09-28 (510,000 -> 540,000).
// #1062 compacts complete built locale tables while retaining #1047's hold
// feature. Executed webpack CI measured 539,845 bytes on both supported peers,
// restoring the 540,000-byte gate; lite/tree-shaking checks remain unchanged.
const BUDGET_SUPERCHART = 540_000

const e2e = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(e2e, '..')
const work = join(e2e, '.cache', 'webpack')

function packInto (dir: string): void {
  const pack = process.platform === 'win32'
    ? spawnSync(`npm pack --json --pack-destination "${dir}"`, { cwd: root, shell: true, encoding: 'utf8' })
    : spawnSync('npm', ['pack', '--json', '--pack-destination', dir], { cwd: root, encoding: 'utf8' })
  if (pack.status !== 0) throw new Error(`npm pack failed: ${pack.stderr}`)
  const info = JSON.parse(pack.stdout.slice(pack.stdout.indexOf('[')))[0]
  const dest = join(dir, 'node_modules', '@zzyzxlabs', 'super-chart')
  for (const [name, bytes] of untar(gunzipSync(readFileSync(join(dir, info.filename)))) as Map<string, Buffer>) {
    if (!name.startsWith('package/')) continue
    const file = join(dest, name.slice('package/'.length))
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }
}

async function build (entries: Record<string, string>): Promise<Record<string, number>> {
  for (const [name, code] of Object.entries(entries)) writeFileSync(join(work, `${name}.src.js`), code)
  const compiler = webpack({
    mode: 'production',
    context: work,
    target: 'web',
    entry: Object.fromEntries(Object.keys(entries).map(n => [n, `./${n}.src.js`])),
    output: { path: join(work, 'out'), filename: '[name].js' },
    externals: { klinecharts: 'klinecharts' },
    resolve: { modules: [join(work, 'node_modules')] },
    performance: false,
    devtool: false
  })
  const stats = await new Promise<webpack.Stats>((resolvePromise, reject) => {
    compiler.run((err, s) => { if (err !== null && err !== undefined) reject(err); else resolvePromise(s!) })
  })
  await new Promise(r => compiler.close(r))
  if (stats.hasErrors()) throw new Error(stats.toString({ all: false, errors: true }))
  return Object.fromEntries(Object.keys(entries).map(n => [n, statSync(join(work, 'out', `${n}.js`)).size]))
}

test.describe.configure({ mode: 'serial' })

let sizes: Record<string, number> = {}

test.beforeAll(async () => {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  packInto(work)
  sizes = await build({
    'lite-chartstyles': "import { chartStyles } from '@zzyzxlabs/super-chart/lite'\nwindow.__chartStyles = chartStyles\n",
    superchart: "import { SuperChart } from '@zzyzxlabs/super-chart'\nwindow.__SuperChart = SuperChart\n"
  })
})

test('webpack production size budgets', async () => {
  console.log(`webpack production sizes: ${JSON.stringify(sizes)}`)
  expect(sizes['lite-chartstyles'], 'chartStyles from ./lite').toBeLessThanOrEqual(BUDGET_LITE_CHARTSTYLES)
  expect(sizes.superchart, '{ SuperChart } from .').toBeLessThanOrEqual(BUDGET_SUPERCHART)
})

test('a webpack bundle of { SuperChart } registers every extension overlay', async ({ page, kc }) => {
  await page.goto(`/e2e/pages/harness.html?kc=${kc}&build=umd`)
  await page.waitForFunction(() => (window as any).__ready === true)
  const umd = await page.evaluate(() => (window as any).H.KC.getSupportedOverlays().length)
  await page.goto(`/e2e/pages/bundle.html?kc=${kc}&bundle=/e2e/.cache/webpack/out/superchart.js`)
  await page.waitForFunction(() => (window as any).__ready === true)
  const state = await page.evaluate(() => ({
    kcOnly: (window as any).__kcOnly,
    withBundle: (window as any).klinecharts.getSupportedOverlays().length,
    ctor: typeof (window as any).__SuperChart,
    figures: ['imageFig', 'superChartHitPath'].filter(n => (window as any).klinecharts.getFigureClass(n) != null)
  }))
  expect(state.ctor).toBe('function')
  expect(state.withBundle).toBeGreaterThan(state.kcOnly)
  expect(state.withBundle, 'the same overlays as the single-file UMD build').toBe(umd)
  expect(state.figures).toEqual(['imageFig', 'superChartHitPath'])
  expect(await pageErrors(page)).toEqual([])
})
