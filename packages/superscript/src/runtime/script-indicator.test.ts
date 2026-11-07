import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEngineScriptIndicator } from "../scripts";
import type { EngineScriptHost } from "../scripts";
import { EngineIndicators } from "@supersolutions/super-chart-core";
import { listLanguages, registerLanguage, JavaScriptLanguage, getLanguage, SuperScriptError } from ".";

// Existing numerical and ownership cases migrated to the actual owned registry.
// Retired KC styling, title punctuation, private precision flags, implicit source
// replacement and shared global registry cases do not describe the new API.
let registry: EngineIndicators;
let host: EngineScriptHost;
beforeEach(() => {
  registry = new EngineIndicators();
  host = {
    registerIndicator: (definition) => registry.register(definition),
    unregisterIndicator: (name, calculate) => registry.unregister(name, calculate),
    addIndicator: (spec) => registry.add(spec),
    listIndicators: () => registry.list(),
    removeIndicator: (id) => registry.remove(id),
    updateIndicator: (id, changes) => registry.update(id, changes),
  };
});

const bars = Array.from({ length: 60 }, (_, i) => {
  const c = 64_000 + 400 * Math.sin(i / 6);
  return { timestamp: i * 3_600_000, open: c - 10, high: c + 50, low: c - 50, close: c, volume: 10 + (i % 4) };
});

describe("owned script indicator calculation", () => {
  it("draws histograms from 0 or the declared histbase", () => {
    const t = createEngineScriptIndicator({ name: "T_HIST", source: 'plot(close - sma(close, 5), type="histogram")\nplot(close, type="histogram", histbase=64000)' });
    expect(t.definition.figures.map((f) => f.base)).toEqual([0, 64000]);
    const rsi = createEngineScriptIndicator({ name: "T_HIST50", source: 'plot(rsi(close, 14), type="histogram", histbase=50)' });
    expect(rsi.definition.figures[0].base).toBe(50);
  });

  it("places overlay scripts on the price pane and oscillators on a separate pane", () => {
    const ov = createEngineScriptIndicator({ name: "T_OV", source: "// @overlay\nplot(sma(close, 10))" });
    expect(ov.definition.pane).toBe("price");
    const sub = createEngineScriptIndicator({ name: "T_SUB", source: "plot(rsi(close, 14))" });
    expect(sub.definition.pane).toBe("separate");
  });

  it("passes only finite numbers to the renderer, preserving unavailable values as gaps", () => {
    const t = createEngineScriptIndicator({
      name: "T_FIN",
      source: "plot(bar_index == 0 ? 1 : bar_index == 1 ? sqrt(-1) : bar_index == 2 ? 1 / 0 : bar_index == 3 ? -1 / 0 : bar_index == 4 ? na : 2)",
    });
    const rows = t.definition.calculate(bars.slice(0, 6), []);
    expect(rows).toEqual([{ p0: 1 }, { p0: null }, { p0: null }, { p0: null }, { p0: null }, { p0: 2 }]);
  });

  it("inputs become parameters, and calculation reads the instance parameters", () => {
    const t = createEngineScriptIndicator({ name: "T_IN", source: 'len = input(3, title="Length", minval=1)\nplot(sma(close, len))' }).definition;
    expect(t.params).toEqual([3]);
    const closes = bars.map((b) => b.close);
    const mean = (n: number): number => closes.slice(60 - n).reduce((a, b) => a + b, 0) / n;
    expect(t.calculate(bars, [3])[59].p0).toBeCloseTo(mean(3), 8);
    expect(t.calculate(bars, [10])[59].p0).toBeCloseTo(mean(10), 8);
    expect(createEngineScriptIndicator({ name: "T_NOIN", source: "plot(close)" }).definition.params).toEqual([]);
  });

  it("a failing calculation reports an error instead of returning stale values", () => {
    const t = createEngineScriptIndicator({ name: "T_ERR", source: "len = input(4)\nplot(sma(close, len - 3))" });
    expect(() => t.definition.calculate(bars, [3])).toThrow(SuperScriptError);
  });
});

describe("owned script attachment", () => {
  it("refuses a name it does not own, including the built-in RSI", () => {
    const id = registry.add({ name: "RSI" });
    expect(() => createEngineScriptIndicator({ name: "RSI", source: "plot(close)" }).attach(host)).toThrow(/already registered/);
    expect(registry.list().find((instance) => instance.id === id)?.name).toBe("RSI");
    createEngineScriptIndicator({ name: "HOST_IND", source: "plot(close)" }).attach(host);
    expect(() => createEngineScriptIndicator({ name: "HOST_IND", source: "plot(close)" }).attach(host)).toThrow(/already registered/);
  });

  it("an invalid script throws before anything is registered", () => {
    expect(() => createEngineScriptIndicator({ name: "T_BAD", source: "plot(clos)" }).attach(host)).toThrow(SuperScriptError);
    expect(() => registry.add({ name: "T_BAD" })).toThrow(/Unknown indicator/);
  });

  it("an invalid update throws and does not touch the chart", () => {
    const script = createEngineScriptIndicator({ name: "T_UPD_BAD", source: "len = input(4)\nplot(sma(close, len - 3))" });
    const attachment = script.attach(host);
    const update = vi.spyOn(host, "updateIndicator");
    expect(() => attachment.setParams({ len: 3 })).toThrow(SuperScriptError);
    expect(update).not.toHaveBeenCalled();
    expect(() => createEngineScriptIndicator({ name: "MACD", source: "plot(close)" }).attach(host)).toThrow(/already registered/);
  });

  it("the input schema and named parameter updates preserve current inputs and clamp values", () => {
    const script = createEngineScriptIndicator({ name: "T_PARAMS", source: 'fast = input(10, minval=2)\nslow = input(30, maxval=100)\nplot(sma(close, fast) - sma(close, slow))' });
    expect(script.inputs.map((input) => [input.id, input.defval])).toEqual([["fast", 10], ["slow", 30]]);
    const attachment = script.attach(host, { params: { fast: 12, slow: 40 } });
    expect(attachment.setParams({ slow: 500 })).toEqual([12, 100]);
    registry.update(attachment.id, { params: [12, 40] });
    expect(attachment.setParams({ fast: 1.4 })).toEqual([2, 40]);
    expect(registry.list().find((instance) => instance.id === attachment.id)?.params).toEqual([2, 40]);
  });
});

describe("script languages", () => {
  it("only SuperScript is registered by default and the owned bridge never enables JavaScript", () => {
    const ids = listLanguages().map((language) => language.id);
    expect(ids).toContain("superscript");
    expect(ids).not.toContain("javascript");
    expect(getLanguage("javascript")).toBeUndefined();
    expect(() => createEngineScriptIndicator({ name: "T_JS", source: "return { meta: { title: 'js' }, plots: [] }" }))
      .toThrow();
    registerLanguage(JavaScriptLanguage);
    expect(() => createEngineScriptIndicator({ name: "T_JS", source: "return { meta: { title: 'js' }, plots: [{ id: 'p0', title: 'c', values: ctx.bars.map(b => b.close) }] }" }))
      .toThrow();
  });
});
