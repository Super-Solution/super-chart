import { beforeEach, describe, expect, it, vi } from "vitest";

// klinecharts' Node entry has no registry, so the bridge's logic runs here over
// a stand-in with klinecharts' semantics (a plain name -> template map holding
// its built-ins). The e2e specs run the real thing on 9.7.2 and 9.8.12.
import {
  buildScriptIndicatorTemplate, createScriptIndicatorBridge, sharedBridgeState, ScriptIndicatorError, SCRIPT_PLOT_PALETTE,
} from "./script-indicator";
import { listLanguages, registerLanguage, JavaScriptLanguage, getLanguage, SuperScriptError } from "./index";

const registry = new Map<string, unknown>(["MA", "EMA", "SMA", "BOLL", "VOL", "MACD", "RSI"].map((n) => [n, {}]));
const bridge = createScriptIndicatorBridge({
  registerIndicator: (t) => { registry.set(t.name, t); },
  getSupportedIndicators: () => [...registry.keys()],
});
const registerScriptIndicator = bridge.register;
const updateScriptIndicator = bridge.update;
const getScriptInputSchema = bridge.schema;
const setScriptIndicatorParams = bridge.setParams;

type AnyTemplate = ReturnType<typeof buildScriptIndicatorTemplate>;
const bars = Array.from({ length: 60 }, (_, i) => {
  const c = 64_000 + 400 * Math.sin(i / 6);
  return { timestamp: i * 3_600_000, open: c - 10, high: c + 50, low: c - 50, close: c, volume: 10 + (i % 4) };
});
/** A chart with no instances of the indicator yet (the precision sync finds nothing to set). */
const bareChart = { getPriceVolumePrecision: () => ({ price: 2, volume: 0 }), getIndicatorByPaneId: () => null };
const LINE_KEYS = ["color", "dashedValue", "size", "smooth", "style"];
const lines = (t: AnyTemplate): Array<Record<string, unknown>> => ((t.styles as { lines?: Array<Record<string, unknown>> }).lines ?? []);
const defaults = { bars: [{ upColor: "#UP", downColor: "#DOWN", noChangeColor: "#FLAT" }] };
const styleOf = (t: AnyTemplate, key: string, value: number | undefined): unknown =>
  t.figures.find((f) => f.key === key)?.styles?.({ prev: {}, current: { indicatorData: value === undefined ? undefined : { [key]: value } }, next: {} } as never, {} as never, defaults as never);

