import { describe, expect, it } from "vitest";

import {
  SuperScriptLanguage, checkSuperScript, isSuperScriptError, runScript, superlib, superscriptReference,
  formatDiagnostics, SuperScriptError, type Bar, type Diagnostic,
} from "./index";
import * as ta from "../ta";

function closes(cs: number[]): Bar[] {
  return cs.map((c, i) => ({ timestamp: i, open: c, high: c, low: c, close: c, volume: 1 }));
}
/** Wavy OHLCV bars with real ranges. */
function wavy(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const o = 100 + 25 * Math.sin(i / 40) + 10 * Math.sin(i / 11) + 4 * Math.sin(i / 3.3);
    const c = 100 + 25 * Math.sin((i + 1) / 40) + 10 * Math.sin((i + 1) / 11) + 4 * Math.sin((i + 1) / 3.3);
    const w = 0.6 + 1.8 * Math.abs(Math.sin(i / 3));
    return { timestamp: i * 60_000, open: o, high: Math.max(o, c) + w, low: Math.min(o, c) - w, close: c, volume: 500 + 400 * Math.abs(Math.sin(i / 5)) };
  });
}
const values = (src: string, bars: Bar[]): Array<number | null> => runScript(src, bars).plots[0].values;

/** The error compile() throws for `src`, as a SuperScriptError. */
function compileError(src: string): SuperScriptError {
  try {
    SuperScriptLanguage.compile(src);
  } catch (e) {
    if (isSuperScriptError(e)) return e;
    throw new Error(`not a SuperScriptError: ${String(e)}`);
  }
  throw new Error(`compiled without an error: ${src}`);
}
const errors = (src: string): Diagnostic[] => checkSuperScript(src).filter((d) => d.severity === "error");
const warnings = (src: string): Diagnostic[] => checkSuperScript(src).filter((d) => d.severity === "warning");

