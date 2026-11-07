/**
 * SUPer-Chart AI — the AI layer of the chart.
 *
 * Two first-class capabilities, both built on a pluggable `AIClient` so the host
 * app wires the actual model (Claude, a self-hosted endpoint, …) and SUPer-Chart
 * stays model-agnostic:
 *
 *   • nlToSuperScript — natural language → a SuperScript indicator/strategy that
 *     can be registered and drawn on the chart (see `registerScriptIndicator`).
 *     nlToSuperScriptChecked adds a bounded repair loop driven by the
 *     script's diagnostics.
 *   • analyzeChart    — given the candles (buildChartContext reads the visible
 *     ones off a chart), produce a markets analysis (structure, levels,
 *     scenarios).
 *
 * The model call itself never lives in this package — `AIClient.complete` is
 * implemented by the host (which holds the keys / routes to its backend). A
 * ready-made HTTP client (`createHttpAIClient`) is provided for the common case.
 *
 * Nothing here imports klinecharts or touches the DOM: it runs in Node too.
 *
 * Part of Super Chart.
 */
import {
  SuperScriptLanguage, checkSuperScript, formatDiagnostics, superscriptReference,
  type Bar, type Diagnostic,
} from "../runtime";
// Pure (no klinecharts, no DOM): resolves SymbolInfo.pricePrecision's 'auto'
// the same way the chart itself does, from the same bars.
import { resolvePricePrecision } from "@supersolutions/super-chart-core";

export interface AICompleteInput {
  system?: string;
  prompt: string;
  /** Cancels the request. Clients must not serialise it into the request. */
  signal?: AbortSignal;
}

/** The single seam the host implements to plug a model into SUPer-Chart. */
export interface AIClient {
  complete: (input: AICompleteInput) => Promise<string>;
}

export interface HttpAIClientOptions {
  endpoint: string;
  headers?: Record<string, string>;
  /** Abort a request that takes longer (rejects with a "TimeoutError"). */
  timeoutMs?: number;
  /**
   * Map a response body to the model's text when it is none of the shapes the
   * client reads itself (a string, `{ text }`, `{ content: string }`, or
   * Anthropic's `{ content: [{ type: "text", text }] }`), e.g. OpenAI's
   * `{ choices }`.
   */
  extract?: (data: unknown) => string;
}

/** An `AIClient` that POSTs `{ system, prompt }` to a host endpoint and reads back
 * the model's text. Keeps model keys on the host/server. It rejects (instead of
 * returning "" or "[object Object]") on an HTTP error, a body with an `error`,
 * a body it cannot read, or empty text. */
export function createHttpAIClient(opts: HttpAIClientOptions): AIClient {
  return {
    async complete({ system, prompt, signal }: AICompleteInput): Promise<string> {
      const abort = combineSignals(signal, opts.timeoutMs);
      try {
        const res = await fetch(opts.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
          // Exactly these two fields: never the whole input (it holds the signal).
          body: JSON.stringify({ system, prompt }),
          ...(abort.signal !== undefined ? { signal: abort.signal } : {}),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`AI endpoint responded ${res.status}${body.trim() !== "" ? `: ${body.slice(0, 200)}` : ""}`);
        }
        const data: unknown = await res.json();
        const text = opts.extract !== undefined ? opts.extract(data) : textOf(data);
        if (typeof text !== "string" || text.trim() === "") throw new Error("AI endpoint returned no text");
        return text;
      } finally {
        abort.dispose();
      }
    },
  };
}

