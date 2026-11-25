import { describe, expect, it } from "vitest";
import { checkSuperScript, runScript, superscriptReference, type Bar } from ".";
import { ta } from "@supersolutions/super-chart-core";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/** Six bars a day, so a few days make a few pivot periods. */
function days(count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => {
    const c = 100 + 12 * Math.sin(i / 5) + (i % 7);
    return { timestamp: T0 + (i * DAY) / 6, open: c, high: c + 1 + (i % 3), low: c - 1 - (i % 2), close: c, volume: 100 + (i % 11) * 30 };
  });
}
const plot = (src: string, bars: Bar[]): Array<number | null> => runScript(src, bars).plots[0].values;
const series = (bars: Bar[], key: "high" | "low" | "close" | "volume"): number[] => bars.map((b) => b[key] as number);

describe("SuperScript: the 0.13 indicators agree with the core kernels", () => {
  const bars = days(120);
  const [high, low, close, volume] = (["high", "low", "close", "volume"] as const).map((k) => series(bars, k));
  it("aroonup, aroondown, vortexplus, vortexminus", () => {
    expect(plot("plot(aroonup(10))", bars)).toEqual(ta.aroon(high, low, 10).up);
    expect(plot("plot(aroondown(10))", bars)).toEqual(ta.aroon(high, low, 10).down);
    expect(plot("plot(vortexplus(7))", bars)).toEqual(ta.vortex(high, low, close, 7).plus);
    expect(plot("plot(vortexminus(7))", bars)).toEqual(ta.vortex(high, low, close, 7).minus);
  });
  it("cmf, adl, forceindex, ultimate, chandelier", () => {
    expect(plot("plot(cmf(10))", bars)).toEqual(ta.cmf(high, low, close, volume, 10));
    expect(plot("plot(adl())", bars)).toEqual(ta.adl(high, low, close, volume));
    expect(plot("plot(forceindex(5))", bars)).toEqual(ta.forceIndex(close, volume, 5));
    expect(plot("plot(ultimate(3, 5, 9))", bars)).toEqual(ta.ultimate(high, low, close, 3, 5, 9));
    expect(plot("plot(chandelierlong(10, 2))", bars)).toEqual(ta.chandelier(high, low, close, 10, 2).long);
    expect(plot("plot(chandeliershort(10, 2))", bars)).toEqual(ta.chandelier(high, low, close, 10, 2).short);
  });
  it("tsi takes Pine's argument order, short then long", () => {
    expect(plot("plot(tsi(close, 4, 9))", bars)).toEqual(ta.tsi(close, 9, 4).tsi);
    expect(plot("plot(tsisignal(close, 4, 9, 3))", bars)).toEqual(ta.tsi(close, 9, 4, 3).signal);
  });
  it("zigzag and zigzagpivot", () => {
    const expected = ta.zigzag(high, low, 4);
    expect(plot("plot(zigzag(4))", bars)).toEqual(expected.line);
    expect(plot("plot(zigzagpivot(4))", bars)).toEqual(expected.pivot);
  });
  it("pivot levels use the previous UTC day and the bar timestamps", () => {
    const periods = bars.map((b) => ta.periodBucket(b.timestamp, 0));
    const expected = ta.pivotPoints(high, low, close, periods, 0);
    expect(plot("plot(pivotpoint())", bars)).toEqual(expected.pp);
    expect(plot("plot(pivotresistance(2))", bars)).toEqual(expected.r2);
    expect(plot("plot(pivotsupport(3, 0, 0))", bars)).toEqual(expected.s3);
    // Weekly Fibonacci levels need weeks of data: 300 bars at six a day is fifty days.
    const long = days(300);
    const weekly = ta.pivotPoints(series(long, "high"), series(long, "low"), series(long, "close"), long.map((b) => ta.periodBucket(b.timestamp, 1)), 1);
    expect(plot("plot(pivotresistance(1, 1, 1))", long)).toEqual(weekly.r1);
    expect(weekly.r1.some((v) => v !== null)).toBe(true);
  });
});

describe("SuperScript: the 0.13 indicators reject what they cannot honour", () => {
  const codes = (src: string): string[] => checkSuperScript(src).filter((d) => d.severity === "error").map((d) => d.code);
  it("a pivot level beyond R3/S3, an unknown anchor or an unknown kind is a BAD_LENGTH error", () => {
    expect(codes("plot(pivotresistance(4))")).toEqual(["BAD_LENGTH"]);
    expect(codes("plot(pivotsupport(0))")).toEqual(["BAD_LENGTH"]);
    expect(codes("plot(pivotpoint(5))")).toEqual(["BAD_LENGTH"]);
    expect(codes("plot(pivotpoint(0, 2))")).toEqual(["BAD_LENGTH"]);
    expect(codes("plot(pivotpoint(4, 1))")).toEqual([]);
  });
  it("a length must still be a whole number", () => {
    expect(codes("plot(aroonup(2.5))")).toEqual(["BAD_LENGTH"]);
  });
  it("the reference documents every one of them, with the repaint warning on zigzag", () => {
    const ref = superscriptReference();
    for (const name of ["aroonup", "aroondown", "tsi", "tsisignal", "ultimate", "vortexplus", "vortexminus", "cmf", "adl", "forceindex", "chandelierlong", "chandeliershort", "zigzag", "zigzagpivot", "pivotpoint", "pivotresistance", "pivotsupport"]) {
      expect(ref, name).toContain(`${name}(`);
    }
    expect(ref).toContain("repaints");
  });
});