describe("script indicator template", () => {
  it("gives every line figure a complete style (klinecharts 9.8 reads dashedValue[0]), one per line figure", () => {
    const t = buildScriptIndicatorTemplate({ name: "T_LINES", source: 'plot(close, color="#ff00ff", lineWidth=2)\nplot(sma(close, 5))' });
    expect(t.figures.map((f) => f.type)).toEqual(["line", "line"]);
    expect(lines(t)).toHaveLength(2);
    for (const l of lines(t)) {
      expect(Object.keys(l).sort()).toEqual(LINE_KEYS);
      expect(Array.isArray(l.dashedValue)).toBe(true);
    }
    expect(lines(t)[0]).toEqual({ style: "solid", smooth: false, size: 2, dashedValue: [2, 2], color: "#ff00ff" });
    // No colour: a palette colour, not the canvas default (black).
    expect(lines(t)[1].color).toBe(SCRIPT_PLOT_PALETTE[1]);
    expect(lines(t)[1].size).toBe(1);
  });

  it("indexes line styles among line figures only: a histogram first does not shift the line colours", () => {
    const t = buildScriptIndicatorTemplate({
      name: "T_MACD",
      source: [
        "dif = ema(close, 12) - ema(close, 26)",
        "dea = ema(dif, 9)",
        'plot(dif - dea, title="Hist", color="#ff00ff", type="histogram")',
        'plot(dif, title="MACD", color="#00e5ff")',
        'plot(dea, title="Signal", color="#ffff00")',
      ].join("\n"),
    });
    expect(t.figures.map((f) => f.type)).toEqual(["bar", "line", "line"]);
    expect(lines(t).map((l) => l.color)).toEqual(["#00e5ff", "#ffff00"]);
    // The histogram's own colour comes from its figure, whatever the sign.
    expect(styleOf(t, "p0", -3)).toEqual({ color: "#ff00ff" });
    expect(styleOf(t, "p0", 3)).toEqual({ color: "#ff00ff" });
  });

  it("draws histograms from 0 (or histbase), coloured by sign when the script gives no colour", () => {
    const t = buildScriptIndicatorTemplate({ name: "T_HIST", source: 'plot(close - sma(close, 5), type="histogram")\nplot(close, type="histogram", histbase=64000)' });
    expect(t.figures.map((f) => f.baseValue)).toEqual([0, 64000]);
    expect(styleOf(t, "p0", 2)).toEqual({ color: "#UP" });
    expect(styleOf(t, "p0", -2)).toEqual({ color: "#DOWN" });
    expect(styleOf(t, "p0", undefined)).toEqual({ color: "#FLAT" });
    expect(t.styles).toEqual({});
    // The sign is taken against the bar's base, not 0: above histbase is up, below is down.
    expect(styleOf(t, "p1", 64_500)).toEqual({ color: "#UP" });
    expect(styleOf(t, "p1", 63_500)).toEqual({ color: "#DOWN" });
    const rsi = buildScriptIndicatorTemplate({ name: "T_HIST50", source: 'plot(rsi(close, 14), type="histogram", histbase=50)' });
    expect(rsi.figures[0].baseValue).toBe(50);
    expect([styleOf(rsi, "p0", 30), styleOf(rsi, "p0", 70), styleOf(rsi, "p0", 50)]).toEqual([{ color: "#DOWN" }, { color: "#UP" }, { color: "#UP" }]);
  });

  it("hline is a dashed line; circles get their colour from the figure", () => {
    const t = buildScriptIndicatorTemplate({ name: "T_HL", source: 'plot(rsi(close, 14), type="circle")\nhline(70, color="#ff0000")' });
    expect(t.figures.map((f) => f.type)).toEqual(["circle", "line"]);
    expect(lines(t)).toEqual([{ style: "dashed", smooth: false, size: 1, dashedValue: [4, 4], color: "#ff0000" }]);
    expect(styleOf(t, "p0", 50)).toEqual({ color: SCRIPT_PLOT_PALETTE[0] });
  });

  it("legend titles end with ': ' (never doubled, empty left alone)", () => {
    const t = buildScriptIndicatorTemplate({ name: "T_TITLES", source: 'plot(close, title="Fast 10")\nplot(close, title="Ratio:")\nplot(close)\nhline(1)' });
    expect(t.figures.map((f) => f.title)).toEqual(["Fast 10: ", "Ratio:", "plot 3: ", ""]);
  });

  it("uses the price precision for // @overlay scripts, 2 decimals otherwise", () => {
    const ov = buildScriptIndicatorTemplate({ name: "T_OV", source: "// @overlay\nplot(sma(close, 10))" });
    expect([ov.series, ov.precision]).toEqual(["price", undefined]);
    const sub = buildScriptIndicatorTemplate({ name: "T_SUB", source: "plot(rsi(close, 14))" });
    expect([sub.series, sub.precision]).toEqual(["normal", 2]);
    expect(buildScriptIndicatorTemplate({ name: "T_OPT", source: "plot(close)", series: "price" }).series).toBe("price");
    expect(buildScriptIndicatorTemplate({ name: "T_OPT2", source: "// @overlay\nplot(close)", overlay: false, precision: 3 }).precision).toBe(3);
    // `precision` is for 'normal' scripts: price/volume ones follow the chart (klinecharts would replace it anyway).
    const pinned = buildScriptIndicatorTemplate({ name: "T_OPT3", source: "// @overlay\nplot(close)", precision: 5 });
    expect([pinned.series, pinned.precision]).toEqual(["price", undefined]);
  });

  it("passes only finite numbers to klinecharts (NaN/±Infinity blanked the axis)", () => {
    registerLanguage({
      id: "x-nonfinite",
      name: "X",
      compile: () => ({
        meta: { title: "x" },
        run: (b) => ({ meta: { title: "x" }, plots: [{ id: "p0", title: "v", values: b.map((_x, i) => [1, NaN, Infinity, -Infinity, null, 2][i % 6]) }] }),
      }),
    });
    const t = buildScriptIndicatorTemplate({ name: "T_FIN", source: "", language: "x-nonfinite" });
    const rows = t.calc(bars.slice(0, 6) as never, { calcParams: [] } as never) as Array<Record<string, number>>;
    expect(rows).toEqual([{ p0: 1 }, {}, {}, {}, {}, { p0: 2 }]);
  });

  it("inputs become calcParams, and calc reads the indicator's calcParams", () => {
    const t = buildScriptIndicatorTemplate({ name: "T_IN", source: 'len = input(3, title="Length", minval=1)\nplot(sma(close, len))' });
    expect(t.calcParams).toEqual([3]);
    const at = (rows: unknown, i: number): number => (rows as Array<Record<string, number>>)[i].p0;
    const closes = bars.map((b) => b.close);
    const mean = (n: number): number => closes.slice(60 - n).reduce((a, b) => a + b, 0) / n;
    expect(at(t.calc(bars as never, { calcParams: [3] } as never), 59)).toBeCloseTo(mean(3), 8);
    expect(at(t.calc(bars as never, { calcParams: [10] } as never), 59)).toBeCloseTo(mean(10), 8);
    expect(buildScriptIndicatorTemplate({ name: "T_NOIN", source: "plot(close)" }).calcParams).toEqual([]);
  });

  it("a failing calculation reports through onError and shows nothing (not stale values)", () => {
    const errors: unknown[] = [];
    const t = buildScriptIndicatorTemplate({
      name: "T_ERR",
      source: "len = input(4)\nplot(sma(close, len - 3))",
      onError: (e, d) => errors.push([e instanceof SuperScriptError, d.map((x) => x.code)]),
    });
    expect(t.calc(bars as never, { calcParams: [3] } as never)).toEqual(bars.map(() => ({})));
    expect(errors).toEqual([[true, ["BAD_LENGTH"]]]);
  });
});

