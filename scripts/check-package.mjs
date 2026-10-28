#!/usr/bin/env node
/**
 * Check the package the way a consumer gets it: `npm pack`, installed into a
 * scratch consumer, then imported, required and type-checked there.
 *
 * Nothing else looks at the shipped package's surface. The build and
 * check-vendored compare bytes; a missing CSS file, a `require` export Node
 * cannot load, a d.ts that drops an export or an entry that needs a DOM on
 * import all pass them. This fails on each of those.
 *
 * What it asserts (a failure names the check):
 *   exports        every target in package.json main/module/types/exports is
 *                  in the packed file list; "sideEffects" is an array that
 *                  keeps the `.` bundles and CSS (never `false`: the `.` entry
 *                  registers the drawing overlays when it loads).
 *   files          dist/klinecharts-pro.css (the path every host imports) is
 *                  packed and not empty; no source maps, no dist/node_modules/;
 *                  the tarball stays under a size budget.
 *   bare-imports   the only package the built JS imports is `klinecharts`.
 *   superscript    `./superscript` imports and runs in plain Node with no
 *                  klinecharts installed, and refuses "javascript".
 *   lite           `./lite` imports in Node and registers nothing on import.
 *   main           `.` imports with no DOM (klinecharts resolved as bundlers
 *                  resolve it, see below), exports the names hosts use, and
 *                  registers the extension overlays and figures.
 *   shared         `.` and `./lite` share one language registry and one
 *                  imageFig figure, whichever loads first.
 *   require        `require()` of `.` loads the CommonJS build (same
 *                  klinecharts resolution).
 *   plain-node     with the UNMODIFIED klinecharts package and no bundler,
 *                  `./lite` and `./superscript` import, and `.` and
 *                  `require()` of `.` still fail. The README says so; the day
 *                  `.` loads there this fails, so the README gets corrected.
 *   css            `./style.css` and `./dist/klinecharts-pro.css` resolve to
 *                  the same packed file; the stylesheet styles only the
 *                  chart's own elements (every selector names
 *                  klinecharts-pro, every @keyframes is prefixed), ships one
 *                  inlined font and stays under a size budget.
 *   parity         every entry's runtime exports equal the value exports of
 *                  its d.ts (dts-bundle-generator has dropped one before).
 *   types          consumer import lines type-check against the packed d.ts
 *                  with skipLibCheck false (node16 ESM and CJS, and node10),
 *                  and the closed unions reject what they should.
 *   readme         every ```ts example in the packed README.md compiles
 *                  against the packed d.ts (the quick start once crashed).
 *
 * klinecharts in the main scratch consumer is the dev dependency, resolved to
 * its ESM build for `import` and its UMD build for `require`. That is what
 * bundlers (and Next's server build) load. klinecharts' own package.json
 * points plain Node at its UMD file, which Node loads as an ES module without
 * klinecharts' functions; the plain-node consumer installs it unmodified.
 *
 * No dependencies beyond this package's devDependencies (typescript).
 * Usage: node scripts/check-package.mjs [--self-test] [--keep]
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { untar } from "./check-vendored.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "@zzyzxlabs/super-chart";
/**
 * Packed tarball budget. A backstop for something packed by accident (a source
 * map build packed to ~721 KB; `.map` files and dist/node_modules/ also fail
 * on their own below). The build without source maps packed to ~310 KB at
 * 0.0.17 and ~403 KB with the data loader, the SuperScript/TA core and the
 * theme engine stacked on it (0.0.20), which is why this was 450 KB, not
 * 400 KB. Raised 2026-09-27 (450_000 -> 480_000) on the stack: PR 05 (API v2
 * core) packed to 430,228 bytes on its own; PR 06 (i18n/a11y) adds a third
 * locale dictionary (zh-TW.json, ~11 KB minified) plus the canvas-locale and
 * drawing-label bridges and the rewritten timezone popover, bringing the
 * stacked tarball to 465,646 bytes. Then PR 07 (chrome-layout) adds the key
 * dispatcher, the top bar's fit and menus, the dialog and form-control
 * keyboard patterns and full screen, in each of the ES, CommonJS and UMD
 * builds, bringing the stacked tarball to 511,962 bytes, raised again to
 * 530 KB. Then PR 08 (indicators) adds the SC_* indicator pack (15
 * templates on the shared ta core, the catalogue, and the catalogue-driven
 * picker/settings form), bringing the stacked tarball to 559,977 bytes;
 * raised again 2026-09-27 (530_000 -> 590_000). Then PR 09 (chart-interaction)
 * adds the candle legend, VOL pane styling, crisp-line snapping, the
 * bar-close countdown, the pane layout policy, wheel/keyboard/crosshair/
 * cursor navigation, the price-scale corner, the "scroll to latest" button,
 * the rebuilt replay controller + ReplayBar, the theme-correct screenshot/
 * snapshot, and symbol-search search-as-you-type/keyboard-nav/recents,
 * bringing the stacked tarball to 602,748 bytes; raised again 2026-09-27
 * (590_000 -> 640_000). PR 10 (drawing-input) fit inside this. Then PR 11
 * (drawing-editor) adds undo/redo (history.ts), the right-click context
 * menu, the inline text/image editor, the object tree panel, copy/paste/
 * nudge, per-tool style memory, per-symbol persistence and addHostOverlay,
 * bringing the stacked tarball to 641,800 bytes; raised again 2026-09-27
 * (640_000 -> 650_000). Then PR 12 (ai-mcp-commands) adds the command
 * registry (schema.ts + bind.ts + the opt-in palette), the drawings/
 * annotations/layout APIs, the future-time/replay anchoring helper, and a
 * fourth build entry (`./commands`, dist/commands.js, ~13 KB on its own),
 * bringing the stacked tarball to 684,508 bytes; raised again 2026-09-27
 * (650_000 -> 700_000). Then SC-NEXT #1/#2/#3 (motion + chart types +
 * axis/legend: src/motion/, the eight custom-series chart types and their
 * overlay renderer in src/charttypes/, the grouped/favourited chart-type
 * menu in src/widget/chart-type-menu/, and the High/Low axis tags plus the
 * UTC/local clock toggle in src/canvas/) bring the tarball to 715,604 bytes;
 * raised again 2026-09-28 (700_000 -> 740_000).
 * Draw-by-holding (0.0.36) adds bounded stroke recognition, pointer/native-peer
 * compatibility, the scoped help UI and native editor transactions in all
 * three builds, measuring ~760 KB. Raised 2026-10-01 to 775 KB; the separate
 * source-map, packed-file, CSS-scope and external-import gates remain active.
 */
