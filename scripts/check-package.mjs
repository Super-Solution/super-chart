#!/usr/bin/env node
/**
 * Check the packed owned API in a dependency-free consumer: plain Node imports,
 * CommonJS, declaration parity and strict ESM/CJS/Node10 consumer examples.
 * Keeps the existing packed-file, external-import and tarball size budgets.
 * Legacy engine registries, CSS/font checks and expected Node import failures
 * no longer describe the package and have been removed.
 * Usage: node scripts/check-package.mjs [--self-test] [--keep]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { untar } from "./check-vendored.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "@super-solution/super-chart";
const MAX_PACKED_BYTES = 780_000;
export const PINNED = {
  ".": ["SuperChart", "ChartWorkspace", "EngineChart", "DefaultDatafeed", "EngineIndicators", "DrawingStore", "ENGINE_CHART_TYPES", "DRAWING_TYPES", "createPriceScale"],
  "./core": ["RealtimeSeries", "RealtimeView", "DataLoader", "ta"],
  "./native": ["RealtimeSeries", "RealtimeView", "createNativeEnvironment", "createNativeDataLoader"],
  "./superscript": ["runScript", "registerLanguage", "getLanguage", "listLanguages", "SuperScriptLanguage", "JavaScriptLanguage", "superlib", "superscriptReference", "nlToSuperScript"],
  "./indicators": ["TECHNICAL_INDICATOR_DEFINITIONS", "CLASSIC_INDICATOR_DEFINITIONS"],
  "./scripts": ["createEngineScriptIndicator", "EngineScriptError", "ENGINE_SCRIPT_LIMITS"],
  "./annotations": ["EngineAnnotations", "ENGINE_ANNOTATION_LIMITS"],
  "./overlays": ["createMarketOverlayLayer"],
};
/** Every concrete (non-pattern) file target named by main/module/types/exports. */
export function exportTargets(pkg) {
  const out = new Set();
  for (const field of ["main", "module", "types"]) if (typeof pkg[field] === "string") out.add(pkg[field]);
  const walk = (node) => {
    if (typeof node === "string") { if (!node.includes("*")) out.add(node); return; }
    if (node && typeof node === "object") for (const value of Object.values(node)) walk(value);
  };
  walk(pkg.exports);
  return [...out].map((t) => t.replace(/^\.\//, "")).sort();
}

/** Owned entries are inert until explicit host construction or registration. */
export function sideEffectsProblems(pkg) {
  return pkg.sideEffects === false ? [] : ["sideEffects must be false for the owned explicit-registration entries"];
}

/** Bare module specifiers a built JS file imports or requires. */
export function bareImports(code) {
  const ts = createRequire(join(root, "package.json"))("typescript");
  const found = new Set();
  const add = (spec) => { if (!spec.startsWith(".") && !spec.startsWith("/")) found.add(spec); };
  // Parse actual imports, not quoted content such as an object key named "from".
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) add(node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : null;
      const first = node.arguments[0];
      if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || name === "require") && first && ts.isStringLiteral(first)) add(first.text);
      if (name === "define" && first && ts.isArrayLiteralExpression(first)) {
        for (const element of first.elements) if (ts.isStringLiteral(element) && !["exports", "require", "module"].includes(element.text)) add(element.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile("packed.js", code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS));
  return [...found].sort();
}

/** The ```ts code blocks of a Markdown file, each as its own module. */
export function readmeSnippets(markdown) {
  return [...markdown.matchAll(/^```ts\r?\n([\s\S]*?)^```/gm)].map((m) => `${m[1]}\nexport {};\n`);
}

/** Names in one list and not the other. */
export function diffNames(runtime, declared) {
  const r = new Set(runtime), d = new Set(declared);
  return { missingFromTypes: [...r].filter((n) => !d.has(n)).sort(), missingAtRuntime: [...d].filter((n) => !r.has(n)).sort() };
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
}

/** `npm pack` into dir; returns { tarball, files, size }. */
function pack(dir) {
  // npm is npm.cmd on Windows, which needs a shell; pass one command string then.
  const r = process.platform === "win32"
    ? run(`npm pack --json --pack-destination "${dir}"`, [], { cwd: root, shell: true })
    : run("npm", ["pack", "--json", "--pack-destination", dir], { cwd: root });
  if (r.status !== 0) throw new Error(`npm pack failed:\n${r.stderr}`);
  const info = JSON.parse(r.stdout.slice(r.stdout.indexOf("[")))[0];
  return { tarball: join(dir, info.filename), files: info.files.map((f) => f.path), size: info.size };
}

function installPackage(tarball, consumer) {
  const dest = join(consumer, "node_modules", ...PACKAGE.split("/"));
  for (const [name, bytes] of untar(gunzipSync(readFileSync(tarball)))) {
    if (!name.startsWith("package/")) continue;
    const file = join(dest, name.slice("package/".length));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
}

/** Run an ESM snippet in a fresh Node process inside `cwd`; it prints one JSON line. */
function probe(cwd, name, code) {
  const file = join(cwd, `${name}.mjs`);
  writeFileSync(file, code);
  const r = run(process.execPath, [file], { cwd });
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.stdout).trim().split("\n").slice(0, 6).join("\n") };
  try { return { ok: true, value: JSON.parse(r.stdout.trim().split("\n").pop()) }; }
  catch { return { ok: false, error: `unparseable output: ${r.stdout.slice(0, 300)}` }; }
}