/** The model's text from a response body, or an Error that says what came back. */
function textOf(data: unknown): string {
  if (typeof data === "string") return data;
  if (typeof data !== "object" || data === null) throw new Error(`AI endpoint returned ${JSON.stringify(data)}, not text`);
  const o = data as Record<string, unknown>;
  if (o.error !== undefined && o.error !== null) {
    throw new Error(`AI endpoint returned an error: ${(typeof o.error === "string" ? o.error : JSON.stringify(o.error)).slice(0, 200)}`);
  }
  if (typeof o.text === "string") return o.text;
  if (typeof o.content === "string") return o.content;
  if (Array.isArray(o.content)) {
    return o.content
      .filter((b): b is { type: string, text: string } => typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text" && typeof (b as { text?: unknown }).text === "string")
      .map((b) => b.text)
      .join("");
  }
  const keys = Object.keys(o);
  throw new Error(`unrecognised AI response (keys: ${keys.length > 0 ? keys.join(", ") : "none"}); pass createHttpAIClient({ extract }) to read it`);
}

/** The caller's signal and an optional timeout as one signal (no AbortSignal.any needed). */
function combineSignals(signal: AbortSignal | undefined, timeoutMs: number | undefined): { signal?: AbortSignal, dispose: () => void } {
  if (signal === undefined && timeoutMs === undefined) return { dispose: () => {} };
  const c = new AbortController();
  const onAbort = (): void => { c.abort(signal?.reason); };
  if (signal !== undefined) {
    if (signal.aborted) c.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = timeoutMs !== undefined
    ? setTimeout(() => { c.abort(new DOMException(`AI request timed out after ${timeoutMs} ms`, "TimeoutError")); }, timeoutMs)
    : undefined;
  return {
    signal: c.signal,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export const SUPERSCRIPT_SYSTEM_PROMPT = `You write SuperScript, the indicator/strategy language for SUPer-Chart.
SuperScript is line-based and Pine-flavoured, but it is not Pine: use only what this reference lists.
${superscriptReference()}
Return ONLY the script, no prose, no code fences.`;

export interface AIRequestOptions {
  signal?: AbortSignal;
}

/**
 * Natural language → a SuperScript indicator (script source). The reply is
 * compiled before it is returned: a reply that is not a valid script, or that
 * draws nothing (prose, "", "[object Object]"), rejects with the error and the
 * start of the reply, so it never reaches registerScriptIndicator. For a
 * repair loop use nlToSuperScriptChecked.
 */
export async function nlToSuperScript(client: AIClient, request: string, opts: AIRequestOptions = {}): Promise<string> {
  const out = await client.complete({ system: SUPERSCRIPT_SYSTEM_PROMPT, prompt: request, ...(opts.signal !== undefined ? { signal: opts.signal } : {}) });
  const source = stripCodeFence(out);
  // Only SuperScript: never a language that runs code.
  const plots = SuperScriptLanguage.compile(source).run([]).plots.length;
  if (plots === 0) throw new Error(`the model's reply draws nothing, so it is not an indicator: ${JSON.stringify(out.slice(0, 200))}`);
  return source;
}

export interface CheckedScript {
  /** True when the last script compiles and draws something. */
  ok: boolean;
  /** The last script the model returned. */
  source: string;
  /** Its diagnostics (errors and warnings). */
  diagnostics: Diagnostic[];
  /** Model calls made (1 + repairs). */
  attempts: number;
}

/**
 * nlToSuperScript with a bounded repair loop: when the script has errors (or
 * draws nothing), the diagnostics — line, column and the offending source
 * line — go back to the model, up to `maxRepairs` times (default 2). Each
 * repair is another model call the host pays for; nothing retries unless the
 * host calls this. Never throws for a bad script: read `ok`.
 */
export async function nlToSuperScriptChecked(client: AIClient, request: string, opts: AIRequestOptions & { maxRepairs?: number } = {}): Promise<CheckedScript> {
  const maxRepairs = Math.max(0, Math.floor(opts.maxRepairs ?? 2));
  let prompt = request;
  for (let attempts = 1; ; attempts++) {
    const out = await client.complete({ system: SUPERSCRIPT_SYSTEM_PROMPT, prompt, ...(opts.signal !== undefined ? { signal: opts.signal } : {}) });
    const source = stripCodeFence(out);
    const diagnostics = checkSuperScript(source);
    const failing = diagnostics.some((d) => d.severity === "error" || d.code === "NO_PLOTS");
    if (!failing || attempts > maxRepairs) return { ok: !failing, source, diagnostics, attempts };
    prompt = [
      `The request was: ${request}`,
      "Your SuperScript was:",
      source,
      "It has these problems:",
      formatDiagnostics(diagnostics, source),
      "Return the corrected script only.",
    ].join("\n");
  }
}

// --------------------------------------------------------------------------
// Chart analysis
// --------------------------------------------------------------------------

/** How analyzeChart writes the bars (set by buildChartContext); absent = the v1 format. */
export interface ChartContextFormat {
  pricePrecision?: number;
  volumePrecision?: number;
  /** IANA time zone the times are written in (default UTC). */
  timezone?: string;
  /** Data indexes of the visible window, [from, to). */
  visibleFrom?: number;
  visibleTo?: number;
  /** Bars per row (1 = not aggregated). */
  bucket?: number;
  /** Bars before aggregation. */
  sourceBars?: number;
  /** Leading rows that are context before the visible window. */
  contextRows?: number;
}

export interface ChartContext {
  symbol: string;
  period: string;
  bars: Bar[];
  /** Optional indicators already on the chart, for context. */
  indicators?: string[];
  /** Compact serialisation (rounded, indexed rows, aggregated). Set by buildChartContext. */
  format?: ChartContextFormat;
}

/** What buildChartContext reads from a chart; a klinecharts Chart has both. */
export interface ChartDataSource {
  getDataList: () => readonly Bar[];
  getVisibleRange: () => { from: number, to: number };
}

interface SymbolLike { ticker: string, pricePrecision?: number | "auto", volumePrecision?: number }
interface PeriodLike { multiplier: number, timespan: string, text?: string }

/** A SuperChart (or anything with the same getters). */
export interface ChartProLike {
  getChart: () => ChartDataSource | null;
  getSymbol: () => SymbolLike;
  getPeriod: () => PeriodLike;
  getTimezone: () => string;
}

export interface ChartContextParts {
  chart: ChartDataSource;
  symbol: SymbolLike;
  period: PeriodLike | string;
  timezone?: string;
}

export interface ChartContextOptions {
  /** 'visible' (default): the bars on screen; 'all'; or data indexes [from, to). */
  range?: "visible" | "all" | { from: number, to: number };
  /** Most rows to send (default 200); more bars are aggregated into OHLCV buckets. */
  maxBars?: number;
  /**
   * Bars before the range to include, labelled as context (default 0). When
   * rows are aggregated the context is whole rows ending at the first visible
   * bar: rounded up to whole rows, fewer when the data starts sooner, none
   * when not even one row fits or maxBars is 1.
   */
  lookback?: number;
  indicators?: string[];
}

/**
 * The ChartContext for analyzeChart from a chart: the bars the user sees (not
 * the newest 160), aggregated into at most `maxBars` OHLCV rows when zoomed
 * out, with the symbol's precision and the chart's time zone so the prompt
 * is short and exact. Works with a SuperChart or `{ chart, symbol, period }`
 * around any klinecharts Chart (./lite).
 */
export function buildChartContext(source: ChartProLike | ChartContextParts, opts: ChartContextOptions = {}): ChartContext {
  const parts: { chart: ChartDataSource | null, symbol: SymbolLike, period: PeriodLike | string, timezone?: string } =
    "getChart" in source
      ? { chart: source.getChart(), symbol: source.getSymbol(), period: source.getPeriod(), timezone: source.getTimezone() }
      : source;
  const chart = parts.chart;
  if (chart === null) throw new Error("buildChartContext: the chart has not mounted yet (getChart() is null)");
  const dl = chart.getDataList();
  const n = dl.length;
  const clamp = (x: number): number => Math.max(0, Math.min(n, Math.round(x)));
  let from: number;
  let to: number;
  const range = opts.range ?? "visible";
  if (range === "all") {
    from = 0; to = n;
  } else if (range === "visible") {
    // from/to, not realFrom/realTo (which can run past the data).
    const vr = chart.getVisibleRange();
    from = clamp(vr.from); to = clamp(vr.to);
  } else {
    from = clamp(range.from); to = clamp(range.to);
  }
  if (to < from) to = from;
  const visibleBars = to - from;
  const maxBars = Math.max(1, Math.floor(opts.maxBars ?? 200));
  // Context and visible bars never share a row, so one row cannot hold both.
  const lookback = visibleBars > 0 && maxBars < 2 ? 0 : Math.max(0, Math.min(Math.floor(opts.lookback ?? 0), from));
  /** The smallest bucket that fits `ctx` context bars and the visible ones into maxBars rows. */
  const fit = (ctx: number): number => {
    let b = Math.max(1, Math.ceil((ctx + visibleBars) / maxBars));
    while (Math.ceil(ctx / b) + Math.ceil(visibleBars / b) > maxBars) b++;
    return b;
  };
  let k = fit(lookback);
  // Whole rows of context ending at `from`, so every row but the last holds k
  // bars and row i starts i*k bars after row 0 (what the prompt says).
  const contextBars = Math.min(Math.ceil(lookback / k), Math.floor(from / k)) * k;
  if (contextBars === 0 && lookback > 0) k = fit(0);
  const rows = aggregate(dl.slice(from - contextBars, to), k);
  const period = typeof parts.period === "string" ? parts.period : parts.period.text ?? `${parts.period.multiplier}${parts.period.timespan}`;
  const format: ChartContextFormat = {
    timezone: parts.timezone ?? "UTC",
    visibleFrom: from,
    visibleTo: to,
    bucket: k,
    sourceBars: contextBars + visibleBars,
    contextRows: contextBars / k,
  };
  // SymbolInfo.pricePrecision (src/types.ts) is number | 'auto' | undefined.
  // undefined keeps this format field unset (num() below then falls back to
  // 8 significant digits, whatever the price's magnitude); 'auto' resolves
  // the same way the chart itself does (src/data/precision.ts), from the
  // same bars, so the prompt's numbers match what the user sees.
  if (parts.symbol.pricePrecision === "auto") {
    format.pricePrecision = resolvePricePrecision("auto", dl.slice(from - contextBars, to));
  } else if (parts.symbol.pricePrecision !== undefined) {
    format.pricePrecision = parts.symbol.pricePrecision;
  }
  if (parts.symbol.volumePrecision !== undefined) format.volumePrecision = parts.symbol.volumePrecision;
  const ctx: ChartContext = { symbol: parts.symbol.ticker, period, bars: rows, format };
  if (opts.indicators !== undefined) ctx.indicators = opts.indicators;
  return ctx;
}

/** OHLCV buckets of k bars from the first bar (only the last can be short), so row i starts i*k bars in. */
function aggregate(bars: readonly Bar[], k: number): Bar[] {
  if (k <= 1) return bars.map((b) => ({ ...b }));
  const out: Bar[] = [];
  for (let start = 0; start < bars.length; start += k) {
    const chunk = bars.slice(start, start + k);
    let high = -Infinity;
    let low = Infinity;
    let volume: number | undefined;
    for (const b of chunk) {
      high = Math.max(high, b.high);
      low = Math.min(low, b.low);
      if (b.volume !== undefined) volume = (volume ?? 0) + b.volume;
    }
    const row: Bar = { timestamp: chunk[0].timestamp, open: chunk[0].open, high, low, close: chunk[chunk.length - 1].close };
    if (volume !== undefined) row.volume = volume;
    out.push(row);
  }
  return out;
}

export const ANALYST_SYSTEM_PROMPT = `You are a professional markets analyst embedded in a trading chart.
Be concise and concrete. Reference price structure, key support/resistance, momentum,
and lay out the most likely scenarios with invalidation levels. Never give financial
advice or position sizing — describe the chart, not what the user should do.`;

/** Analyse the candles in `ctx` (buildChartContext gives the visible ones). `question` is optional follow-up context. */
export async function analyzeChart(client: AIClient, ctx: ChartContext, question?: string, opts: AIRequestOptions = {}): Promise<string> {
  const indicators = ctx.indicators !== undefined && ctx.indicators.length > 0 ? `\nIndicators on chart: ${ctx.indicators.join(", ")}.` : "";
  const data = ctx.format === undefined ? v1Bars(ctx) : compactBars(ctx, ctx.format);
  const prompt =
    `Symbol ${ctx.symbol}, period ${ctx.period}.${indicators}\n` +
    `${data}\n\n` +
    (question ?? "Analyze the current structure, key levels, momentum, and likely scenarios.");
  return await client.complete({ system: ANALYST_SYSTEM_PROMPT, prompt, ...(opts.signal !== undefined ? { signal: opts.signal } : {}) });
}

/** The v1 format, unchanged: the newest 160 bars at full precision. */
function v1Bars(ctx: ChartContext): string {
  const recent = ctx.bars
    .slice(-160)
    .map((b) => `${b.timestamp},${b.open},${b.high},${b.low},${b.close},${b.volume ?? ""}`)
    .join("\n");
  return `Recent OHLCV (timestamp,open,high,low,close,volume):\n${recent}`;
}

function compactBars(ctx: ChartContext, f: ChartContextFormat): string {
  const bars = ctx.bars;
  if (bars.length === 0) return "No bars in view.";
  const tz = f.timezone ?? "UTC";
  const k = f.bucket ?? 1;
  const header = [
    `Bars (i,open,high,low,close,volume): start=${isoInZone(bars[0].timestamp, tz)} end=${isoInZone(bars[bars.length - 1].timestamp, tz)} step=${k > 1 ? `${k}x${ctx.period}` : ctx.period} tz=${tz} rows=${bars.length}.`,
    "Row i starts i steps after start; times skip market closures.",
  ];
  if (k > 1) {
    const lastRow = f.sourceBars !== undefined ? f.sourceBars - (bars.length - 1) * k : k;
    header.push(`${f.sourceBars ?? bars.length * k} bars aggregated into ${bars.length} rows of ${k} bars (first open, highest high, lowest low, last close, summed volume).` +
      (lastRow > 0 && lastRow < k ? ` The last row holds ${lastRow} bars.` : ""));
  }
  const c = f.contextRows ?? 0;
  if (c > 0) header.push(`Rows 0-${c - 1} are context before the visible window; the user sees rows ${c}-${bars.length - 1}.`);
  const p = (x: number): string => num(x, f.pricePrecision);
  const rows = bars.map((b, i) => `${i},${p(b.open)},${p(b.high)},${p(b.low)},${p(b.close)},${b.volume === undefined ? "" : num(b.volume, f.volumePrecision)}`);
  return `${header.join("\n")}\n${rows.join("\n")}`;
}

/** A number rounded to `precision` decimals (8 significant digits without one), trailing zeros dropped. */
function num(x: number, precision?: number): string {
  if (!Number.isFinite(x)) return "";
  const r = precision !== undefined && precision >= 0 && precision <= 20 ? Number(x.toFixed(precision)) : Number(x.toPrecision(8));
  return String(r);
}

/** ISO 8601 in a time zone, with its offset (Z for UTC). */
function isoInZone(ts: number, tz: string): string {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const p: Record<string, string> = {};
    for (const part of f.formatToParts(new Date(ts))) p[part.type] = part.value;
    const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
    const off = Math.round((wall - Math.floor(ts / 1000) * 1000) / 60000);
    const two = (v: number): string => String(v).padStart(2, "0");
    const zone = off === 0 ? "Z" : `${off < 0 ? "-" : "+"}${two(Math.floor(Math.abs(off) / 60))}:${two(Math.abs(off) % 60)}`;
    return `${p.year}-${p.month}-${p.day}T${two(Number(p.hour) % 24)}:${p.minute}:${p.second}${zone}`;
  } catch {
    return new Date(ts).toISOString();
  }
}

function stripCodeFence(s: string): string {
  const m = /```[a-z]*\n([\s\S]*?)```/i.exec(s);
  return (m !== null ? m[1] : s).trim();
}