const MAX_PACKED_BYTES = 775_000;
/**
 * dist/klinecharts-pro.css budget: ~21 KB of it was four copies of the icon font.
 * Raised 2026-09-27 (30_000 -> 34_000, actual ~33.3 KB) for the i18n/a11y batch:
 * a shared :focus-visible ring, a forced-colors block (SC-069/SC-154), the
 * .klinecharts-pro-visually-hidden utility, and the timezone popover's own
 * stylesheet (replacing the old modal + Select markup it used to share). Then
 * raised again for the chrome-layout batch (34_000 -> 40_000): rules for its
 * own root and size classes, root-level menus, a dialog that fits short
 * charts, keyboard focus rings and coarse-pointer hit areas. Then PR 08
 * (indicators) adds the indicator picker's search box and preset chips
 * (src/widget/indicator-modal/index.less), measuring 40,628 bytes; raised
 * again 2026-09-27 (40_000 -> 44_000). PR 09 (chart-interaction) stayed
 * within this. Then PR 10 (drawing-input) adds the rewritten rail's own
 * scrollable/pinned layout, the flyout portal's stylesheet and the
 * brush/highlighter touch-action rule, measuring 44,250 bytes; raised again
 * 2026-09-27 (44_000 -> 48_000). Then PR 11 (drawing-editor) adds three new
 * floating surfaces — the right-click context menu, the inline text/image
 * editor (both reuse the toolbar's own tokens/rules, no new stylesheet) and
 * the object tree panel + its trigger button (its own src/widget/objects-panel/
 * index.less) — plus the toolbar's own wrap-at-narrow-width and inset-ring
 * swatch fixes (already inside the 44,250 above); measured at 49,960 bytes;
 * raised again 2026-09-27 (48_000 -> 52_000). Then SC-NEXT #2/#3 adds the
 * grouped/favourited chart-type menu's own stylesheet (group headers, the
 * two-button row, the favourite star) and the bottom-right clock toggle's,
 * measuring 53,959 bytes; raised again 2026-09-28 (52_000 -> 58_000).
 */
const MAX_CSS_BYTES = 58_000;

/** Names a host imports today; they must exist at runtime and in the d.ts. */
export const PINNED = {
  ".": [
    "SuperChart", "KLineChartPro", "DefaultDatafeed", "chartStyles", "registerScriptIndicator", "runScript",
    "superlib", "loadLocales", "registerLanguage", "getLanguage", "listLanguages", "nlToSuperScript", "analyzeChart",
    "createHttpAIClient", "superscriptReference", "ChartDisposedError", "THEMES", "CHART_TYPES", "isTheme", "isChartType",
    "canvasTheme", "canvasFontStyles", "CANVAS_FONT", "ICON_FONT_FAMILY",
  ],
  "./lite": ["chartStyles", "canvasTheme", "canvasFontStyles", "CANVAS_FONT", "ICON_FONT_FAMILY", "registerExtensionOverlays", "registerScriptIndicator", "runScript", "superlib"],
  "./superscript": ["runScript", "registerLanguage", "getLanguage", "listLanguages", "SuperScriptLanguage", "JavaScriptLanguage", "superlib", "superscriptReference", "nlToSuperScript"],
};

