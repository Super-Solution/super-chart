import { describe, it, expect } from "vitest";
import { runScript, superlib, type Bar } from ".";
import { ta } from "@supersolutions/super-chart-core";

/** Build bars from a close array (o=h=l=c) for simple series tests. */
function closes(cs: number[]): Bar[] {
  return cs.map((c, i) => ({ timestamp: i, open: c, high: c, low: c, close: c, volume: 1 }));
}

describe("SuperScript: parsing", () => {
  it("reads @title and registers multiple plots in order", () => {
    const r = runScript(`// @title My Ind\nplot(close, title="Close")\nplot(sma(close, 2), title="SMA2")`, closes([2, 4, 6]));
    expect(r.meta.title).toBe("My Ind");
    expect(r.plots.map((p) => p.title)).toEqual(["Close", "SMA2"]);
    expect(r.plots[1].values).toEqual([null, 3, 5]);
  });

  it("parses plot style options", () => {
    const r = runScript(`plot(close, title="X", color="#2962ff", type="histogram", lineWidth=2)`, closes([1, 2]));
    expect(r.plots[0].style).toEqual({ color: "#2962ff", type: "histogram", lineWidth: 2 });
  });

  it("supports history indexing close[1]", () => {
    const r = runScript(`plot(close - close[1])`, closes([1, 3, 2]));
    expect(r.plots[0].values).toEqual([null, 2, -1]);
  });

  it("broadcasts scalars across arithmetic", () => {
    const r = runScript(`plot(close * 2 + 1)`, closes([1, 2, 3]));
    expect(r.plots[0].values).toEqual([3, 5, 7]);
  });
});