// SC-162: inputs that used to give plausible wrong numbers.
describe("SuperScript: no silent wrong numbers", () => {
  const bars = closes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  it("reads .5 and 1e-3 as numbers (the tokenizer used to skip the '.')", () => {
    expect(values("plot(close * .5)", bars).slice(-2)).toEqual([4.5, 5]);
    expect(values("plot(close * 1e-3)", bars)[9]).toBeCloseTo(0.01, 12);
    expect(values("plot(close * 2.5e1)", bars)[0]).toBe(25);
  });

  it("uses a constant history offset from a variable, an input or arithmetic", () => {
    const want = [null, null, 1, 2, 3, 4, 5, 6, 7, 8];
    expect(values("n = 2\nplot(close[n])", bars)).toEqual(want);
    expect(values("len = input(2)\nplot(close[len])", bars)).toEqual(want);
    expect(values("plot(close[1+1])", bars)).toEqual(want);
    expect(values("plot(sma(close, 2)[1])", bars).slice(0, 4)).toEqual([null, null, 1.5, 2.5]);
  });

  it("rejects a negative or varying offset instead of reading offset 0", () => {
    const neg = compileError("plot(close[-1])");
    expect([neg.code, neg.line, neg.col]).toEqual(["BAD_OFFSET", 1, 12]);
    expect(neg.hint).toMatch(/future/);
    expect(compileError("x = close\nplot(close[close > open ? 1 : 2])").code).toBe("BAD_OFFSET");
    expect(compileError("plot(close[1.5])").code).toBe("BAD_OFFSET");
  });

  it("rejects := and += with the line and column, instead of dropping the line", () => {
    const e = compileError("x = close\nx := x * 2\nplot(x)");
    expect([e.code, e.line, e.col, e.endCol]).toEqual(["REASSIGNMENT", 2, 3, 5]);
    expect(e.hint).toMatch(/single-assignment/);
    expect(compileError("x = close\nx += 1\nplot(x)").code).toBe("REASSIGNMENT");
  });

  it("rejects trailing tokens and unknown characters", () => {
    const t = compileError("plot(close) garbage 99");
    expect([t.code, t.line, t.col]).toEqual(["TRAILING_TOKENS", 1, 13]);
    const pow = compileError("y = close ^ 2\nplot(y)");
    expect([pow.code, pow.line, pow.col]).toEqual(["UNEXPECTED_CHAR", 1, 11]);
    expect(pow.hint).toMatch(/pow\(a, b\)/);
    expect(compileError("plot(close $ 2)").code).toBe("UNEXPECTED_CHAR");
  });

  it("checks arity, lengths and argument kinds from one signature table", () => {
    expect(compileError("plot(sma(close))").code).toBe("ARITY");
    expect(compileError("plot(sma(close, 3, 99, 100))").code).toBe("ARITY");
    expect(compileError("plot(sma(close, -3))").code).toBe("BAD_LENGTH");
    expect(compileError("plot(wma(close, 4.5))").code).toBe("BAD_LENGTH");
    const series = compileError("plot(sma(close, close))");
    expect([series.code, series.col]).toEqual(["EXPECTED_CONSTANT", 17]);
    // Pine's argument order used to coerce the source into a length and plot nothing.
    const cci = compileError("plot(cci(close, 20))");
    expect(cci.code).toBe("ARITY");
    expect(compileError("plot(rsi(close))").code).toBe("ARITY");
    expect(compileError("plot(tr(1))").code).toBe("ARITY");
    expect(compileError("plot(sar(close))").code).toBe("EXPECTED_CONSTANT");
  });

  it("rejects control flow, function definitions and assigning a built-in series", () => {
    expect(compileError("if close > open\n    plot(close)").code).toBe("CONTROL_FLOW");
    expect(compileError("f(x) => x * 2\nplot(f(close))").code).toBe("FUNCTION_DEF");
    expect(compileError("close = 1\nplot(close)").code).toBe("BUILTIN_REASSIGNED");
  });

  it("looks identifiers up as own names only (no Object.prototype)", () => {
    expect(compileError("plot(constructor)").code).toBe("UNKNOWN_IDENTIFIER");
    expect(compileError("plot(__proto__)").code).toBe("UNKNOWN_IDENTIFIER");
    expect(compileError("x = close constructor 1\nplot(x)").code).toBe("TRAILING_TOKENS");
  });

  it("continues a statement inside brackets and after an operator", () => {
    expect(values("x = sma(close,\n    3)\nplot(x)", bars)).toEqual(values("plot(sma(close, 3))", bars));
    expect(values("x = close +\n  1\nplot(x)", bars)[0]).toBe(2);
    expect(compileError("x = sma(close, 3\nplot(x)").code).toBe("UNBALANCED");
  });
});