// ---------------------------------------------------------------------------
// Pure checks (covered by --self-test)
// ---------------------------------------------------------------------------

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

/** Problems with "sideEffects". */
export function sideEffectsProblems(pkg) {
  const se = pkg.sideEffects;
  if (!Array.isArray(se)) return [`sideEffects must be an allow-list array, found ${JSON.stringify(se)}`];
  const problems = [];
  for (const required of ["./dist/klinecharts-pro.js", "./dist/klinecharts-pro.cjs", "./dist/klinecharts-pro.umd.js"]) {
    if (!se.includes(required)) problems.push(`sideEffects must list ${required} (the \`.\` entry registers overlays on import)`);
  }
  if (!se.some((p) => /\*\.css$/.test(p))) problems.push("sideEffects must keep CSS (\"*.css\")");
  return problems;
}

/** Bare module specifiers a built JS file imports or requires. */
export function bareImports(code) {
  const found = new Set();
  const add = (spec) => { if (!spec.startsWith(".") && !spec.startsWith("/")) found.add(spec); };
  for (const re of [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g, /\brequire\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const m of code.matchAll(re)) add(m[1]);
  }
  for (const m of code.matchAll(/\bdefine\(\s*\[([^\]]*)\]/g)) {
    for (const s of m[1].matchAll(/["']([^"']+)["']/g)) if (!["exports", "require", "module"].includes(s[1])) add(s[1]);
  }
  return [...found].sort();
}

/** A selector list split on its top-level commas (not those inside :where(), :is(), …). */
function splitSelectors(list) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) { out.push(list.slice(start, i)); start = i + 1; }
  }
  out.push(list.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** A selector's compounds and the combinators between them (' ', '>', '+', '~'), outside brackets and parentheses. */
function compounds(selector) {
  const parts = [];
  const combinators = [];
  let depth = 0, current = "", pending = null;
  for (const c of selector.trim()) {
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    if (depth === 0 && (c === " " || c === ">" || c === "+" || c === "~")) {
      if (current !== "") { parts.push(current); current = ""; pending = " "; }
      if (c !== " ") pending = c;
      continue;
    }
    if (pending !== null) { combinators.push(pending); pending = null; }
    current += c;
  }
  if (current !== "") parts.push(current);
  return { parts, combinators };
}

/** Which chart class a compound names outside :not()/:has()/… and attribute brackets: 'part' (.klinecharts-pro-x), 'root' (.klinecharts-pro) or null. */
function chartClass(compound) {
  let bare = compound;
  for (let prev = null; prev !== bare;) { prev = bare; bare = bare.replace(/\([^()]*\)|\[[^\]]*\]/g, ""); }
  const names = [...bare.matchAll(/\.klinecharts-pro(-[A-Za-z0-9_-]+)?(?![A-Za-z0-9_-])/g)];
  if (names.some((m) => m[1] !== undefined)) return "part";
  return names.length > 0 ? "root" : null;
}

/**
 * True when a selector can only match inside the chart: its subject names a
 * chart class, or an ancestor does (descendant or child combinator), or a
 * sibling does that is itself a chart part. A sibling of the root
 * (.klinecharts-pro ~ div), a class inside :has() or :not(), or no chart class
 * at all reaches host elements.
 */
export function selectorInChart(selector) {
  const { parts, combinators } = compounds(selector);
  if (parts.length === 0) return false;
  let i = parts.length - 1;
  if (chartClass(parts[i]) !== null) return true;
  for (; i > 0; i--) {
    const kind = chartClass(parts[i - 1]);
    const combinator = combinators[i - 1];
    if (kind === "part" || (kind === "root" && (combinator === " " || combinator === ">"))) return true;
  }
  return false;
}

/**
 * Problems with the shipped stylesheet: a rule whose selector can match
 * outside the chart would style host elements (the icon font's old
 * [class^="icon-"] rule did, with !important); an unprefixed @keyframes can
 * collide with a host's; more than one inlined font means duplicate formats.
 */