describe("registerScriptIndicator / updateScriptIndicator", () => {
  beforeEach(() => {
    registry.delete("SUPER_SMACROSS");
  });

  it("refuses a name it does not own (NAME_TAKEN), including klinecharts' RSI", () => {
    let err: unknown;
    try { registerScriptIndicator({ name: "RSI", source: "plot(close)" }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ScriptIndicatorError);
    expect((err as ScriptIndicatorError).code).toBe("NAME_TAKEN");
    expect(registry.get("RSI")).toEqual({});
    registry.set("HOST_IND", {});
    expect(() => registerScriptIndicator({ name: "HOST_IND", source: "plot(close)" })).toThrow(/already exists/);
  });

  it("replaces its own registration (a second SUPER_SMACROSS wins)", () => {
    registerScriptIndicator({ name: "SUPER_SMACROSS", source: "// @title One\nplot(close)" });
    registerScriptIndicator({ name: "SUPER_SMACROSS", source: "// @title Two\nplot(close)\nplot(open)" });
    const t = registry.get("SUPER_SMACROSS") as AnyTemplate;
    expect(t.shortName).toBe("Two");
    expect(t.figures).toHaveLength(2);
  });

  it("an invalid script throws before anything is registered", () => {
    expect(() => registerScriptIndicator({ name: "T_BAD", source: "plot(clos)" })).toThrow(SuperScriptError);
    expect(registry.has("T_BAD")).toBe(false);
  });

  it("updateScriptIndicator overrides the chart's instances in place with the whole new template", () => {
    registerScriptIndicator({ name: "T10", source: "plot(close*0+42)" });
    const calls: Array<[Record<string, unknown>, string | undefined]> = [];
    const chart = { ...bareChart, overrideIndicator: (o: Record<string, unknown>, paneId?: string) => { calls.push([o, paneId]); } };
    updateScriptIndicator(chart as never, { name: "T10", source: "// @title V78\nplot(close*0+7)\nplot(close*0+8)" }, "pane_1");
    const [o, pane] = calls[0];
    expect(pane).toBe("pane_1");
    expect(o.name).toBe("T10");
    expect(o.shortName).toBe("V78");
    expect((o.figures as unknown[]).length).toBe(2);
    expect(((o.styles as { lines: unknown[] }).lines).length).toBe(2);
    const rows = (o.calc as (d: unknown, i: unknown) => Array<Record<string, number>>)(bars, { calcParams: [] });
    expect(rows[59]).toEqual({ p0: 7, p1: 8 });
    // The registry has it too, for indicators created afterwards.
    expect((registry.get("T10") as AnyTemplate).shortName).toBe("V78");
  });

  it("updateScriptIndicator keeps input values when the inputs are the same, else resets them", () => {
    registerScriptIndicator({ name: "T_UPD_IN", source: "len = input(5)\nplot(sma(close, len))" });
    const calls: Array<Record<string, unknown>> = [];
    const chart = { ...bareChart, overrideIndicator: (o: Record<string, unknown>) => { calls.push(o); } };
    updateScriptIndicator(chart as never, { name: "T_UPD_IN", source: "len = input(5)\nplot(ema(close, len))" });
    expect("calcParams" in calls[0]).toBe(false);
    updateScriptIndicator(chart as never, { name: "T_UPD_IN", source: "n = input(7)\nplot(ema(close, n))" });
    expect(calls[1].calcParams).toEqual([7]);
  });

  it("updateScriptIndicator gives its instances the precision of the new series, without pinning it", () => {
    registerScriptIndicator({ name: "T_PREC", source: "plot(close)" });
    // An instance with klinecharts' setPrecision(precision, flag): flag true is its own series sync,
    // which does not mark the precision as chosen, so later setPriceVolumePrecision calls still apply.
    const instance = { precision: 2, calls: [] as Array<[number, boolean | undefined]>, setPrecision (p: number, flag?: boolean) { this.calls.push([p, flag]); this.precision = p; return true; } };
    const overrides: Array<Record<string, unknown>> = [];
    const chart = {
      overrideIndicator: (o: Record<string, unknown>) => { overrides.push(o); },
      getPriceVolumePrecision: () => ({ price: 3, volume: 1 }),
      getIndicatorByPaneId: (paneId?: string, name?: string) => (paneId === undefined
        ? new Map([["pane_1", new Map([["T_PREC", instance]])]])
        : paneId === "pane_1" && name === "T_PREC" ? instance : null),
    };
    updateScriptIndicator(chart as never, { name: "T_PREC", source: "// @overlay\nplot(close)" });
    updateScriptIndicator(chart as never, { name: "T_PREC", source: "plot(close)" }, "pane_1");
    updateScriptIndicator(chart as never, { name: "T_PREC", source: "plot(volume)", series: "volume" });
    expect(instance.calls).toEqual([[3, true], [2, true], [1, true]]);
    // Not through overrideIndicator, which would pin it (klinecharts' precision flag).
    expect(overrides.map((o) => ["precision" in o, o.series])).toEqual([[false, "price"], [false, "normal"], [false, "volume"]]);
  });

  it("an invalid update throws and does not touch the chart", () => {
    registerScriptIndicator({ name: "T_UPD_BAD", source: "plot(close)" });
    const chart = { ...bareChart, overrideIndicator: vi.fn() };
    expect(() => updateScriptIndicator(chart as never, { name: "T_UPD_BAD", source: "plot(" })).toThrow();
    expect(chart.overrideIndicator).not.toHaveBeenCalled();
    expect(() => updateScriptIndicator(chart as never, { name: "MACD", source: "plot(close)" })).toThrow(ScriptIndicatorError);
  });

  it("getScriptInputSchema and setScriptIndicatorParams map named values to calcParams, clamped", () => {
    registerScriptIndicator({ name: "T_PARAMS", source: 'fast = input(10, minval=2)\nslow = input(30, maxval=100)\nplot(sma(close, fast) - sma(close, slow))' });
    expect(getScriptInputSchema("T_PARAMS")?.map((i) => [i.id, i.defval])).toEqual([["fast", 10], ["slow", 30]]);
    expect(getScriptInputSchema("MACD")).toBeUndefined();
    const calls: Array<[Record<string, unknown>, string | undefined]> = [];
    const chart = {
      overrideIndicator: (o: Record<string, unknown>, p?: string) => { calls.push([o, p]); },
      getIndicatorByPaneId: (paneId?: string, name?: string) => (paneId === undefined
        ? new Map([["candle_pane", new Map([["T_PARAMS", { calcParams: [12, 40] }]])]])
        : name === "T_PARAMS" ? { calcParams: [12, 40] } : null),
    };
    expect(setScriptIndicatorParams(chart as never, "T_PARAMS", { slow: 500 })).toEqual([12, 100]);
    expect(setScriptIndicatorParams(chart as never, "T_PARAMS", { fast: 1.4 }, "candle_pane")).toEqual([2, 40]);
    expect(calls.map(([o, p]) => [o.calcParams, p])).toEqual([[[12, 100], undefined], [[2, 40], "candle_pane"]]);
    expect(setScriptIndicatorParams(chart as never, "MACD", { x: 1 })).toBeNull();
  });
});

describe("one bridge state per klinecharts registry", () => {
  it("is shared by every copy of the module on the same registry (the ESM and CommonJS builds), not across registries", () => {
    const reg = new Map<string, unknown>([["RSI", {}]]);
    const kc = { registerIndicator: (t: { name: string }) => { reg.set(t.name, t); }, getSupportedIndicators: () => [...reg.keys()] };
    const esm = createScriptIndicatorBridge(kc, sharedBridgeState(kc.registerIndicator));
    const cjs = createScriptIndicatorBridge({ ...kc }, sharedBridgeState(kc.registerIndicator));
    esm.register({ name: "T_SHARED", source: "len = input(9)\nplot(sma(close, len))" });
    // The other copy owns it too: it may update it, and it knows its inputs.
    expect(cjs.update(null, { name: "T_SHARED", source: "// @title Second\nlen = input(9)\nplot(ema(close, len))" })).toBe("T_SHARED");
    expect((reg.get("T_SHARED") as AnyTemplate).shortName).toBe("Second");
    expect(cjs.schema("T_SHARED")?.map((i) => [i.id, i.defval])).toEqual([["len", 9]]);
    // Another klinecharts (another registerIndicator) has its own state: the name is taken there.
    const reg2 = new Map<string, unknown>([["T_SHARED", {}]]);
    const other = { registerIndicator: (t: { name: string }) => { reg2.set(t.name, t); }, getSupportedIndicators: () => [...reg2.keys()] };
    const third = createScriptIndicatorBridge(other, sharedBridgeState(other.registerIndicator));
    let code: unknown;
    try { third.register({ name: "T_SHARED", source: "plot(close)" }); } catch (e) { code = (e as ScriptIndicatorError).code; }
    expect(code).toBe("NAME_TAKEN");
    expect(reg2.get("T_SHARED")).toEqual({});
    // No registry (plain Node with klinecharts' CommonJS entry): a state of its own, so the import still works.
    const none = sharedBridgeState(undefined);
    expect([none.owned.size, none.schemas.size, none === sharedBridgeState(undefined)]).toEqual([0, 0, false]);
  });
});

describe("script languages", () => {
  it("only SuperScript is registered by default; JavaScript is opt-in", () => {
    const ids = listLanguages().map((l) => l.id);
    expect(ids).toContain("superscript");
    expect(ids).not.toContain("javascript");
    expect(getLanguage("javascript")).toBeUndefined();
    expect(() => registerScriptIndicator({ name: "T_JS", source: "return { meta: { title: 'js' }, plots: [] }", language: "javascript" }))
      .toThrow(/unknown language: javascript \(register it first/);
    registerLanguage(JavaScriptLanguage);
    expect(registerScriptIndicator({ name: "T_JS", source: "return { meta: { title: 'js' }, plots: [{ id: 'p0', title: 'c', values: ctx.bars.map(b => b.close) }] }", language: "javascript" })).toBe("T_JS");
  });
});