// SC-138: diagnostics a person or an AI repair loop can act on.
describe("SuperScript: diagnostics", () => {
  it("gives the line, column, code and a hint; the error is recognisable", () => {
    const src = "// @title T\nfast = sma(close, 10)\nplot(clos)";
    const e = compileError(src);
    expect(e.name).toBe("SuperScriptError");
    expect(e).toBeInstanceOf(SuperScriptError);
    expect([e.code, e.line, e.col, e.endCol]).toEqual(["UNKNOWN_IDENTIFIER", 3, 6, 10]);
    expect(e.hint).toBe("did you mean 'close'?");
    expect(e.message).toMatch(/unknown identifier 'clos' \(line 3, col 6\)/);
    expect(e.diagnostics).toHaveLength(1);
    expect(formatDiagnostics(e.diagnostics, src)).toBe(
      "line 3, col 6: error UNKNOWN_IDENTIFIER: unknown identifier 'clos' (did you mean 'close'?)\n  plot(clos)\n       ^^^^");
  });

  it("isSuperScriptError recognises the brand from any copy of the package, not just this class", () => {
    const foreign = Object.assign(new Error("x"), { [Symbol.for("zzyzx.superscript.error")]: true });
    expect(isSuperScriptError(foreign)).toBe(true);
    expect(isSuperScriptError(new Error("unknown identifier"))).toBe(false);
    expect(isSuperScriptError(null)).toBe(false);
  });

  it("compile() parses: a broken script throws at compile, not at run", () => {
    expect(() => SuperScriptLanguage.compile("plot(nope(")).toThrow(/never closed/);
    expect(compileError("plot(frobnicate(close, 3))").code).toBe("UNKNOWN_FUNCTION");
  });

  it("checkSuperScript lists every problem in order, without throwing", () => {
    const d = checkSuperScript("a = clos\nb = sma(close)\nc = close ^ 2\nplot(a)\nplot(b)");
    expect(d.map((x) => [x.severity, x.code, x.line])).toEqual([
      ["error", "UNKNOWN_IDENTIFIER", 1],
      ["error", "ARITY", 2],
      ["error", "UNEXPECTED_CHAR", 3],
    ]);
    expect(checkSuperScript("plot(close)")).toEqual([]);
  });

  it("warns (does not fail) on statements it ignores, and strict mode turns warnings into errors", () => {
    expect(warnings("plotshape(close > open)\nplot(close)").map((d) => d.code)).toEqual(["IGNORED_STATEMENT"]);
    expect(warnings("strategy(\"S\")\nplot(close)").map((d) => d.code)).toEqual(["IGNORED_STATEMENT"]);
    expect(warnings("sma(close, 10)\nplot(close)").map((d) => d.code)).toEqual(["UNUSED_EXPRESSION"]);
    expect(warnings("plot(close, foo=1)").map((d) => d.code)).toEqual(["UNKNOWN_KEYWORD"]);
    expect(warnings("var x = close\nplot(x)").map((d) => d.code)).toEqual(["IGNORED_KEYWORD"]);
    expect(warnings("x = 1").map((d) => d.code)).toEqual(["NO_PLOTS"]);
    const compiled = SuperScriptLanguage.compile("plotshape(close > open)\nplot(close)");
    expect(compiled.diagnostics?.map((d) => d.code)).toEqual(["IGNORED_STATEMENT"]);
    expect(compiled.run(closes([1, 2])).plots).toHaveLength(1);
    expect(() => SuperScriptLanguage.compile("plotshape(close > open)\nplot(close)", { strict: true })).toThrow(/plotshape/);
  });

  it("accepts Pine names where the arguments match, and refuses them where they do not", () => {
    const bars = wavy(120);
    const src = [
      "//@version=5",
      'indicator("Pine RSI", overlay=false)',
      'len = input.int(14, "Length", minval=1)',
      "r = ta.rsi(close, len)",
      "m = math.max(r, 30)",
      'plot(m, "RSI", color.purple, 2, plot.style_columns)',
      "plot(ta.cci(hlc3, 20))",
      "plot(ta.stoch(close, high, low, 14))",
    ].join("\n");
    const r = runScript(src, bars);
    expect(checkSuperScript(src)).toEqual([]);
    expect(r.meta.title).toBe("Pine RSI");
    expect(r.plots[0].style).toEqual({ color: "#9C27B0", lineWidth: 2, type: "histogram" });
    expect(r.plots[0].values).toEqual(ta.rsi(bars.map((b) => b.close), 14).map((v) => (v == null ? null : Math.max(v, 30))));
    expect(r.plots[1].values).toEqual(values("plot(cci(20))", bars));
    expect(r.plots[2].values).toEqual(values("plot(stoch(14))", bars));
    expect(compileError("plot(ta.cci(close, 20))").code).toBe("PINE_MISMATCH");
    expect(compileError("plot(ta.vwap)").code).toBe("PINE_MISMATCH");
    expect(compileError("plot(request.security(\"X\", \"D\", close))").code).toBe("UNSUPPORTED");
    expect(compileError("plot(close, color=color.new(color.red, 50))").code).toBe("UNSUPPORTED");
  });
});