export function cssProblems(css) {
  const problems = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of text.matchAll(/@keyframes\s+([^\s{]+)/g)) {
    if (!m[1].startsWith("klinecharts-pro-")) problems.push(`@keyframes ${m[1]} is not prefixed klinecharts-pro-`);
  }
  // Drop @font-face and @keyframes bodies, unwrap @media/@supports, then check every rule's selectors.
  const rules = text
    .replace(/@font-face\s*\{[^}]*\}/g, "")
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "")
    .replace(/@(media|supports|container)[^{]*\{/g, "");
  for (const m of rules.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const selector of splitSelectors(m[1])) {
      if (!selectorInChart(selector)) problems.push(`selector outside the chart: ${selector}`);
    }
  }
  const fonts = [...text.matchAll(/url\(\s*["']?data:(?:font|application\/(?:font|x-font|vnd\.ms-fontobject))[^)]*\)/g)].length;
  if (fonts !== 1) problems.push(`expected exactly 1 inlined font, found ${fonts}`);
  return problems;
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

function selfTest() {
  const cases = [];
  const expect = (name, ok) => { cases.push(name); if (!ok) throw new Error(`self-test "${name}" failed`); };
  const pkg = { main: "./dist/a.cjs", exports: { ".": { import: { types: "./dist/a.d.ts", default: "./dist/a.js" } }, "./dist/*": "./dist/*", "./s.css": "./dist/s.css" } };
  expect("exportTargets walks conditions and skips patterns", JSON.stringify(exportTargets(pkg)) === JSON.stringify(["dist/a.cjs", "dist/a.d.ts", "dist/a.js", "dist/s.css"]));
  expect("sideEffects false is rejected", sideEffectsProblems({ sideEffects: false }).length === 1);
  expect("sideEffects without the entry is rejected", sideEffectsProblems({ sideEffects: ["*.css"] }).length === 3);
  expect("a complete sideEffects list passes", sideEffectsProblems({ sideEffects: ["*.css", "./dist/klinecharts-pro.js", "./dist/klinecharts-pro.cjs", "./dist/klinecharts-pro.umd.js"] }).length === 0);
  expect("bare imports: ESM, CJS, AMD and dynamic", JSON.stringify(bareImports(
    'import { a } from "klinecharts"; import "./x.js"; import b from "solid-js/web"; const c = require("lodash/set"); import("dyn"); define(["exports","klinecharts"], f)',
  )) === JSON.stringify(["dyn", "klinecharts", "lodash/set", "solid-js/web"]));
  expect("relative imports are not bare", bareImports('export { x } from "./vendor/solid-js/web/dist/web.js"').length === 0);
  const md = "text\n```ts\nconst a = 1\n```\n```bash\nnpm i\n```\n```ts\nconst b = 2\n```\n";
  expect("README ts blocks are extracted, others skipped", readmeSnippets(md).length === 2 && readmeSnippets(md)[1].startsWith("const b = 2"));
  const font = "@font-face{font-family:x;src:url(data:font/woff;base64,AA==) format('woff')}";
  expect("scoped CSS passes", cssProblems(`${font}.klinecharts-pro-a{color:red}.klinecharts-pro[data-theme=dark]{--x:1}@keyframes klinecharts-pro-spin{0%{top:0}100%{top:1px}}`).length === 0);
  expect("a global selector and an unprefixed keyframes are reported", cssProblems(`${font}[class^=icon-],.klinecharts-pro-a{color:red}@keyframes spin{0%{top:0}}`).length === 2);
  expect("commas inside :where() do not split a selector", cssProblems(`${font}.klinecharts-pro :where(button,input),.klinecharts-pro-b{color:red}`).length === 0);
  expect("font formats are counted", cssProblems(`${font}${font}.klinecharts-pro{color:red}`).length === 1);
  const one = (sel) => cssProblems(`${font}${sel}{color:red}`).length;
  expect("selectors that name the chart but reach host elements are reported",
    [".klinecharts-pro ~ div", ".klinecharts-pro+*", "body:has(.klinecharts-pro) .icon-x", ".icon-x:not(.klinecharts-pro)", "[class^=klinecharts-pro] .x", ".klinecharts-prox .y"]
      .every((sel) => one(sel) === 1));
  expect("descendants, parts' siblings and themed roots pass",
    [".klinecharts-pro .a + .b", ".klinecharts-pro-period-bar+.tools", ".klinecharts-pro[data-theme=\"dark\"] .x::before", ".klinecharts-pro>.a:nth-child(2n+1)", ".klinecharts-pro :where(button, input)", ".klinecharts-pro-list::-webkit-scrollbar"]
      .every((sel) => one(sel) === 0));
  const d = diffNames(["a", "superlib"], ["a"]);
  expect("parity reports a name the d.ts dropped", d.missingFromTypes[0] === "superlib" && d.missingAtRuntime.length === 0);
  console.log(`check-package self-test passed (${cases.length} cases)`);
}

// ---------------------------------------------------------------------------
// The packed package in a scratch consumer
// ---------------------------------------------------------------------------

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

/** klinecharts as bundlers see it: ESM for import, UMD (as CJS) for require. */
function installKlinecharts(consumer) {
  const real = join(root, "node_modules", "klinecharts");
  const version = JSON.parse(readFileSync(join(real, "package.json"), "utf8")).version;
  const dest = join(consumer, "node_modules", "klinecharts");
  mkdirSync(dest, { recursive: true });
  copyFileSync(join(real, "dist", "index.esm.js"), join(dest, "index.mjs"));
  copyFileSync(join(real, "dist", "umd", "klinecharts.js"), join(dest, "index.cjs"));
  copyFileSync(join(real, "dist", "index.d.ts"), join(dest, "index.d.ts"));
  writeFileSync(join(dest, "package.json"), JSON.stringify({
    name: "klinecharts", version, type: "module", types: "./index.d.ts",
    exports: { ".": { types: "./index.d.ts", import: "./index.mjs", require: "./index.cjs" } },
  }));
  return version;
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

// The consumers' import lines (SupWallet MainChart, StudioChart, lib/chart-theme;
// Broker and ProjectX import dynamically), plus the additive surface of this PR.
const FIXTURE_ESM = `
import {
  SuperChart, registerScriptIndicator, chartStyles, superlib, loadLocales, ChartDisposedError, THEMES,
  type ChartPro, type Datafeed, type Period, type SymbolInfo, type SuperChartInstance, type ChartProOptions, type Theme,
  type DatafeedSubscribeCallback, type DataStatesOption,
} from "${PACKAGE}";
import "${PACKAGE}/dist/klinecharts-pro.css";
import "${PACKAGE}/style.css";
import { chartStyles as liteStyles, superlib as liteSuperlib, registerExtensionOverlays } from "${PACKAGE}/lite";
import { runScript, registerLanguage, JavaScriptLanguage } from "${PACKAGE}/superscript";
import type { KLineData } from "klinecharts";

declare const datafeed: Datafeed;
declare const host: HTMLElement;
const symbol: SymbolInfo = { ticker: "BTC-USDT", pricePrecision: 2, priceCurrency: "USDT" };
const period: Period = { multiplier: 15, timespan: "minute", text: "15m" };
const options: ChartProOptions = { container: host, symbol, period, datafeed, theme: "dark", locale: "fr-FR", chartType: "area" };
const pro: SuperChartInstance = new SuperChart(options);
const asV1: ChartPro = pro;
pro.dispose();
const disposed: boolean = pro.isDisposed();
const theme: Theme = THEMES[0];
const styles = chartStyles(await import("klinecharts"), true);
const liteStyled = liteStyles;
const lib = [superlib.sma, liteSuperlib.ema];
registerExtensionOverlays();
registerScriptIndicator({ name: "X", source: "plot(close)" });
registerLanguage(JavaScriptLanguage);
const result = runScript("plot(sma(close, 3))", [] as KLineData[]);
const err: Error = new ChartDisposedError("setSymbol");
loadLocales("zh-TW", { indicator: "指標" });
// Broker / ProjectX: dynamic import of the main entry.
const mod = await import("${PACKAGE}");
const Ctor: typeof SuperChart = mod.SuperChart;

// The data loader's additive surface (02-loader-core): reload(), period
// shorthand, dataStates / tickThrottleMs, array ticks. A host datafeed written
// against the old single-bar callback type still satisfies Datafeed.
const loaderOptions: ChartProOptions = { ...options, dataStates: { empty: "Market closed" }, tickThrottleMs: 100 };
const noStates: ChartProOptions = { ...options, dataStates: false };
pro.reload();
pro.setPeriod("4H");
const oldStyleFeed: Datafeed = {
  searchSymbols: async () => [],
  getHistoryKLineData: async () => [] as KLineData[],
  subscribe (s: SymbolInfo, p: Period, callback: (d: KLineData) => void) { callback({ timestamp: 0, open: 1, high: 1, low: 1, close: 1 }); },
  unsubscribe () {},
};
const arrayTick: DatafeedSubscribeCallback = (d) => { void d; };
arrayTick([{ timestamp: 0, open: 1, high: 1, low: 1, close: 1 }]);

// Closed unions: these must stay compile errors.
// @ts-expect-error theme is 'light' | 'dark'
const badTheme: ChartProOptions = { ...options, theme: "drak" };
// @ts-expect-error chartType is a closed list
const badType: ChartProOptions = { ...options, chartType: "lin" };
// @ts-expect-error loadLocales takes a string dictionary
loadLocales("zh-TW", 12345);
// @ts-expect-error setTheme takes a Theme
pro.setTheme("drak");

const statesType: DataStatesOption = true;
export { asV1, disposed, theme, styles, liteStyled, lib, result, err, Ctor, badTheme, badType, loaderOptions, noStates, oldStyleFeed, statesType };
`;

const FIXTURE_CJS = `
import sc = require("${PACKAGE}");
import type { ChartPro, SuperChartInstance } from "${PACKAGE}";
const Ctor: typeof sc.SuperChart = sc.SuperChart;
const pro: SuperChartInstance | null = null;
const v1: ChartPro | null = pro;
export = { Ctor, v1 };
`;

const FIXTURE_NODE10 = `
import { SuperChart, superlib } from "${PACKAGE}";
import { chartStyles } from "${PACKAGE}/lite";
import { runScript } from "${PACKAGE}/superscript";
export { SuperChart, superlib, chartStyles, runScript };
`;

async function main() {
  const keep = process.argv.includes("--keep");
  const problems = [];
  const fail = (check, message) => problems.push(`[${check}] ${message}`);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!existsSync(join(root, "dist"))) throw new Error("dist/ is missing: run `bun run build` first.");

  const work = mkdtempSync(join(tmpdir(), "super-chart-check-"));
  try {
    // --- pack
    const packed = pack(work);
    const files = new Set(packed.files);
    for (const target of exportTargets(pkg)) if (!files.has(target)) fail("exports", `${target} is named in package.json but not packed`);
    for (const p of sideEffectsProblems(pkg)) fail("exports", p);
    const css = "dist/klinecharts-pro.css";
    if (!files.has(css)) fail("files", `${css} is not packed (every host imports it)`);
    const cssText = readFileSync(join(root, css), "utf8");
    for (const p of cssProblems(cssText)) fail("css", p);
    if (cssText.length > MAX_CSS_BYTES) fail("css", `${css} is ${cssText.length} bytes, budget ${MAX_CSS_BYTES}`);
    for (const f of files) {
      if (f.endsWith(".map")) fail("files", `source map packed: ${f}`);
      if (f.startsWith("dist/node_modules/")) fail("files", `dist/node_modules/ is packed (some pack tools drop it): ${f}`);
    }
    if (packed.size > MAX_PACKED_BYTES) fail("files", `packed tarball is ${packed.size} bytes, budget ${MAX_PACKED_BYTES}`);

    // --- consumers: one with klinecharts, one without
    const withKc = join(work, "consumer");
    const bare = join(work, "consumer-no-klinecharts");
    for (const dir of [withKc, bare]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
      installPackage(packed.tarball, dir);
    }
    const kcVersion = installKlinecharts(withKc);
    const plain = join(work, "consumer-plain-node");
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
    installPackage(packed.tarball, plain);
    cpSync(join(root, "node_modules", "klinecharts"), join(plain, "node_modules", "klinecharts"), { recursive: true });
    const installed = join(withKc, "node_modules", ...PACKAGE.split("/"));
    if (!existsSync(join(installed, css)) || statSync(join(installed, css)).size === 0) fail("files", `${css} is missing or empty after install`);

    // --- bare imports in every packed JS file
    for (const f of files) {
      if (!/\.(c|m)?js$/.test(f)) continue;
      const extra = bareImports(readFileSync(join(installed, f), "utf8")).filter((s) => s !== "klinecharts");
      if (extra.length) fail("bare-imports", `${f} imports ${extra.join(", ")}; only klinecharts may stay external`);
    }

    // --- runtime probes
    const ss = probe(bare, "superscript", `
      const ss = await import("${PACKAGE}/superscript");
      const bars = Array.from({ length: 30 }, (_, i) => ({ timestamp: i, open: 1 + i, high: 2 + i, low: i, close: 1 + i + (i % 2), volume: 1 }));
      const plots = ss.runScript('plot(rsi(close, 14), title="RSI")', bars).plots;
      let js = "ran";
      try { ss.runScript("return { meta: { title: 'x' }, plots: [] }", bars, "javascript"); } catch (e) { js = "rejected"; }
      let kc = "installed";
      try { await import("klinecharts"); } catch { kc = "absent"; }
      console.log(JSON.stringify({ names: Object.keys(ss).sort(), plots: plots.length, finite: Number.isFinite(plots[0].values[29]), js, kc }));
    `);
    if (!ss.ok) fail("superscript", `import or run failed without klinecharts:\n${ss.error}`);
    else {
      if (ss.value.kc !== "absent") fail("superscript", "klinecharts resolved in the no-klinecharts consumer; the check proves nothing");
      if (ss.value.plots !== 1 || !ss.value.finite) fail("superscript", `runScript returned ${JSON.stringify(ss.value)}`);
      if (ss.value.js !== "rejected") fail("superscript", "runScript ran \"javascript\" without an explicit registerLanguage()");
    }

    const lite = probe(withKc, "lite", `
      const kc = await import("klinecharts");
      const before = kc.getSupportedOverlays().length;
      const lite = await import("${PACKAGE}/lite");
      const afterImport = kc.getSupportedOverlays().length;
      const figureAfterImport = kc.getFigureClass("imageFig") !== null && kc.getFigureClass("imageFig") !== undefined;
      lite.registerExtensionOverlays();
      console.log(JSON.stringify({ names: Object.keys(lite).sort(), before, afterImport, figureAfterImport, afterRegister: kc.getSupportedOverlays().length, styles: typeof lite.chartStyles(kc, true) }));
    `);
    if (!lite.ok) fail("lite", `import failed:\n${lite.error}`);
    else {
      if (lite.value.afterImport !== lite.value.before || lite.value.figureAfterImport) fail("lite", `importing lite registered something (${JSON.stringify(lite.value)})`);
      if (lite.value.afterRegister <= lite.value.before) fail("lite", "registerExtensionOverlays() registered nothing");
      if (lite.value.styles !== "object") fail("lite", "chartStyles() did not return styles");
    }

    const mainProbe = probe(withKc, "main", `
      const kc = await import("klinecharts");
      const before = kc.getSupportedOverlays().length;
      const pro = await import("${PACKAGE}");
      const imageFig = kc.getFigureClass("imageFig");
      const lite = await import("${PACKAGE}/lite");
      const sameFigure = kc.getFigureClass("imageFig") === imageFig && imageFig != null;
      const lang = { id: "x-check", name: "X", compile: () => ({ meta: { title: "x" }, run: () => ({ meta: { title: "x" }, plots: [] }) }) };
      lite.registerLanguage(lang);
      const shared = lite.getLanguage === pro.getLanguage && pro.listLanguages().some((l) => l.id === "x-check");
      let bridged = "ok";
      try { pro.registerScriptIndicator({ name: "X_CHECK", source: "", language: "x-check" }); } catch (e) { bridged = String(e.message); }
      console.log(JSON.stringify({ names: Object.keys(pro).sort(), before, after: kc.getSupportedOverlays().length, figures: ["imageFig", "superChartHitPath"].filter((n) => kc.getFigureClass(n) != null), sameFigure, shared, bridged, document: typeof document }));
    `);
    if (!mainProbe.ok) fail("main", `import failed (it must not need a DOM):\n${mainProbe.error}`);
    else {
      const v = mainProbe.value;
      if (v.after <= v.before) fail("main", "importing `.` registered no extension overlays");
      if (v.figures.length !== 2) fail("main", `extension figures registered: ${v.figures.join(", ")}`);
      if (!v.sameFigure) fail("shared", "importing ./lite after `.` replaced the imageFig figure");
      if (!v.shared) fail("shared", "a language registered through ./lite is not visible through `.`");
      if (v.bridged !== "ok") fail("shared", `registerScriptIndicator could not use a language registered through ./lite: ${v.bridged}`);
    }

    const req = probe(withKc, "require", `
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      const cjs = require("${PACKAGE}");
      console.log(JSON.stringify({ names: Object.keys(cjs).sort(), ctor: typeof cjs.SuperChart, file: require.resolve("${PACKAGE}").split("node_modules").pop() }));
    `);
    if (!req.ok) fail("require", `require() failed:\n${req.error}`);
    else if (req.value.ctor !== "function" || !req.value.file.endsWith(".cjs")) fail("require", JSON.stringify(req.value));

    // Plain Node and the klinecharts package as published: what a Node tool
    // gets without a bundler. The README tells it to use ./superscript.
    const plainProbe = probe(plain, "plain-node", `
      import { createRequire } from "node:module";
      const out = {};
      const attempt = async (name, load) => { try { await load(); out[name] = "ok"; } catch (e) { out[name] = String(e?.message ?? e).slice(0, 160); } };
      await attempt(".", () => import("${PACKAGE}"));
      await attempt("require", () => createRequire(import.meta.url)("${PACKAGE}"));
      await attempt("./lite", () => import("${PACKAGE}/lite"));
      await attempt("./superscript", () => import("${PACKAGE}/superscript"));
      console.log(JSON.stringify(out));
    `);
    if (!plainProbe.ok) fail("plain-node", plainProbe.error);
    else {
      const v = plainProbe.value;
      for (const entry of ["./lite", "./superscript"]) {
        if (v[entry] !== "ok") fail("plain-node", `${entry} no longer imports in plain Node with the published klinecharts: ${v[entry]}`);
      }
      for (const entry of [".", "require"]) {
        if (v[entry] === "ok") {
          fail("plain-node", `${entry === "." ? "import" : "require()"} of \`.\` now works in plain Node with the published klinecharts. ` +
            "The README (after the Quick start) says it does not: correct it, src/readme.test.ts and this check");
        }
      }
    }

    const cssProbe = probe(withKc, "css", `
      const a = import.meta.resolve("${PACKAGE}/style.css");
      const b = import.meta.resolve("${PACKAGE}/dist/klinecharts-pro.css");
      console.log(JSON.stringify({ same: a === b, a }));
    `);
    if (!cssProbe.ok) fail("css", cssProbe.error);
    else if (!cssProbe.value.same || !cssProbe.value.a.endsWith("/dist/klinecharts-pro.css")) fail("css", JSON.stringify(cssProbe.value));

    // --- parity and types
    const ts = createRequire(join(root, "package.json"))("typescript");
    const node16 = {
      module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, target: ts.ScriptTarget.ES2022,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], strict: true, skipLibCheck: false, noEmit: true, types: [],
    };
    const runtime = { ".": mainProbe.value?.names, "./lite": lite.value?.names, "./superscript": ss.value?.names };
    const declared = declaredExports(ts, withKc, Object.keys(runtime).map((s) => (s === "." ? PACKAGE : `${PACKAGE}/${s.slice(2)}`)), node16);
    for (const [entry, names] of Object.entries(runtime)) {
      const spec = entry === "." ? PACKAGE : `${PACKAGE}/${entry.slice(2)}`;
      if (!names) continue; // the runtime probe already failed
      if (!declared[spec]) { fail("parity", `${spec}: TypeScript cannot resolve its d.ts`); continue; }
      const d = diffNames(names, declared[spec]);
      if (d.missingFromTypes.length) fail("parity", `${spec}: exported at runtime but not in the d.ts: ${d.missingFromTypes.join(", ")}`);
      if (d.missingAtRuntime.length) fail("parity", `${spec}: declared in the d.ts but not exported at runtime: ${d.missingAtRuntime.join(", ")}`);
      const pinnedMissing = PINNED[entry].filter((n) => !names.includes(n));
      if (pinnedMissing.length) fail("main", `${spec} no longer exports ${pinnedMissing.join(", ")}`);
    }
    if (req.value && mainProbe.value) {
      const d = diffNames(req.value.names, mainProbe.value.names);
      if (d.missingFromTypes.length || d.missingAtRuntime.length) fail("require", `the CommonJS build exports differ from the ES build: ${JSON.stringify(d)}`);
    }

    writeFileSync(join(withKc, "fixture.ts"), FIXTURE_ESM);
    writeFileSync(join(withKc, "fixture-cjs.cts"), FIXTURE_CJS);
    writeFileSync(join(withKc, "fixture-node10.ts"), FIXTURE_NODE10);
    for (const e of tsc(ts, withKc, "node16", ["fixture.ts"], node16)) fail("types", `node16: ${e}`);
    // The CommonJS types with skipLibCheck: klinecharts ships only ESM-typed
    // declarations ("type": "module"), so under node16 no CommonJS file can
    // type-check klinecharts' own d.ts. This still proves the require
    // condition finds index.d.cts and that it declares the API.
    for (const e of tsc(ts, withKc, "node16-cjs", ["fixture-cjs.cts"], { ...node16, skipLibCheck: true })) fail("types", `node16 CommonJS: ${e}`);
    const node10 = { ...node16, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs };
    for (const e of tsc(ts, withKc, "node10", ["fixture-node10.ts"], node10)) fail("types", `moduleResolution node: ${e}`);

    // --- the packed README's TypeScript examples compile against the packed d.ts
    const blocks = readmeSnippets(readFileSync(join(installed, "README.md"), "utf8"));
    if (blocks.length === 0) fail("readme", "README.md has no ```ts examples to check");
    const snippetFiles = blocks.map((code, i) => { const name = `readme-${i + 1}.ts`; writeFileSync(join(withKc, name), code); return name; });
    for (const e of tsc(ts, withKc, "readme", snippetFiles, node16)) fail("readme", e);

    if (problems.length) {
      console.error(`${PACKAGE} package check failed (klinecharts ${kcVersion}):\n  - ${problems.join("\n  - ")}`);
      process.exitCode = 1;
      return;
    }
    console.log(`${PACKAGE} package check passed: ${files.size} files, ${packed.size} bytes packed; ` +
      `entries . (${runtime["."].length} exports), ./lite (${runtime["./lite"].length}), ./superscript (${runtime["./superscript"].length}); ` +
      `bundler-resolved import/require, plain-Node limits, d.ts parity and consumer type-check against klinecharts ${kcVersion}`);
  } finally {
    if (keep) console.log(`kept ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--self-test")) selfTest();
  else main().catch((err) => { console.error(err.stack ?? err.message); process.exit(1); });
}
