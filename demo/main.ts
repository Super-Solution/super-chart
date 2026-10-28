/**
 * SUPer-Chart demo — proves the whole stack end-to-end in the browser:
 *   • the KLineChart-Pro engine (TradingView-style UI: drawing bar, periods,
 *     symbol search, indicators, multi-pane) rendered via `KLineChartPro`;
 *   • two indicators written in *SuperScript* — an SMA cross on the price pane
 *     and an RSI in a sub-pane — registered with `registerScriptIndicator` and
 *     mounted by name through the Pro options.
 *
 * The datafeed is a deterministic, offline synthetic series (no API key, stable
 * for screenshots). Swap it for a real `Datafeed` to go live.
 */
import { KLineChartPro, registerScriptIndicator } from "../src/index";
import type { Datafeed, SymbolInfo, Period } from "../src/types";
import type { KLineData } from "klinecharts";

// --- deterministic synthetic price (smooth, no randomness) ------------------
function priceAt(i: number): number {
  return 100 + 25 * Math.sin(i / 40) + 10 * Math.sin(i / 11) + 4 * Math.sin(i / 3.3);
}
function periodToMs(p: Period): number {
  const unit: Record<string, number> = {
    minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000,
  };
  return p.multiplier * (unit[p.timespan] ?? 60_000);
}
function candle(i: number, span: number): KLineData {
  const o = priceAt(i);
  const c = priceAt(i + 1);
  const wig = 0.6 + 1.8 * Math.abs(Math.sin(i / 3));
  return {
    timestamp: i * span,
    open: o,
    high: Math.max(o, c) + wig,
    low: Math.min(o, c) - wig,
    close: c,
    volume: 500 + 400 * Math.abs(Math.sin(i / 5)),
  };
}

const SYMBOL: SymbolInfo = {
  ticker: "SUPER-USDT", name: "SuperCoin / Tether", shortName: "SUPER",
  exchange: "ZZYZX", market: "crypto", pricePrecision: 2, volumePrecision: 0,
  priceCurrency: "USDT", type: "crypto",
};

let timer: number | undefined;
const datafeed: Datafeed = {
  async searchSymbols(search?: string): Promise<SymbolInfo[]> {
    const all = [SYMBOL, { ...SYMBOL, ticker: "DEMO-USDT", name: "Demo / Tether", shortName: "DEMO" }];
    const q = (search ?? "").toUpperCase();
    return all.filter((s) => s.ticker.includes(q) || (s.name ?? "").toUpperCase().includes(q));
  },
  async getHistoryKLineData(_symbol, period, from, to): Promise<KLineData[]> {
    const span = periodToMs(period);
    const start = Math.floor(from / span);
    const end = Math.floor(to / span);
    const out: KLineData[] = [];
    for (let i = start; i < end; i++) out.push(candle(i, span));
    return out;
  },
  subscribe(_symbol, period, callback): void {
    // Static by default (deterministic, screenshot-friendly). Add ?live=1 for a
    // gently ticking forming bar.
    if (!new URLSearchParams(location.search).has("live")) return;
    const span = periodToMs(period);
    timer = window.setInterval(() => {
      const i = Math.floor(Date.now() / span);
      const o = priceAt(i);
      const c = priceAt(i) + Math.sin(Date.now() / 700); // gentle live wiggle on the forming bar
      callback({ timestamp: i * span, open: o, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, close: c, volume: 600 });
    }, 1000);
  },
  unsubscribe(): void {
    if (timer) window.clearInterval(timer);
  },
};

// --- SuperScript indicators -> native chart indicators ----------------------
registerScriptIndicator({
  name: "SUPER_SMACROSS",
  source: `
    // @title Super SMA Cross
    fast = sma(close, 10)
    slow = sma(close, 30)
    plot(fast, title="Fast 10", color="#2962ff")
    plot(slow, title="Slow 30", color="#ff9800")
  `,
});
registerScriptIndicator({
  name: "SUPER_RSI",
  source: `
    // @title Super RSI
    plot(rsi(close, 14), title="RSI 14", color="#ab47bc")
  `,
});

// --- mount the chart --------------------------------------------------------
const periods: Period[] = [
  { multiplier: 15, timespan: "minute", text: "15m" },
  { multiplier: 1, timespan: "hour", text: "1H" },
  { multiplier: 4, timespan: "hour", text: "4H" },
  { multiplier: 1, timespan: "day", text: "D" },
];

new KLineChartPro({
  container: "chart",
  symbol: SYMBOL,
  period: periods[1],
  periods,
  datafeed,
  locale: "en-US",
  theme: "dark",
  timezone: "Etc/UTC",
  mainIndicators: ["MA", "SUPER_SMACROSS"],
  subIndicators: ["VOL", "SUPER_RSI"],
  drawingBarVisible: true,
});