// The reference is the AI system prompt: everything it documents must compile.
describe("SuperScript: the reference compiles", () => {
  const bars = wavy(300);

  it("every function in the reference compiles and plots a value", () => {
    const ref = superscriptReference();
    const calls = new Set<string>();
    for (const m of ref.matchAll(/\b([a-z][a-z0-9]*)\(([a-z,=.0-9]*)\)/g)) {
      if (["plot", "hline", "input"].includes(m[1])) continue;
      calls.add(`${m[1]}(${m[2]})`);
    }
    expect(calls.size).toBeGreaterThan(40);
    for (const sig of calls) {
      const call = sig.replace(/\(([^)]*)\)/, (_x, args: string) => "(" + args.split(",").filter(Boolean).map((a) => {
        const name = a.split("=")[0];
        if (a.includes("=")) return a.split("=")[1];
        const sample: Record<string, string> = { src: "close", a: "close", b: "open", x: "close - open", cond: "close > open", replacement: "0", len: "14", left: "2", right: "2", occurrence: "0", offset: "0" };
        return sample[name] ?? "close";
      }).join(", ") + ")");
      const src = `plot(${call})`;
      expect(errors(src), src).toEqual([]);
      const v = values(src, bars);
      expect(v.some((x) => x != null && Number.isFinite(x)), `${src} plots a value`).toBe(true);
    }
  });

  it("its input(), plot() and hline() examples compile", () => {
    const ref = superscriptReference();
    const inputs = [...ref.matchAll(/input\((?:[^()]|\([^()]*\))*\)/g)].map((m) => m[0]);
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    for (const inp of inputs) {
      const src = `len = ${inp}\nplot(sma(close, len))`;
      expect(checkSuperScript(src), src).toEqual([]);
    }
    const plotEx = (/plot\(expr, ([^\n]*?)\);/.exec(ref) ?? ["", ""])[1].replace('type="line"|"histogram"|"circle"', 'type="histogram"').replace(/"\.\.\."/, '"T"');
    expect(checkSuperScript(`plot(close, ${plotEx})`)).toEqual([]);
    expect(checkSuperScript('plot(close)\nhline(70, title="OB", color="#ff0000")')).toEqual([]);
  });

  it("the README's scripts and SupWallet StudioChart's two scripts (verbatim) compile and plot", () => {
    // frontend/sup-wallet/apps/web/src/components/strategy/StudioChart.tsx
    const smaCross = `
        // @title SuperScript SMA Cross
        fast = sma(close, 10)
        slow = sma(close, 30)
        plot(fast, title="Fast 10", color="#2962ff")
        plot(slow, title="Slow 30", color="#ff9800")
      `;
    const rsiScript = `
        // @title SuperScript RSI
        plot(rsi(close, 14), title="RSI 14", color="#ab47bc")
      `;
    // README.md "SuperScript → on the chart"
    const readme = `
    // @title SMA Cross
    fast = sma(close, 10)
    slow = sma(close, 30)
    plot(fast, title="Fast", color="#2962ff")
    plot(slow, title="Slow", color="#ff6d00")
  `;
    for (const [src, title, plots] of [[smaCross, "SuperScript SMA Cross", 2], [rsiScript, "SuperScript RSI", 1], [readme, "SMA Cross", 2]] as const) {
      expect(checkSuperScript(src)).toEqual([]);
      const r = runScript(src, bars);
      expect(r.meta.title).toBe(title);
      expect(r.plots).toHaveLength(plots);
      expect(r.plots.every((p) => p.values.some((v) => v != null))).toBe(true);
    }
    expect(runScript(smaCross, bars).plots.map((p) => [p.title, p.style])).toEqual([
      ["Fast 10", { color: "#2962ff" }],
      ["Slow 30", { color: "#ff9800" }],
    ]);
  });
});

