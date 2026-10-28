import { afterEach, describe, expect, it } from "vitest";

import {
  analyzeChart, buildChartContext, createHttpAIClient, nlToSuperScript, nlToSuperScriptChecked,
  ANALYST_SYSTEM_PROMPT, SUPERSCRIPT_SYSTEM_PROMPT, type AIClient, type AICompleteInput, type ChartContext,
} from "./index";
import type { Bar } from "../superscript";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

interface Seen { url: string, init: RequestInit }
/** fetch that answers every request with `body` (JSON unless a string is meant raw) and records it. */
function mockFetch(body: unknown, status = 200, seen: Seen[] = []): Seen[] {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(typeof body === "string" && status !== 200 ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return seen;
}
/** fetch that never answers until its signal aborts. */
function hangingFetch(): void {
  globalThis.fetch = (async (_url: string, init: RequestInit) => await new Promise((_resolve, reject) => {
    // As fetch does: an already-aborted signal rejects at once.
    if (init.signal?.aborted === true) reject(init.signal.reason);
    init.signal?.addEventListener("abort", () => { reject(init.signal?.reason); });
  })) as typeof fetch;
}
async function rejection(p: Promise<unknown>): Promise<Error> {
  try { await p; } catch (e) { return e as Error; }
  throw new Error("did not reject");
}

// SC-140: the HTTP client reads the common body shapes and fails loudly otherwise.
describe("createHttpAIClient", () => {
  const client = (extra = {}): AIClient => createHttpAIClient({ endpoint: "https://host/ai", ...extra });

  it("reads a string, { text }, { content: string } and Anthropic content blocks", async () => {
    mockFetch("plot(close)");
    expect(await client().complete({ prompt: "p" })).toBe("plot(close)");
    mockFetch({ text: "plot(open)" });
    expect(await client().complete({ prompt: "p" })).toBe("plot(open)");
    mockFetch({ content: "s" });
    expect(await client().complete({ prompt: "p" })).toBe("s");
    mockFetch({ content: [{ type: "text", text: "a" }, { type: "tool_use", id: "x" }, { type: "text", text: "b" }] });
    expect(await client().complete({ prompt: "p" })).toBe("ab");
  });

  it("rejects an error body, an unknown shape, empty text and HTTP errors with what came back", async () => {
    mockFetch({ error: "rate limited" });
    expect((await rejection(client().complete({ prompt: "p" }))).message).toMatch(/rate limited/);
    mockFetch({ choices: [] });
    expect((await rejection(client().complete({ prompt: "p" }))).message).toMatch(/keys: choices.*extract/);
    mockFetch({ text: null });
    expect((await rejection(client().complete({ prompt: "p" }))).message).toMatch(/keys: text/);
    mockFetch({ text: "   " });
    expect((await rejection(client().complete({ prompt: "p" }))).message).toMatch(/no text/);
    mockFetch("upstream exploded", 502);
    expect((await rejection(client().complete({ prompt: "p" }))).message).toBe("AI endpoint responded 502: upstream exploded");
  });

  it("extract maps any other shape", async () => {
    mockFetch({ choices: [{ message: { content: "plot(high)" } }] });
    const c = client({ extract: (d: unknown) => (d as { choices: Array<{ message: { content: string } }> }).choices[0].message.content });
    expect(await c.complete({ prompt: "p" })).toBe("plot(high)");
  });

  it("sends exactly { system, prompt } (never the signal) with the host's headers", async () => {
    const seen = mockFetch({ text: "x" });
    await client({ headers: { authorization: "Bearer t" } }).complete({ system: "s", prompt: "p", signal: new AbortController().signal });
    expect(seen[0].url).toBe("https://host/ai");
    expect(seen[0].init.body).toBe(JSON.stringify({ system: "s", prompt: "p" }));
    expect(seen[0].init.headers).toEqual({ "content-type": "application/json", authorization: "Bearer t" });
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("can be cancelled: an abort rejects with AbortError, a timeout with TimeoutError", async () => {
    hangingFetch();
    const ac = new AbortController();
    const pending = client().complete({ prompt: "p", signal: ac.signal });
    ac.abort();
    expect((await rejection(pending)).name).toBe("AbortError");
    const t0 = Date.now();
    const timedOut = await rejection(client({ timeoutMs: 50 }).complete({ prompt: "p" }));
    expect(timedOut.name).toBe("TimeoutError");
    expect(Date.now() - t0).toBeLessThan(2000);
    const already = new AbortController();
    already.abort();
    expect((await rejection(client().complete({ prompt: "p", signal: already.signal }))).name).toBe("AbortError");
  });
});

/** An AIClient that returns scripted replies and records the calls. */
function scripted(replies: string[]): AIClient & { calls: AICompleteInput[] } {
  const calls: AICompleteInput[] = [];
  return {
    calls,
    complete: async (input) => {
      calls.push(input);
      return replies[Math.min(calls.length - 1, replies.length - 1)];
    },
  };
}

describe("nlToSuperScript", () => {
  it("returns a script that compiles, fences stripped", async () => {
    const c = scripted(["```superscript\n// @title X\nplot(sma(close, 10))\n```"]);
    expect(await nlToSuperScript(c, "10 SMA")).toBe("// @title X\nplot(sma(close, 10))");
    expect(c.calls[0].system).toBe(SUPERSCRIPT_SYSTEM_PROMPT);
    expect("signal" in c.calls[0]).toBe(false);
  });

  it("rejects prose, \"[object Object]\" and an empty reply instead of returning them", async () => {
    expect((await rejection(nlToSuperScript(scripted(["hello"]), "x"))).message).toMatch(/unknown identifier 'hello'/);
    expect((await rejection(nlToSuperScript(scripted(["[object Object]"]), "x"))).name).toBe("SuperScriptError");
    expect((await rejection(nlToSuperScript(scripted([""]), "x"))).message).toMatch(/draws nothing/);
  });

  it("forwards the signal", async () => {
    const c = scripted(["plot(close)"]);
    const ac = new AbortController();
    await nlToSuperScript(c, "x", { signal: ac.signal });
    expect(c.calls[0].signal).toBe(ac.signal);
  });
});

describe("nlToSuperScriptChecked", () => {
  it("feeds the diagnostics back and returns the repaired script", async () => {
    const c = scripted(["x = close\nx := x * 2\nplot(x)", "x = close * 2\nplot(x)"]);
    const r = await nlToSuperScriptChecked(c, "double the close");
    expect(r).toEqual({ ok: true, source: "x = close * 2\nplot(x)", diagnostics: [], attempts: 2 });
    const repair = c.calls[1].prompt;
    expect(repair).toContain("The request was: double the close");
    expect(repair).toContain("line 2, col 3: error REASSIGNMENT");
    expect(repair).toContain("x := x * 2\n    ^^");
  });

  it("stops after maxRepairs and says it failed", async () => {
    const c = scripted(["plot(clos)"]);
    const r = await nlToSuperScriptChecked(c, "x", { maxRepairs: 1 });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2);
    expect(c.calls).toHaveLength(2);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["UNKNOWN_IDENTIFIER"]);
    const none = await nlToSuperScriptChecked(scripted(["x = 1"]), "x", { maxRepairs: 0 });
    expect([none.ok, none.attempts, none.diagnostics.map((d) => d.code)]).toEqual([false, 1, ["NO_PLOTS"]]);
  });
});

// SC-137: the context is what the user sees, compact and exact.
describe("buildChartContext and analyzeChart", () => {
  const H = 3_600_000;
  function makeBars(n: number, f: (i: number) => number): Bar[] {
    return Array.from({ length: n }, (_, i) => {
      const c = f(i);
      return { timestamp: 1_700_000_000_000 + i * H, open: f(i - 1), high: Math.max(c, f(i - 1)) * 1.001, low: Math.min(c, f(i - 1)) * 0.999, close: c, volume: 1000 + i };
    });
  }
  const fakeChart = (bars: Bar[], from: number, to: number): { getDataList: () => Bar[], getVisibleRange: () => { from: number, to: number, realFrom: number, realTo: number } } => ({ getDataList: () => bars, getVisibleRange: () => ({ from, to, realFrom: from, realTo: to + 11 }) });
  const symbol = { ticker: "BTC-USDT", pricePrecision: 2, volumePrecision: 0 };
  const period = { multiplier: 1, timespan: "hour", text: "1H" };

  it("takes the visible range (from/to clamped to the data), not the newest bars", () => {
    const bars = makeBars(500, (i) => 64_000 + 300 * Math.sin(i / 7));
    const ctx = buildChartContext({ chart: fakeChart(bars, 100, 266), symbol, period, timezone: "Asia/Taipei" });
    expect(ctx.bars).toHaveLength(166);
    expect(ctx.bars[0].timestamp).toBe(bars[100].timestamp);
    expect(ctx.bars[165].timestamp).toBe(bars[265].timestamp);
    expect(ctx.format).toMatchObject({ visibleFrom: 100, visibleTo: 266, bucket: 1, pricePrecision: 2, timezone: "Asia/Taipei", contextRows: 0 });
    const tail = buildChartContext({ chart: fakeChart(bars, 450, 511), symbol, period });
    expect(tail.bars).toHaveLength(50);
    expect(tail.bars[49].timestamp).toBe(bars[499].timestamp);
  });

  /** Row i starts at bar first + i*k (what the prompt's header tells the model). */
  const expectEvenSteps = (ctx: ChartContext, bars: Bar[], first: number, k: number): void => {
    expect(ctx.bars.map((b) => b.timestamp)).toEqual(ctx.bars.map((_b, i) => bars[first + i * k].timestamp));
  };

  it("aggregates a zoomed-out view into at most maxBars OHLCV rows covering the first visible bar", () => {
    const bars = makeBars(1000, (i) => 100 + i);
    const ctx = buildChartContext({ chart: fakeChart(bars, 3, 1000), symbol, period }, { maxBars: 200 });
    expect(ctx.bars.length).toBeLessThanOrEqual(200);
    expect(ctx.format?.bucket).toBe(5);
    expectEvenSteps(ctx, bars, 3, 5);
    // 997 bars in rows of 5: the last row holds the last 2.
    const last = ctx.bars[ctx.bars.length - 1];
    expect([last.timestamp, last.open, last.close, last.high, last.low, last.volume]).toEqual([
      bars[998].timestamp, bars[998].open, bars[999].close,
      Math.max(...bars.slice(998).map((b) => b.high)), Math.min(...bars.slice(998).map((b) => b.low)),
      bars.slice(998).reduce((a, b) => a + (b.volume ?? 0), 0),
    ]);
  });

  it("row i starts i buckets after the first row when the bars do not divide evenly, and says the last row is short", async () => {
    const bars = makeBars(401, (i) => 100 + i);
    const ctx = buildChartContext({ chart: fakeChart(bars, 0, 401), symbol, period }, { maxBars: 200 });
    expect([ctx.format?.bucket, ctx.bars.length]).toEqual([3, 134]);
    expectEvenSteps(ctx, bars, 0, 3);
    expect(ctx.bars[0].volume).toBe(bars.slice(0, 3).reduce((a, b) => a + (b.volume ?? 0), 0));
    const p = await promptFor(ctx);
    expect(p).toContain("step=3x1H");
    expect(p).toContain("401 bars aggregated into 134 rows of 3 bars");
    expect(p).toContain("The last row holds 2 bars.");
  });

  it("aggregated lookback is whole rows ending at the first visible bar, so the steps stay even", () => {
    const bars = makeBars(50, (i) => 100 + i);
    // 5 bars of lookback in rows of 4: two whole rows (bars 12-19), then the visible rows from bar 20.
    const ctx = buildChartContext({ chart: fakeChart(bars, 20, 50), symbol, period }, { maxBars: 10, lookback: 5 });
    expect([ctx.format?.bucket, ctx.format?.contextRows, ctx.bars.length]).toEqual([4, 2, 10]);
    expectEvenSteps(ctx, bars, 12, 4);
    expect(ctx.bars[2].timestamp).toBe(bars[20].timestamp);
    // Not enough data before the window for a whole row: no context rather than a short first row.
    const early = buildChartContext({ chart: fakeChart(bars, 3, 50), symbol, period }, { maxBars: 10, lookback: 5 });
    expect(early.format?.contextRows).toBe(0);
    expectEvenSteps(early, bars, 3, early.format?.bucket ?? 0);
  });

  it("maxBars 1 or 2 with a lookback returns (it used to loop forever) and never exceeds maxBars", () => {
    const bars = makeBars(50, (i) => 100 + i);
    const one = buildChartContext({ chart: fakeChart(bars, 20, 50), symbol, period }, { maxBars: 1, lookback: 5 });
    expect([one.bars.length, one.format?.contextRows]).toEqual([1, 0]);
    expect([one.bars[0].timestamp, one.bars[0].open, one.bars[0].close]).toEqual([bars[20].timestamp, bars[20].open, bars[49].close]);
    const two = buildChartContext({ chart: fakeChart(bars, 20, 50), symbol, period }, { maxBars: 2, lookback: 5 });
    expect(two.bars.length).toBeLessThanOrEqual(2);
    expect(two.bars[two.format?.contextRows ?? 0].timestamp).toBe(bars[20].timestamp);
    expectEvenSteps(two, bars, 20 - (two.format?.contextRows ?? 0) * (two.format?.bucket ?? 1), two.format?.bucket ?? 1);
    const onlyContext = buildChartContext({ chart: fakeChart(bars, 50, 50), symbol, period }, { maxBars: 1, lookback: 5 });
    expect(onlyContext.bars.length).toBe(1);
  });

  it("labels lookback bars as context", () => {
    const bars = makeBars(300, (i) => 100 + i);
    const ctx = buildChartContext({ chart: fakeChart(bars, 200, 250), symbol, period }, { lookback: 30 });
    expect(ctx.bars).toHaveLength(80);
    expect(ctx.format?.contextRows).toBe(30);
    expect(ctx.bars[30].timestamp).toBe(bars[200].timestamp);
  });

  it("reads a SuperChart (getChart/getSymbol/getPeriod/getTimezone)", () => {
    const bars = makeBars(50, (i) => 1 + i / 100);
    const pro = { getChart: () => fakeChart(bars, 10, 20), getSymbol: () => symbol, getPeriod: () => period, getTimezone: () => "UTC" };
    const ctx = buildChartContext(pro);
    expect([ctx.symbol, ctx.period, ctx.bars.length]).toEqual(["BTC-USDT", "1H", 10]);
    expect(() => buildChartContext({ ...pro, getChart: () => null })).toThrow(/not mounted/);
  });

  async function promptFor(ctx: ChartContext): Promise<string> {
    const c = scripted(["ok"]);
    await analyzeChart(c, ctx);
    expect(c.calls[0].system).toBe(ANALYST_SYSTEM_PROMPT);
    return c.calls[0].prompt;
  }

  it("keeps the v1 prompt byte for byte without a format", async () => {
    const bars = makeBars(200, (i) => 64_000 + i * 1.5);
    const recent = bars.slice(-160).map((b) => `${b.timestamp},${b.open},${b.high},${b.low},${b.close},${b.volume ?? ""}`).join("\n");
    const want = `Symbol BTC-USDT, period 1H.\nIndicators on chart: MA.\nRecent OHLCV (timestamp,open,high,low,close,volume):\n${recent}\n\nAnalyze the current structure, key levels, momentum, and likely scenarios.`;
    expect(await promptFor({ symbol: "BTC-USDT", period: "1H", bars, indicators: ["MA"] })).toBe(want);
  });

  it("the compact prompt is shorter, rounds to the symbol's precision and keeps sub-cent prices", async () => {
    // Derived, full-precision floats.
    const floats = makeBars(166, (i) => 64_000 + 300 * Math.sin(i / 7) + Math.PI / 1e3);
    const v1 = await promptFor({ symbol: "BTC-USDT", period: "1H", bars: floats });
    const compact = await promptFor(buildChartContext({ chart: fakeChart(floats, 0, 166), symbol, period, timezone: "Asia/Taipei" }));
    expect(compact.length).toBeLessThan(v1.length * 0.65);
    expect(compact).toContain("start=2023-11-15T06:13:20+08:00");
    expect(compact).toContain("tz=Asia/Taipei rows=166");
    expect(compact).toMatch(/\n0,6\d{4}(\.\d{1,2})?,6\d{4}(\.\d{1,2})?,6\d{4}(\.\d{1,2})?,6\d{4}(\.\d{1,2})?,1000\n/);
    // Exchange-clean (2-decimal) prices do not grow.
    const clean = floats.map((b) => ({ ...b, open: Math.round(b.open * 100) / 100, high: Math.round(b.high * 100) / 100, low: Math.round(b.low * 100) / 100, close: Math.round(b.close * 100) / 100 }));
    const cleanV1 = await promptFor({ symbol: "BTC-USDT", period: "1H", bars: clean });
    const cleanCompact = await promptFor(buildChartContext({ chart: fakeChart(clean, 0, 166), symbol, period }));
    expect(cleanCompact.length).toBeLessThan(cleanV1.length);
    // pricePrecision 8: 0.0000123457 survives (a fixed 2 decimals would write 0).
    const tiny = makeBars(10, () => 0.0000123457);
    const tinyPrompt = await promptFor(buildChartContext({ chart: fakeChart(tiny, 0, 10), symbol: { ticker: "PEPE", pricePrecision: 8 }, period }));
    expect(tinyPrompt).toContain(",0.00001235,");
    const noPrecision = await promptFor(buildChartContext({ chart: fakeChart(tiny, 0, 10), symbol: { ticker: "PEPE" }, period }));
    expect(noPrecision).toContain(",0.0000123457,");
  });

  it("says when rows are aggregated", async () => {
    const bars = makeBars(1000, (i) => 100 + i);
    const p = await promptFor(buildChartContext({ chart: fakeChart(bars, 0, 1000), symbol, period }, { maxBars: 100 }));
    expect(p).toContain("step=10x1H");
    expect(p).toContain("1000 bars aggregated into 100 rows of 10 bars");
  });
});