describe("SuperScript: built-ins via the interpreter", () => {
  it("sma is a rolling mean with warmup nulls", () => {
    const r = runScript(`plot(sma(close, 3))`, closes([1, 2, 3, 4, 5]));
    expect(r.plots[0].values).toEqual([null, null, 2, 3, 4]);
  });

  it("ema starts from the SMA of its first len values (TradingView, klinecharts' EMA); na before", () => {
    const r = runScript(`plot(ema(close, 3))`, closes([1, 2, 3, 4]));
    // seed (1+2+3)/3 = 2 at bar 2; then (2*4 + 2*2)/4 = 3.
    expect(r.plots[0].values).toEqual([null, null, 2, 3]);
  });

  it("rsi saturates to 100 on a monotonic up series", () => {
    const r = runScript(`plot(rsi(close, 5))`, closes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(r.plots[0].values.at(-1)).toBe(100);
  });

  it("crossover fires the bar the fast series crosses above (2-series dispatch regression)", () => {
    // b is the constant 2; close crosses above it between bar 1 and bar 2.
    const r = runScript(`b = close - close + 2\nplot(crossover(close, b))`, closes([1, 2, 3, 4]));
    expect(r.plots[0].values).toEqual([null, 0, 1, 0]);
  });

  it("crossunder fires the bar the fast series crosses below", () => {
    const r = runScript(`b = close - close + 2\nplot(crossunder(close, b))`, closes([4, 3, 2, 1]));
    expect(r.plots[0].values).toEqual([null, 0, 0, 1]);
  });

  it("atr uses Wilder smoothing of true range", () => {
    const bars: Bar[] = [
      { timestamp: 0, open: 9, high: 10, low: 8, close: 9, volume: 1 },
      { timestamp: 1, open: 11, high: 12, low: 9, close: 11, volume: 1 },
      { timestamp: 2, open: 8, high: 11, low: 7, close: 8, volume: 1 },
    ];
    // tr = [2, 3, 4]; atr(2) seeds at i1 = (2+3)/2 = 2.5; i2 = (2.5*1 + 4)/2 = 3.25
    const r = runScript(`plot(atr(2))`, bars);
    expect(r.plots[0].values[0]).toBeNull();
    expect(r.plots[0].values[1]).toBeCloseTo(2.5, 10);
    expect(r.plots[0].values[2]).toBeCloseTo(3.25, 10);
  });

  it("macd is expressible from ema variables", () => {
    const r = runScript(`macd = ema(close, 2) - ema(close, 4)\nplot(macd)`, closes([1, 2, 3, 4, 5]));
    // ema(2): 1.5, 2.5, 3.5, 4.5 from bar 1; ema(4) starts at bar 3: 2.5, 3.5.
    expect(r.plots[0].values).toEqual([null, null, null, 1, 1]);
  });
});

describe("SuperScript: stdlib functions directly", () => {
  it("change is the first difference", () => {
    expect(superlib.change([1, 3, 2, 2])).toEqual([null, 2, -1, 0]);
  });

  it("stdev is the population standard deviation", () => {
    const s = superlib.stdev([2, 4, 6], 3);
    expect(s[2]).toBeCloseTo(Math.sqrt(8 / 3), 10);
  });

  it("wma weights recent values more", () => {
    // wma([1,2,3], 3) = (1*1 + 2*2 + 3*3) / (1+2+3) = 14/6
    const s = superlib.wma([1, 2, 3], 3);
    expect(s[2]).toBeCloseTo(14 / 6, 10);
  });

  it("roc is percent change over len", () => {
    // roc([10, ?, ?, 15], 3) at i3 = 100*(15-10)/10 = 50
    const s = superlib.roc([10, 11, 12, 15], 3);
    expect(s[3]).toBeCloseTo(50, 10);
  });
});

describe("SuperScript: errors", () => {
  it("throws on an unknown identifier", () => {
    expect(() => runScript(`plot(nope)`, closes([1, 2]))).toThrow();
  });

  it("throws on an unknown function", () => {
    expect(() => runScript(`plot(frobnicate(close, 3))`, closes([1, 2]))).toThrow();
  });
});

/** OHLCV bars for volume / range-aware tests. */
function ohlcv(rows: Array<[number, number, number, number, number]>): Bar[] {
  return rows.map(([o, h, l, c, v], i) => ({ timestamp: i, open: o, high: h, low: l, close: c, volume: v }));
}

describe("SuperScript: operators", () => {
  it("comparison operators yield 1/0 series", () => {
    expect(runScript(`plot(close > 2)`, closes([1, 2, 3])).plots[0].values).toEqual([0, 0, 1]);
    expect(runScript(`plot(close >= 2)`, closes([1, 2, 3])).plots[0].values).toEqual([0, 1, 1]);
    expect(runScript(`plot(close == 2)`, closes([1, 2, 3])).plots[0].values).toEqual([0, 1, 0]);
    expect(runScript(`plot(close != 2)`, closes([1, 2, 3])).plots[0].values).toEqual([1, 0, 1]);
  });

  it("logical and/or/not with correct precedence", () => {
    expect(runScript(`plot(close > 1 and close < 3)`, closes([1, 2, 3])).plots[0].values).toEqual([0, 1, 0]);
    expect(runScript(`plot(close < 2 or close > 2)`, closes([1, 2, 3])).plots[0].values).toEqual([1, 0, 1]);
    expect(runScript(`plot(not (close > 2))`, closes([1, 2, 3])).plots[0].values).toEqual([1, 1, 0]);
  });

  it("ternary selects element-wise", () => {
    expect(runScript(`plot(close > 2 ? 100 : 0)`, closes([1, 2, 3])).plots[0].values).toEqual([0, 0, 100]);
    expect(runScript(`plot(true ? close : 0)`, closes([5, 6])).plots[0].values).toEqual([5, 6]);
  });

  it("modulo and arithmetic precedence", () => {
    expect(runScript(`plot(close % 2)`, closes([1, 2, 3, 4])).plots[0].values).toEqual([1, 0, 1, 0]);
    expect(runScript(`plot(1 + 2 * 3)`, closes([0, 0])).plots[0].values).toEqual([7, 7]);
    expect(runScript(`plot(close + 1 > 3)`, closes([1, 2, 3])).plots[0].values).toEqual([0, 0, 1]);
  });
});

describe("SuperScript: input() + variable lengths", () => {
  it("input() yields its default and can drive a length", () => {
    const r = runScript(`len = input(3)\nplot(sma(close, len))`, closes([1, 2, 3, 4, 5]));
    expect(r.plots[0].values).toEqual([null, null, 2, 3, 4]);
  });
});

describe("SuperScript: new stdlib functions", () => {
  it("sum is a rolling sum; cum is cumulative", () => {
    expect(runScript(`plot(sum(close, 2))`, closes([1, 2, 3, 4])).plots[0].values).toEqual([null, 3, 5, 7]);
    expect(runScript(`plot(cum(close))`, closes([1, 2, 3])).plots[0].values).toEqual([1, 3, 6]);
  });

  it("mom is momentum over len", () => {
    expect(runScript(`plot(mom(close, 2))`, closes([1, 2, 4, 7])).plots[0].values).toEqual([null, null, 3, 5]);
  });

  it("dev is mean absolute deviation; linreg endpoint follows a straight line", () => {
    expect(superlib.dev([2, 4, 6], 3)[2]).toBeCloseTo(4 / 3, 10);
    expect(superlib.linreg([1, 2, 3], 3, 0)[2]).toBeCloseTo(3, 10);
  });

  it("barssince / valuewhen track a condition", () => {
    expect(runScript(`plot(barssince(close > 2))`, closes([1, 2, 3, 4, 1])).plots[0].values).toEqual([null, null, 0, 0, 1]);
    expect(runScript(`plot(valuewhen(close > 2, close, 0))`, closes([1, 3, 2, 4])).plots[0].values).toEqual([null, 3, 3, 4]);
  });

  it("cross fires in either direction", () => {
    expect(runScript(`b = close - close + 2\nplot(cross(close, b))`, closes([1, 3, 1])).plots[0].values).toEqual([null, 1, 1]);
  });

  it("pivothigh marks the confirmed pivot bar", () => {
    expect(runScript(`plot(pivothigh(high, 1, 1))`, closes([1, 3, 2, 5, 1])).plots[0].values).toEqual([null, null, 3, null, 5]);
  });

  it("obv accumulates signed volume", () => {
    const b = ohlcv([[1, 1, 1, 1, 10], [2, 2, 2, 2, 20], [1, 1, 1, 1, 30], [3, 3, 3, 3, 40]]);
    expect(runScript(`plot(obv())`, b).plots[0].values).toEqual([0, 20, -10, 30]);
  });

  it("vwap is the cumulative volume-weighted average of hlc3", () => {
    const b = ohlcv([[2, 2, 2, 2, 10], [4, 4, 4, 4, 10]]);
    expect(runScript(`plot(vwap())`, b).plots[0].values).toEqual([2, 3]);
  });

  it("stoch %K tops out at 100 when close sits at the range high", () => {
    expect(runScript(`plot(stoch(3))`, closes([1, 2, 3, 4, 5])).plots[0].values.at(-1)).toBe(100);
  });

  it("cci and sar produce finite values on a trending series", () => {
    const cs = closes([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Number.isFinite(runScript(`plot(cci(5))`, cs).plots[0].values.at(-1) as number)).toBe(true);
    expect(Number.isFinite(runScript(`plot(sar())`, cs).plots[0].values.at(-1) as number)).toBe(true);
  });
});

describe("SuperScript: math built-ins", () => {
  it("sign / floor / sqrt / pow", () => {
    expect(runScript(`plot(sign(close - 2))`, closes([1, 2, 3])).plots[0].values).toEqual([-1, 0, 1]);
    expect(runScript(`plot(floor(close / 2))`, closes([1, 2, 3])).plots[0].values).toEqual([0, 1, 1]);
    expect(runScript(`plot(sqrt(close))`, closes([4, 9])).plots[0].values).toEqual([2, 3]);
    expect(runScript(`plot(pow(close, 2))`, closes([1, 2, 3])).plots[0].values).toEqual([1, 4, 9]);
  });

  it("nz replaces null; na flags it", () => {
    expect(runScript(`plot(nz(close[1], 0))`, closes([1, 2, 3])).plots[0].values).toEqual([0, 1, 2]);
    expect(runScript(`plot(na(close[1]))`, closes([1, 2, 3])).plots[0].values).toEqual([1, 0, 0]);
  });
});

// SC-173: SuperScript and Super Chart's own indicators share one TA core
// (src/ta), so a script and the core give the same numbers bit for bit.
describe("SuperScript: parity with the TA core", () => {
  const cs = Array.from({ length: 400 }, (_, i) => 100 + 25 * Math.sin(i / 40) + 10 * Math.sin(i / 11) + 4 * Math.sin(i / 3.3));
  const bars = cs.map((c, i) => ({ timestamp: i, open: c - 0.5, high: c + 1 + (i % 3), low: c - 1 - (i % 2), close: c, volume: 100 + (i % 7) }));
  const close = bars.map((b) => b.close);
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const run = (src: string): Array<number | null> => runScript(src, bars).plots[0].values;

  it("sma, ema, rma, rsi, stdev, atr, highest, lowest are the core's values exactly", () => {
    expect(run("plot(sma(close, 20))")).toEqual(ta.sma(close, 20));
    expect(run("plot(ema(close, 20))")).toEqual(ta.ema(close, 20));
    expect(run("plot(ema(close, 200))")).toEqual(ta.ema(close, 200));
    expect(run("plot(rma(close, 14))")).toEqual(ta.rma(close, 14));
    expect(run("plot(rsi(close, 14))")).toEqual(ta.rsi(close, 14));
    expect(run("plot(stdev(close, 20))")).toEqual(ta.stdev(close, 20));
    expect(run("plot(atr(14))")).toEqual(ta.atr(high, low, close, 14));
    expect(run("plot(highest(high, 50))")).toEqual(ta.highest(high, 50));
    expect(run("plot(lowest(low, 50))")).toEqual(ta.lowest(low, 50));
  });

  it("MACD written in SuperScript equals the core's macd (hist = dif - dea)", () => {
    const m = ta.macd(close, 12, 26, 9);
    const src = "dif = ema(close, 12) - ema(close, 26)\ndea = ema(dif, 9)\nplot(dif)\nplot(dea)\nplot(dif - dea)";
    const r = runScript(src, bars).plots.map((p) => p.values);
    expect(r[0]).toEqual(m.dif);
    expect(r[1]).toEqual(m.dea);
    expect(r[2]).toEqual(m.hist);
    // Warm-up as TradingView: dif from bar 25, dea from bar 33.
    expect(r[1].findIndex((v) => v != null)).toBe(33);
  });

  it("superlib is the core", () => {
    expect(superlib.sma).toBe(ta.sma);
    expect(superlib.ema).toBe(ta.ema);
    expect(superlib.rsi).toBe(ta.rsi);
    expect(superlib.stdev).toBe(ta.stdev);
  });
});