// SC-166: inputs are declared, listed and settable.
describe("SuperScript: input()", () => {
  const bars = closes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  it("parses the documented forms and lists them on meta.inputs", () => {
    const c = SuperScriptLanguage.compile('len = input(14, title="Length", minval=1, maxval=50, step=1)\nk = input.float(2, "Mult")\nplot(sma(close, len) * k + input(0.5))');
    expect(c.meta.inputs).toEqual([
      { id: "len", title: "Length", defval: 14, min: 1, max: 50, step: 1, type: "int" },
      { id: "k", title: "Mult", defval: 2, type: "float" },
      { id: "in2", title: "in2", defval: 0.5, type: "float" },
    ]);
    expect(SuperScriptLanguage.compile("plot(close)").meta.inputs).toEqual([]);
    expect(compileError("len = input(14, colour=1)\nplot(close)").code).toBe("UNKNOWN_ARGUMENT");
    expect(compileError("len = input(close)\nplot(close)").code).toBe("EXPECTED_CONSTANT");
  });

  it("run(bars, params) overrides inputs by position or id, clamped and rounded", () => {
    const c = SuperScriptLanguage.compile('len = input(3, title="Length", minval=2, maxval=5)\nplot(sma(close, len))');
    expect(c.run(bars).plots[0].values[9]).toBe(9); // (8+9+10)/3
    expect(c.run(bars, [5]).plots[0].values[9]).toBe(8); // (6+..+10)/5
    expect(c.run(bars, { len: 2 }).plots[0].values[9]).toBe(9.5);
    expect(c.run(bars, [1]).plots[0].values[9]).toBe(9.5); // clamped to minval 2
    expect(c.run(bars, [99]).plots[0].values[9]).toBe(8); // clamped to maxval 5
    expect(c.run(bars, [3.6]).plots[0].values[9]).toBe(8.5); // int input: rounded to 4
    expect(c.run(bars, [null]).plots[0].values[9]).toBe(9); // default
    expect(runScript('len = input(3)\nplot(sma(close, len))', bars, "superscript", [4]).plots[0].values[9]).toBe(8.5);
  });

  it("a parameter that breaks the script throws a SuperScriptError with the position", () => {
    const c = SuperScriptLanguage.compile("len = input(4)\nplot(sma(close, len - 3))");
    expect(() => c.run(bars, [3])).toThrow(/sma\(\)'s len must be a whole number >= 1, got 0 \(line 2, col 17\)/);
  });
});

// SC-175: the common Pine indicators a script needs.
describe("SuperScript: hma, vwma, na, hline", () => {
  const bars = wavy(200);
  const close = bars.map((b) => b.close);

  it("hma and vwma", () => {
    expect(values("plot(hma(close, 9))", bars)).toEqual(ta.hma(close, 9));
    expect(values("plot(hma(close, 16))", bars)).toEqual(ta.hma(close, 16));
    expect(compileError("plot(hma(close, 1))").code).toBe("BAD_LENGTH");
    const vb: Bar[] = [10, 20, 30, 40].map((c, i) => ({ timestamp: i, open: c, high: c, low: c, close: c, volume: [1, 3, 0, 0][i] }));
    expect(values("plot(vwma(close, 2))", vb)).toEqual([null, 17.5, 20, null]);
    const missing: Bar[] = vb.map((b, i) => (i === 1 ? { ...b, volume: undefined } : b));
    expect(values("plot(vwma(close, 2))", missing)).toEqual([null, null, null, null]);
  });

  it("a bare na is the missing value; na(x) still tests for it", () => {
    expect(values("x = close > 2 ? close : na\nplot(x)", closes([1, 2, 3]))).toEqual([null, null, 3]);
    expect(values("plot(na(close > 2 ? close : na))", closes([1, 2, 3]))).toEqual([1, 1, 0]);
    expect(values("plot(nz(na, 5))", closes([1, 2]))).toEqual([5, 5]);
  });

  it("hline draws a constant, dashed level", () => {
    const r = runScript('plot(rsi(close, 14))\nhline(70, title="Overbought", color="#ff0000")\nhline(30)', bars);
    expect(r.plots.map((p) => [p.id, p.title, p.kind, p.style])).toEqual([
      ["p0", "plot 1", undefined, {}],
      ["p1", "Overbought", "hline", { lineStyle: "dashed", color: "#ff0000" }],
      ["p2", "", "hline", { lineStyle: "dashed" }],
    ]);
    expect(r.plots[1].values.every((v) => v === 70)).toBe(true);
    expect(compileError("hline(close)").code).toBe("EXPECTED_CONSTANT");
  });

  it("wma with a fractional length is an error in the language and all-na in superlib", () => {
    expect(compileError("plot(wma(close, 4.5))").code).toBe("BAD_LENGTH");
    expect(superlib.wma(close, 4.5).every((v) => v === null)).toBe(true);
  });
});

// SC-158, language half: non-finite results are na, so nz()/na() see them.
describe("SuperScript: non-finite results are na", () => {
  const flat: Bar[] = [
    { timestamp: 0, open: 9, high: 10, low: 8, close: 9.5, volume: 1 },
    { timestamp: 1, open: 10, high: 10, low: 10, close: 10, volume: 0 },
    { timestamp: 2, open: 10, high: 12, low: 9, close: 11, volume: 2 },
  ];

  it("x/0, 0/0, log(0), sqrt(-1), pow(0,-1) and x % 0 are na", () => {
    expect(values("plot((close - open) / (high - low))", flat)).toEqual([0.25, null, 1 / 3]);
    expect(values("plot(close + 1 / (high - low))", flat)).toEqual([10, null, 11 + 1 / 3]);
    expect(values("plot(log(volume))", flat)).toEqual([0, null, Math.log(2)]);
    expect(values("plot(sqrt(close - 10))", flat)).toEqual([null, 0, 1]);
    expect(values("plot(pow(volume, -1))", flat)).toEqual([1, null, 0.5]);
    expect(values("plot(close % (high - low))", flat)).toEqual([1.5, null, 2]);
  });

  it("nz() replaces them and na() flags them", () => {
    expect(values("plot(nz(1 / (high - low), 5))", flat)).toEqual([0.5, 5, 1 / 3]);
    expect(values("plot(na(1 / (high - low)))", flat)).toEqual([0, 1, 0]);
    expect(values("plot(log(0))", flat)).toEqual([null, null, null]);
  });

  it("constant expressions too: 1/0, log(0) and an input set to 0 are na, not ±Infinity", () => {
    // A non-finite constant used to stay ±Infinity: min() and comparisons took it as a real number.
    expect(values("plot(min(1/0, close))", flat)).toEqual([null, null, null]);
    expect(values("plot(max(log(0), close))", flat)).toEqual([null, null, null]);
    expect(values("x = 1/0\nplot(x > 5 ? 1 : 0)", flat)).toEqual([null, null, null]);
    expect(values("plot(-(1/0) < close ? 1 : 0)", flat)).toEqual([null, null, null]);
    expect(values("plot(min(1e999, close))", flat)).toEqual([null, null, null]);
    expect(values("plot(na(1/0))", flat)).toEqual([1, 1, 1]);
    expect(values("plot(nz(1/0, 5) + close * 0)", flat)).toEqual([5, 5, 5]);
    const c = SuperScriptLanguage.compile("k = input(1, minval=0)\nplot(min(1/k, close))\nplot(1/k > close ? 1 : 0)");
    expect(c.run(flat, [0]).plots.map((p) => p.values)).toEqual([[null, null, null], [null, null, null]]);
    expect(c.run(flat, [1]).plots.map((p) => p.values)).toEqual([[1, 1, 1], [0, 0, 0]]);
  });
});

// SC-004 at the script level: parsing happens once in compile(), and run()
// computes only the price series a script reads.
describe("SuperScript: a compiled script runs fast", () => {
  // Machine-independent: run() at len 200 costs about what it does at len 2
  // (O(n)); a per-window kernel costs 20x more or worse. The absolute ceiling is
  // 3x the 3 ms target (about 1 ms measured on the dev machine).
  it("Donchian(200) over 20k bars: run() costs about what Donchian(2) does, and under 9 ms", () => {
    const bars = wavy(20_000);
    const time = (len: number): number => {
      const c = SuperScriptLanguage.compile(`plot(highest(high, ${len}))\nplot(lowest(low, ${len}))`);
      for (let i = 0; i < 3; i++) c.run(bars);
      let best = Infinity;
      for (let i = 0; i < 15; i++) {
        const t = performance.now();
        c.run(bars);
        best = Math.min(best, performance.now() - t);
      }
      return best;
    };
    const short = time(2);
    const long = time(200);
    expect(long, `len 200: ${long.toFixed(3)} ms, len 2: ${short.toFixed(3)} ms`).toBeLessThan(3 * short);
    expect(long).toBeLessThan(9);
  });
});
