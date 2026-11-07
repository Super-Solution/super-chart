/**
 * SuperScript — the SUPer-Chart indicator / strategy language.
 *
 * A small, TradingView-Pine-flavoured language for computing indicators over a
 * candle series. The runtime is language-pluggable (`ScriptLanguage`): SuperScript
 * is the built-in, and other languages plug into the same pipeline, so a script
 * in any registered language produces the same `ScriptResult` and renders
 * through the same chart bridge (`registerScriptIndicator`).
 *
 * The language itself is in ./language.ts (tokenizer, parser, checker,
 * evaluator), its built-ins in ./builtins.ts (one signature table that also
 * generates `superscriptReference()`), and the series math in src/ta.
 * `compile()` parses once and reports every problem with its line and column
 * (`checkSuperScript()` lists them without throwing); `run()` only evaluates.
 *
 * Part of Super Chart.
 */

// Named imports: dts-bundle-generator cannot inline a namespace import into the
// public d.ts (superlib's type would name an unexported `ta`).
import { ta, type Series } from "@supersolutions/super-chart-core";
import { builtinReferenceLines } from "./builtins";
import { SuperScriptError, diag, type Diagnostic } from "./diagnostics";
import { check, evaluate, parse } from "./language";

export { SuperScriptError, isSuperScriptError, formatDiagnostics } from "./diagnostics";
export type { Diagnostic, DiagnosticCode, DiagnosticSeverity } from "./diagnostics";

// One declaration of Series: the d.ts bundler cannot rename a second one.
export type { Series };

export interface Bar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface PlotStyle {
  color?: string;
  lineWidth?: number;
  type?: "line" | "histogram" | "circle";
  /** Where a histogram's bars start (default 0). On a log- or percentage-scaled
   *  price pane 0 is off the scale and the bars vanish: set it to a price there. */
  histbase?: number;
  /** Line dash; hline() levels are dashed. */
  lineStyle?: "solid" | "dashed" | "dotted";
}

export interface Plot {
  id: string;
  title: string;
  values: Series;
  style?: PlotStyle;
  /** "hline" for a constant level drawn with hline(). */
  kind?: "plot" | "hline";
}

/** One `input()` of a script: what a settings form or an agent can change. */
export interface ScriptInput {
  /** The name it is bound to (`len = input(14)` → "len"), else "in<index>". */
  id: string;
  title: string;
  defval: number;
  min?: number;
  max?: number;
  step?: number;
  type: "int" | "float";
}

/** Input values for `run()`: by position (the order of `meta.inputs`) or by input id. */
export type ScriptParams = ReadonlyArray<number | null | undefined> | Readonly<Record<string, number | null | undefined>>;

export interface ScriptMeta {
  title: string;
  /** The script's inputs in source order (SuperScript). */
  inputs?: ScriptInput[];
  /** True when the script declares `// @overlay` (it plots on the price scale). */
  overlay?: boolean;
}

export interface ScriptResult {
  meta: ScriptMeta;
  plots: Plot[];
  /** Warnings from compiling the script (SuperScript). */
  diagnostics?: Diagnostic[];
}

/** A pluggable script language (SuperScript, JavaScript, …). */
export interface ScriptLanguage {
  id: string;
  name: string;
  compile(source: string): CompiledScript;
}

export interface CompiledScript {
  meta: ScriptMeta;
  /** Evaluate over bars. `params` overrides the inputs (clamped to their minval/maxval). */
  run(bars: Bar[], params?: ScriptParams): ScriptResult;
  /** Warnings (a script with errors does not compile). */
  diagnostics?: Diagnostic[];
}

export interface CompileOptions {
  /** Throw on warnings too (ignored statements, unknown plot keywords, …). */
  strict?: boolean;
}

// --------------------------------------------------------------------------
// Series helpers (the SuperScript standard library): the TA core in super-chart-core.
// --------------------------------------------------------------------------
const { sma, ema, rsi, highest, lowest, crossover, crossunder, wma, stdev, change, roc, trueRange, atr, sum, dev, mom, linreg, rma, hma, vwma } = ta
const SUPERLIB = {
  sma,
  ema,
  rsi,
  highest,
  lowest,
  crossover,
  crossunder,
  wma,
  stdev,
  change: (src: Series): Series => change(src),
  roc,
  tr: trueRange,
  atr,
  sum,
  dev,
  mom,
  linreg,
  rma,
  hma,
  vwma,
};

// --------------------------------------------------------------------------
// SuperScript
// --------------------------------------------------------------------------

function compileSuperScript(source: string, options: CompileOptions = {}): CompiledScript {
  const program = parse(source);
  const checked = check(program);
  const diagnostics = checked.diagnostics;
  const firstError = diagnostics.find((d) => d.severity === "error");
  if (firstError !== undefined) throw new SuperScriptError(firstError, diagnostics);
  if (options.strict === true && diagnostics.length > 0) throw new SuperScriptError(diagnostics[0], diagnostics);
  const meta = (): ScriptMeta => ({ title: program.title, inputs: checked.inputs.map((i) => ({ ...i })), overlay: program.overlay });
  return {
    meta: meta(),
    diagnostics,
    run(bars: Bar[], params?: ScriptParams): ScriptResult {
      const r = evaluate(program, bars, params);
      return { meta: meta(), plots: r.plots, diagnostics };
    },
  };
}