/** Value exports of each module specifier, from the TypeScript checker. */
function declaredExports(ts, consumer, specifiers, compilerOptions) {
  const file = join(consumer, "parity.ts");
  writeFileSync(file, specifiers.map((s, i) => `import * as m${i} from "${s}";\nexport { m${i} };`).join("\n"));
  const program = ts.createProgram([file], compilerOptions);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  const out = {};
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const spec = stmt.moduleSpecifier.text;
    const moduleSymbol = checker.getSymbolAtLocation(stmt.moduleSpecifier);
    if (!moduleSymbol) { out[spec] = null; continue; }
    out[spec] = checker.getExportsOfModule(moduleSymbol)
      .filter((sym) => {
        const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
        return (target.flags & ts.SymbolFlags.Value) !== 0;
      })
      .map((sym) => sym.name)
      .sort();
  }
  return out;
}

function tsc(ts, consumer, name, files, compilerOptions) {
  const program = ts.createProgram(files.map((f) => join(consumer, f)), compilerOptions);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  return diagnostics.map((d) => {
    const where = d.file ? `${d.file.fileName.split("node_modules/").pop()}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}` : name;
    return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
}

function selfTest() {
  const cases = [];
  const expect = (name, ok) => { cases.push(name); if (!ok) throw new Error(`self-test "${name}" failed`); };
  const pkg = { main: "./dist/a.cjs", exports: { ".": { import: { types: "./dist/a.d.ts", default: "./dist/a.js" } }, "./dist/*": "./dist/*" } };
  expect("exportTargets walks conditions and skips patterns", JSON.stringify(exportTargets(pkg)) === JSON.stringify(["dist/a.cjs", "dist/a.d.ts", "dist/a.js"]));
  expect("inert entries accept sideEffects false", sideEffectsProblems({ sideEffects: false }).length === 0);
  expect("sideEffects true is rejected", sideEffectsProblems({ sideEffects: true }).length === 1);
  expect("obsolete sideEffects lists are rejected", sideEffectsProblems({ sideEffects: ["*.css"] }).length === 1);
  expect("bare imports: ESM, CJS, AMD and dynamic", JSON.stringify(bareImports(
    'import { a } from "external"; import "./x.js"; import b from "other/web"; const c = require("lodash/set"); import("dyn"); define(["exports","external"], f)',
  )) === JSON.stringify(["dyn", "external", "lodash/set", "other/web"]));
  expect("relative imports are not bare", bareImports('export { x } from "./shared.js"').length === 0);
  const md = "text\n```ts\nconst a = 1\n```\n```bash\nnpm i\n```\n```ts\nconst b = 2\n```\n";
  expect("README ts blocks are extracted, others skipped", readmeSnippets(md).length === 2 && readmeSnippets(md)[1].startsWith("const b = 2"));
  const d = diffNames(["a", "superlib"], ["a"]);
  expect("parity reports a name the d.ts dropped", d.missingFromTypes[0] === "superlib" && d.missingAtRuntime.length === 0);
  console.log(`check-package self-test passed (${cases.length} cases)`);
}

// Existing consumer fixtures now use the owned host API and optional entries.
const FIXTURE_ESM = `
import {
  SuperChart, ChartWorkspace, EngineChart, DefaultDatafeed, DrawingStore, ENGINE_CHART_TYPES,
  type ChartWorkspaceOptions, type EngineChartOptions,
} from "${PACKAGE}";
import { RealtimeSeries, RealtimeView, ta, type Datafeed, type Period, type SymbolInfo, type MarketBar, type DatafeedSubscribeCallback } from "${PACKAGE}/core";
import * as native from "${PACKAGE}/native";
import { runScript, registerLanguage, JavaScriptLanguage, superlib } from "${PACKAGE}/superscript";
import { TECHNICAL_INDICATOR_DEFINITIONS, CLASSIC_INDICATOR_DEFINITIONS } from "${PACKAGE}/indicators";
import { createEngineScriptIndicator } from "${PACKAGE}/scripts";
import { EngineAnnotations } from "${PACKAGE}/annotations";
import { createMarketOverlayLayer } from "${PACKAGE}/overlays";

declare const datafeed: Datafeed;
declare const host: HTMLElement;
const symbol: SymbolInfo = { ticker: "BTC-USDT", pricePrecision: 2, priceCurrency: "USDT" };
const period: Period = { multiplier: 15, timespan: "minute", text: "15m" };
const options: ChartWorkspaceOptions = { symbol, period, datafeed, chart: { render: { chartType: "area" } } };
const workspace: ChartWorkspace = new SuperChart(host, options);
const ready = await workspace.ready;
const changed = await workspace.setMarket(symbol, "4H");
const state = workspace.getState();
const load = workspace.getLoadState();
const unsubscribe = workspace.on("loadResult", result => { void result.status; });
const bars: readonly MarketBar[] = workspace.getBars({ limit: 20 });
const chart: EngineChart = workspace.chart;
for (const definition of [...TECHNICAL_INDICATOR_DEFINITIONS, ...CLASSIC_INDICATOR_DEFINITIONS]) chart.registerIndicator(definition);
const script = createEngineScriptIndicator({ name: "OWNED", source: "plot(sma(close, 3))" });
const attachment = script.attach(chart);
const overlay = createMarketOverlayLayer({ fairValueGaps: true });
const annotations = new EngineAnnotations({ symbol: "BTC-USDT" });
const drawings: DrawingStore = chart.drawings;
const result = runScript("plot(sma(close, 3))", [...bars]);
registerLanguage(JavaScriptLanguage);
const mod = await import("${PACKAGE}");
const Ctor: typeof SuperChart = mod.SuperChart;
const oldStyleFeed: Datafeed = {
  searchSymbols: async () => [],
  getHistoryKLineData: async () => [] as MarketBar[],
  subscribe (s: SymbolInfo, p: Period, callback: (d: MarketBar) => void) { callback({ timestamp: 0, open: 1, high: 1, low: 1, close: 1 }); },
  unsubscribe () {},
};
const arrayTick: DatafeedSubscribeCallback = (d) => { void d; };
arrayTick([{ timestamp: 0, open: 1, high: 1, low: 1, close: 1 }]);
// Closed unions still reject unsupported renderer/data settings.
// @ts-expect-error chartType is a closed list
const badType: EngineChartOptions = { render: { chartType: "lin" } };
// @ts-expect-error display mode is a closed list
const badMode: EngineChartOptions = { mode: "renko" };
// @ts-expect-error price scale is a closed list
const badScale: EngineChartOptions = { layout: { priceScale: { mode: "unknown" } } };
// @ts-expect-error period must be a string or Period
workspace.setPeriod(12345);
unsubscribe(); attachment.dispose(); workspace.dispose();
export { ready, changed, state, load, bars, overlay, annotations, drawings, result, Ctor, badType, badMode, badScale, oldStyleFeed, native, RealtimeSeries, RealtimeView, ta, superlib, DefaultDatafeed, ENGINE_CHART_TYPES };
`;
const FIXTURE_CJS = `
import sc = require("${PACKAGE}");
import type { ChartWorkspace, EngineChartOptions } from "${PACKAGE}";
const Ctor: typeof sc.SuperChart = sc.SuperChart;
const workspace: ChartWorkspace | null = null;
const options: EngineChartOptions = { render: { chartType: "candles" } };
export = { Ctor, workspace, options };
`;
const FIXTURE_NODE10 = `
import { SuperChart, EngineChart } from "${PACKAGE}";
import { RealtimeSeries } from "${PACKAGE}/core";
import { runScript } from "${PACKAGE}/superscript";
import { createEngineScriptIndicator } from "${PACKAGE}/scripts";
export { SuperChart, EngineChart, RealtimeSeries, runScript, createEngineScriptIndicator };
`;

async function main() {
  const keep = process.argv.includes("--keep");
  const problems = [];
  const fail = (check, message) => problems.push(`[${check}] ${message}`);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!existsSync(join(root, "dist"))) throw new Error("dist/ is missing: build the package first.");
  const work = mkdtempSync(join(tmpdir(), "super-chart-check-"));
  try {
    const packed = pack(work);
    const files = new Set(packed.files);
    for (const target of exportTargets(pkg)) if (!files.has(target)) fail("exports", `${target} is named in package.json but not packed`);
    for (const entry of Object.keys(PINNED)) if (!(entry in pkg.exports)) fail("exports", `public entry is missing: ${entry}`);
    for (const p of sideEffectsProblems(pkg)) fail("exports", p);
    for (const f of files) {
      if (f.endsWith(".map")) fail("files", `source map packed: ${f}`);
      if (f.startsWith("dist/node_modules/")) fail("files", `dist/node_modules/ is packed: ${f}`);
    }
    if (packed.size > MAX_PACKED_BYTES) fail("files", `packed tarball is ${packed.size} bytes, budget ${MAX_PACKED_BYTES}`);
    const consumer = join(work, "consumer");
    mkdirSync(consumer, { recursive: true });
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
    installPackage(packed.tarball, consumer);
    const installed = join(consumer, "node_modules", ...PACKAGE.split("/"));
    for (const f of files) {
      if (!/\.(c|m)?js$/.test(f)) continue;
      const extra = bareImports(readFileSync(join(installed, f), "utf8"));
      if (extra.length) fail("bare-imports", `${f} imports ${extra.join(", ")}; the owned package has no runtime externals`);
    }
    const entries = Object.keys(pkg.exports).filter(entry => entry !== "./package.json");
    const specifier = entry => entry === "." ? PACKAGE : `${PACKAGE}/${entry.slice(2)}`;
    const imports = probe(consumer, "imports", `
      const before = new Set(Reflect.ownKeys(globalThis));
      const names = {};
      for (const spec of ${JSON.stringify(entries.map(specifier))}) names[spec] = Object.keys(await import(spec)).sort();
      const globals = Reflect.ownKeys(globalThis).filter(key => !before.has(key)).map(String);
      console.log(JSON.stringify({ names, globals, document: typeof document, window: typeof window }));
    `);
    if (!imports.ok) fail("main", `public entry import failed in plain Node without dependencies:\n${imports.error}`);
    else if (imports.value.globals.length || imports.value.document !== "undefined" || imports.value.window !== "undefined") fail("main", `import changed globals: ${JSON.stringify(imports.value.globals)}`);
    const ss = probe(consumer, "superscript", `
      const ss = await import("${PACKAGE}/superscript");
      const bars = Array.from({ length: 30 }, (_, i) => ({ timestamp: i, open: 1 + i, high: 2 + i, low: i, close: 1 + i + (i % 2), volume: 1 }));
      const plots = ss.runScript('plot(rsi(close, 14), title="RSI")', bars).plots;
      let js = "ran";
      try { ss.runScript("return { meta: { title: 'x' }, plots: [] }", bars, "javascript"); } catch { js = "rejected"; }
      console.log(JSON.stringify({ plots: plots.length, finite: Number.isFinite(plots[0].values[29]), js }));
    `);
    if (!ss.ok) fail("superscript", `import or run failed:\n${ss.error}`);
    else {
      if (ss.value.plots !== 1 || !ss.value.finite) fail("superscript", `runScript returned ${JSON.stringify(ss.value)}`);
      if (ss.value.js !== "rejected") fail("superscript", "runScript ran javascript without explicit language registration");
    }
    const req = probe(consumer, "require", `
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      const cjs = require("${PACKAGE}");
      console.log(JSON.stringify({ names: Object.keys(cjs).sort(), ctor: typeof cjs.SuperChart, file: require.resolve("${PACKAGE}") }));
    `);
    if (!req.ok) fail("require", `require() failed:\n${req.error}`);
    else if (req.value.ctor !== "function" || !req.value.file.endsWith(".cjs")) fail("require", JSON.stringify(req.value));
    const ts = createRequire(join(root, "package.json"))("typescript");
    const node16 = {
      module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, target: ts.ScriptTarget.ES2022,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], strict: true, skipLibCheck: false, noEmit: true, types: [],
    };
    const runtime = imports.value?.names ?? {};
    const declared = declaredExports(ts, consumer, entries.map(specifier), node16);
    for (const entry of entries) {
      const spec = specifier(entry), names = runtime[spec];
      if (!names) continue;
      if (!declared[spec]) { fail("parity", `${spec}: TypeScript cannot resolve its d.ts`); continue; }
      const d = diffNames(names, declared[spec]);
      if (d.missingFromTypes.length) fail("parity", `${spec}: runtime exports missing from d.ts: ${d.missingFromTypes.join(", ")}`);
      if (d.missingAtRuntime.length) fail("parity", `${spec}: declared exports missing at runtime: ${d.missingAtRuntime.join(", ")}`);
      const missing = (PINNED[entry] ?? []).filter(name => !names.includes(name));
      if (missing.length) fail("exports", `${spec} no longer exports ${missing.join(", ")}`);
    }
    if (req.value && runtime[PACKAGE]) {
      const d = diffNames(req.value.names, runtime[PACKAGE]);
      if (d.missingFromTypes.length || d.missingAtRuntime.length) fail("require", `CommonJS and ESM exports differ: ${JSON.stringify(d)}`);
    }
    writeFileSync(join(consumer, "fixture.ts"), FIXTURE_ESM);
    writeFileSync(join(consumer, "fixture-cjs.cts"), FIXTURE_CJS);
    writeFileSync(join(consumer, "fixture-node10.ts"), FIXTURE_NODE10);
    for (const e of tsc(ts, consumer, "node16", ["fixture.ts"], node16)) fail("types", `node16: ${e}`);
    for (const e of tsc(ts, consumer, "node16-cjs", ["fixture-cjs.cts"], node16)) fail("types", `node16 CommonJS: ${e}`);
    const node10 = { ...node16, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs };
    for (const e of tsc(ts, consumer, "node10", ["fixture-node10.ts"], node10)) fail("types", `moduleResolution node: ${e}`);
    const blocks = readmeSnippets(readFileSync(join(installed, "README.md"), "utf8"));
    if (blocks.length === 0) fail("readme", "README.md has no TypeScript examples to check");
    const snippetFiles = blocks.map((code, i) => { const name = `readme-${i + 1}.ts`; writeFileSync(join(consumer, name), code); return name; });
    for (const e of tsc(ts, consumer, "readme", snippetFiles, node16)) fail("readme", e);
    if (problems.length) { console.error(`${PACKAGE} package check failed (${files.size} files, ${packed.size} bytes packed):\n  - ${problems.join("\n  - ")}`); process.exitCode = 1; return; }
    console.log(`${PACKAGE} package check passed: ${files.size} files, ${packed.size} bytes packed; ${entries.length} entries; dependency-free Node ESM/CJS, strict declarations, export parity and consumer examples`);
  } finally {
    if (keep) console.log(`kept ${work}`);
    else {
      const inside = relative(resolve(tmpdir()), resolve(work));
      if (!inside || inside.startsWith("..") || resolve(tmpdir(), inside) !== resolve(work)) throw new Error("Scratch cleanup path escaped temp");
      rmSync(work, { recursive: true, force: true });
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--self-test")) selfTest();
  else main().catch(err => { console.error(err.stack ?? err.message); process.exit(1); });
}