/**
 * Every problem in a SuperScript source, errors and warnings, each with its
 * line, column and (often) a hint. Never throws; an empty list means the
 * script compiles cleanly. This is what an editor or an AI repair loop reads.
 */
export function checkSuperScript(source: string): Diagnostic[] {
  try {
    return check(parse(source)).diagnostics;
  } catch (e) {
    return [diag("error", "UNSUPPORTED", `internal error: ${String(e)}`, { line: 1, col: 1, endCol: 1 })];
  }
}

// --------------------------------------------------------------------------
// Language registry (SuperScript built-in + an opt-in JavaScript adapter)
// --------------------------------------------------------------------------
export const SuperScriptLanguage: ScriptLanguage & { compile: (source: string, options?: CompileOptions) => CompiledScript } = {
  id: "superscript",
  name: "SuperScript",
  compile: compileSuperScript,
};

/** JavaScript language adapter — the script body is `(ctx) => ScriptResult`.
 * Not registered by default: `registerLanguage(JavaScriptLanguage)` opts in.
 * It evaluates the source with `new Function` in the host page (full code
 * execution); never pass it a script from a model, a user or a tool call. */
export const JavaScriptLanguage: ScriptLanguage = {
  id: "javascript",
  name: "JavaScript",
  compile(source: string): CompiledScript {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function("ctx", `"use strict"; ${source}`) as (ctx: { bars: Bar[]; lib: typeof SUPERLIB }) => ScriptResult;
    return { meta: { title: "JavaScript" }, run: (bars) => fn({ bars, lib: SUPERLIB }) };
  },
};

const LANGUAGES = new Map<string, ScriptLanguage>();
export function registerLanguage(lang: ScriptLanguage): void { LANGUAGES.set(lang.id, lang); }
export function getLanguage(id: string): ScriptLanguage | undefined { return LANGUAGES.get(id); }
export function listLanguages(): ScriptLanguage[] { return [...LANGUAGES.values()]; }
registerLanguage(SuperScriptLanguage);
// JavaScript is opt-in: it runs its source with `new Function`, in the page's
// origin, as soon as a script is compiled (registerScriptIndicator compiles and
// runs it at once). A host that wants it calls registerLanguage(JavaScriptLanguage).

/** Compile + run a script in one call. */
export function runScript(source: string, bars: Bar[], languageId = "superscript", params?: ScriptParams): ScriptResult {
  const lang = getLanguage(languageId);
  if (lang === undefined) throw new Error(`unknown language: ${languageId}`);
  return lang.compile(source).run(bars, params);
}

/** Human/LLM-readable catalog of the SuperScript vocabulary, generated from the
 *  same signature table the checker uses, so the docs and the AI system prompt
 *  cannot drift from the language. */
export function superscriptReference(): string {
  return [
    "Series: open, high, low, close, volume, hl2, hlc3, ohlc4, bar_index, time. History: close[1], close[len] (a constant whole number >= 0). na is the missing value; x/0, log(0) and other non-finite results are na.",
    "Operators: + - * / %, comparison < <= > >= == !=, logic and/or/not (also && || !), ternary cond ? a : b.",
    "Bind variables: name = expr, one statement per line (a line continues inside brackets or after an operator). Declare params: len = input(14, title=\"Length\", minval=1, maxval=200, step=1); input(14, \"Length\") also works. Lengths and offsets must be constants: numbers, inputs, or arithmetic on them.",
    ...builtinReferenceLines(),
    "Draw: plot(expr, title=\"...\", color=\"#rrggbb\", type=\"line\"|\"histogram\"|\"circle\", lineWidth=1, histbase=0); histogram bars grow from histbase. hline(price, title=\"...\", color=\"#rrggbb\") draws a dashed level.",
    "Start the script with // @title <name>. Add // @overlay when it plots on the price scale (drawn over the candles).",
    "Not supported (an error names the line): := and += (bindings are single-assignment series; bind a new name), if/for/while (use cond ? a : b), function definitions, request.*, strings or colours as values. Ignored with a warning: var, strategy.*, plotshape, plotchar, bgcolor, fill, alertcondition.",
    "Pine names are accepted where the arguments match: ta.sma … ta.pivotlow, math.abs … math.sum, input.int, input.float, color.red …, plot.style_*, indicator(\"Name\", overlay=true). ta.cci and ta.mfi only over hlc3; ta.stoch only as ta.stoch(close, high, low, len); ta.vwap is session-anchored and has no equivalent.",
  ].join("\n");
}

// A direct `export const`: dts-bundle-generator 7 drops `export { SUPERLIB as
// superlib }` when the module is reached through `export *`, so the name was
// missing from both d.ts files although the bundles export it.
export const superlib = SUPERLIB;
// The klinecharts bridge (`registerScriptIndicator`) is re-exported by the
// browser entries (src/index.ts, src/lite.ts), not from here, so this module and
// the `./superscript` subpath built on it never import klinecharts.
