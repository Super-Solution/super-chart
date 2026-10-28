import type { DeepPartial, Styles, LineType, PolygonType, TooltipIconPosition, TooltipIconStyle } from "klinecharts";

import { mergeDeep } from "./common/object";
import { inkOn } from "./theme/ink";
import { CANVAS_FONT, CANVAS_MONO, CANVAS_PALETTE, ICON_FONT_FAMILY, INK } from "./theme/tokens";
import type { CanvasPalette, ThemeName } from "./theme/tokens";

type KMod = typeof import("klinecharts");

// klinecharts' enum values, spelled out so this module needs no runtime
// klinecharts import (the lite entry and SSR hosts load it).
const SOLID = "solid" as unknown as LineType;
const FILL = "fill" as unknown as PolygonType;
const MIDDLE = "middle" as unknown as TooltipIconPosition;

/**
 * Every canvas text path set to one font family. klinecharts has 12 of them
 * (axis ticks, both tooltips, the crosshair tags, the last-price tag, the
 * high/low marks, indicator last-value marks and overlay text), each defaulting
 * to 'Helvetica Neue' with no fallback, which draws in Times New Roman on
 * Windows. Legend icons keep their icon font.
 */
export function canvasFontStyles(family: string = CANVAS_FONT): DeepPartial<Styles> {
  const text = { family };
  return {
    candle: {
      priceMark: {
        high: { textFamily: family },
        low: { textFamily: family },
        last: { text },
      },
      tooltip: { text },
    },
    indicator: { lastValueMark: { text }, tooltip: { text } },
    xAxis: { tickText: text },
    yAxis: { tickText: text },
    crosshair: { horizontal: { text }, vertical: { text } },
    overlay: { text, rectText: text },
  };
}

/**
 * Shared KLineChart theme so a raw `klinecharts.init()` chart reads like
 * TradingView rather than the default demo:
 *   • one text style (monospace numerals, 11px, one weight) on every text path
 *   • a labelled CROSSHAIR with price (y) and time (x) tags (the TradingView feel)
 *   • TradingView candle colors (#26a69a / #ef5350) on body, border and wick,
 *     and the same colors, translucent, on indicator bars (VOL, MACD)
 *   • a dashed last-price line with a dark-ink tag
 *   • hairline axes and a faint grid in translucent neutrals, so they sit on
 *     any near-black (or near-white) host surface
 * Floating high/low marks stay hidden; the last-price tag + line are kept by
 * default (pass { lastPriceTag: false } to hide the tag, e.g. when a header
 * already shows price). Overlay colours are left to klinecharts (or to the
 * Pro engine's theme), so host drawings keep their colours.
 *
 * Part of SUPer-Chart's lightweight surface (no Solid / no Pro chrome) — usable by
 * any host that drives a klinecharts instance directly.
 */
export function chartStyles(mod: KMod, dark: boolean, opts: { lastPriceTag?: boolean } = {}): DeepPartial<Styles> {
  // TradingView palette: teal/red candles, cool-grey axis text.
  const axisColor = dark ? "#b2b5be" : "#6a6d78";
  const gridColor = dark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)";
  const lineColor = dark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)";
  const tagFill = dark ? "#d1d4dc" : INK; // crosshair tag background
  const tagText = dark ? INK : "#ffffff"; // crosshair tag text
  const up = "#26a69a"; // TradingView green
  const down = "#ef5350"; // TradingView red
  // At least 4.5:1 against INK, the last-price tag's text.
  const noChange = dark ? "#8a8f9c" : "#9598a1";
  const upBar = "rgba(38, 166, 154, 0.65)";
  const downBar = "rgba(239, 83, 80, 0.65)";

  // One text style and one tag shape for every label on the canvas.
  const txt = { size: 11, family: CANVAS_MONO, weight: "normal" };
  const tagShape = { paddingLeft: 5, paddingRight: 5, paddingTop: 3, paddingBottom: 3, borderRadius: 3 };
  const tag = { show: true, color: tagText, ...txt, ...tagShape, borderColor: tagFill, borderSize: 0, backgroundColor: tagFill };
  const xhairLine = { show: true, style: mod.LineType.Dashed, dashedValue: [4, 3], size: 1, color: axisColor };

  // All nine keys: klinecharts >= 9.2 draws the border and wick from their own
  // keys (defaulting to its green/red), so body-only colors came out two-tone.
  const bar = {
    upColor: up,
    downColor: down,
    noChangeColor: noChange,
    upBorderColor: up,
    downBorderColor: down,
    noChangeBorderColor: noChange,
    upWickColor: up,
    downWickColor: down,
    noChangeWickColor: noChange,
  };
  // Full array elements: klinecharts 9.1 replaces arrays on merge, 9.8 merges them.
  const barElement = {
    style: mod.PolygonType.Fill,
    borderStyle: mod.LineType.Solid,
    borderSize: 1,
    borderDashedValue: [2, 2],
    upColor: upBar,
    downColor: downBar,
    noChangeColor: noChange,
  };

  // The font layer first, so no text path is left on klinecharts' serif default.
  return mergeDeep<DeepPartial<Styles>>(canvasFontStyles(CANVAS_MONO), {
    candle: {
      bar,
      priceMark: {
        high: { show: false, textFamily: CANVAS_MONO, textSize: txt.size },
        low: { show: false, textFamily: CANVAS_MONO, textSize: txt.size },
        // TradingView's dashed last-price line + axis tag, colored by direction.
        last: {
          show: true,
          upColor: up,
          downColor: down,
          noChangeColor: noChange,
          line: { show: true, style: mod.LineType.Dashed, dashedValue: [4, 4], size: 1 },
          text: { show: opts.lastPriceTag !== false, color: INK, ...txt, ...tagShape },
        },
      },
      tooltip: { showRule: mod.TooltipShowRule.FollowCross, text: { color: axisColor, ...txt } },
    },
    indicator: {
      ohlc: { upColor: upBar, downColor: downBar, noChangeColor: noChange },
      bars: [barElement],
      circles: [{ ...barElement }],
      lastValueMark: { text: { ...txt, ...tagShape } },
      tooltip: { showRule: mod.TooltipShowRule.FollowCross, text: { color: axisColor, ...txt } },
    },
    grid: {
      show: true,
      horizontal: { show: true, style: mod.LineType.Solid, color: gridColor },
      vertical: { show: true, style: mod.LineType.Solid, color: gridColor },
    },
    xAxis: { tickText: { color: axisColor, ...txt }, axisLine: { color: lineColor }, tickLine: { color: lineColor } },
    yAxis: { tickText: { color: axisColor, ...txt }, axisLine: { color: lineColor }, tickLine: { color: lineColor } },
    crosshair: {
      show: true,
      horizontal: { show: true, line: xhairLine, text: tag },
      vertical: { show: true, line: xhairLine, text: tag },
    },
    // Font only: drawing labels match the axis. Colours stay the engine's.
    overlay: { text: { ...txt }, rectText: { ...txt } },
  });
}

/** The four legend icons klinecharts draws after an indicator's name, in the order ChartProComponent picks them. */
const LEGEND_ICONS: ReadonlyArray<{ id: string; icon: string; marginLeft: number }> = [
  { id: "visible", icon: "", marginLeft: 8 },
  { id: "invisible", icon: "", marginLeft: 8 },
  { id: "setting", icon: "", marginLeft: 6 },
  { id: "close", icon: "", marginLeft: 6 },
];

/** The legend icons in one colour and hover wash. All four, always: klinecharts replaces this array on merge. */
export function legendIconStyles(color: string, hover: string): TooltipIconStyle[] {
  return LEGEND_ICONS.map(({ id, icon, marginLeft }) => ({
    id,
    position: MIDDLE,
    marginLeft,
    marginTop: 7,
    marginRight: 0,
    marginBottom: 0,
    paddingLeft: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    icon,
    fontFamily: ICON_FONT_FAMILY,
    size: 14,
    color,
    activeColor: color,
    backgroundColor: "transparent",
    activeBackgroundColor: hover,
  }));
}

/** Parse '#RGB', '#RRGGBB' or 'rgb(a)(…)' to [r, g, b]; null otherwise. */
function rgbOf(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex !== null) {
    const h = hex[1].length === 3 ? hex[1].split("").map(c => c + c).join("") : hex[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color.trim());
  return fn === null ? null : [Number(fn[1]), Number(fn[2]), Number(fn[3])];
}

/** The colour at an alpha, or the colour unchanged when it is not hex or rgb(). */
function alpha(color: string, a: number): string {
  const rgb = rgbOf(color);
  return rgb === null ? color : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}

/**
 * The line/area series in the accent. `line` is klinecharts' area type with no
 * fill. `point.animation: false` stops klinecharts 9.8's endless ripple at the
 * last point (a redraw every frame while the chart is idle); it must be in the
 * same setStyles call that switches to the area type, since turning it off on
 * a running animation does not stop it.
 */
export function areaStyles(line: boolean, accent: string): DeepPartial<Styles> {
  return {
    candle: {
      area: {
        lineColor: accent,
        backgroundColor: line
          ? [{ offset: 0, color: alpha(accent, 0) }, { offset: 1, color: alpha(accent, 0) }]
          : [{ offset: 0, color: alpha(accent, 0.01) }, { offset: 1, color: alpha(accent, 0.2) }],
        point: { color: accent, rippleColor: alpha(accent, 0.3), animation: false },
      },
    },
  };
}

/**
 * Drawing defaults in the accent. Super Chart's own tools read their accent
 * from these at draw time (src/extension/accent.ts), so they match
 * klinecharts' built-in tools (segment, fibonacci, annotations) and the colour
 * popover's first swatch. Label text is white or dark ink, whichever reads
 * better on the accent. Colours only; the family comes from the font layer.
 */
function overlayStyles(accent: string): DeepPartial<Styles> {
  const text = { color: inkOn(accent), borderColor: accent, backgroundColor: accent };
  return {
    overlay: {
      point: { color: accent, borderColor: alpha(accent, 0.35), activeColor: accent, activeBorderColor: alpha(accent, 0.35) },
      line: { color: accent },
      rect: { color: alpha(accent, 0.25), borderColor: accent },
      polygon: { color: accent, borderColor: accent },
      circle: { color: alpha(accent, 0.25), borderColor: accent },
      arc: { color: accent },
      text,
      rectText: { ...text },
    },
  };
}

/**
 * The Pro engine's canvas theme: paint only (colours and the grid's line
 * style), never behaviour (no showRule, no show flags, no chart type) and no
 * fonts (canvasFontStyles is its own layer). It covers every key of
 * klinecharts' built-in light/dark styles, so switching themes leaves nothing
 * of the other theme behind.
 *
 * `tokens` overrides palette entries, e.g. from the host's CSS custom
 * properties (the engine passes the ones a host changed). Unlike chartStyles,
 * this is what the engine applies itself; pass `canvasTheme: false` in the
 * chart options for klinecharts' own look.
 */
export function canvasTheme(theme: ThemeName, tokens: Partial<CanvasPalette> = {}): DeepPartial<Styles> {
  const p: CanvasPalette = { ...CANVAS_PALETTE[theme], ...tokens };
  const bar = {
    upColor: p.up,
    downColor: p.down,
    noChangeColor: p.noChange,
    upBorderColor: p.up,
    downBorderColor: p.down,
    noChangeBorderColor: p.noChange,
    upWickColor: p.up,
    downWickColor: p.down,
    noChangeWickColor: p.noChange,
  };
  const barElement = {
    style: FILL,
    borderStyle: SOLID,
    borderSize: 1,
    borderDashedValue: [2, 2],
    upColor: p.upBar,
    downColor: p.downBar,
    noChangeColor: p.noChangeBar,
  };
  const gridLine = { style: SOLID, color: p.grid };
  const axis = { axisLine: { color: p.grid }, tickLine: { color: p.grid }, tickText: { color: p.textSecond } };
  const crosshair = { line: { color: p.textSecond }, text: { color: "#FFFFFF", borderColor: p.crosshairTag, backgroundColor: p.crosshairTag } };
  return {
    grid: { horizontal: gridLine, vertical: { ...gridLine } },
    candle: {
      bar,
      priceMark: {
        high: { color: p.textSecond },
        low: { color: p.textSecond },
        last: { upColor: p.up, downColor: p.down, noChangeColor: p.noChange, text: { color: p.tagInk } },
      },
      tooltip: { rect: { color: p.tooltipRect, borderColor: p.tooltipRectBorder }, text: { color: p.textSecond } },
    },
    indicator: {
      ohlc: { upColor: p.upBar, downColor: p.downBar, noChangeColor: p.noChangeBar },
      bars: [barElement],
      circles: [{ ...barElement }],
      tooltip: { text: { color: p.textSecond }, icons: legendIconStyles(p.textSecond, p.hover) },
    },
    xAxis: axis,
    yAxis: { ...axis },
    separator: { color: p.grid },
    crosshair: { horizontal: crosshair, vertical: { ...crosshair } },
    ...overlayStyles(p.accent),
  };
}

/**
 * The colour keys of klinecharts' registered 'light' and 'dark' styles
 * (identical in 9.1.1 to 9.8.12). Applied first on every theme change, so the
 * `canvasTheme: false` look toggles exactly as `setStyles('dark')` did.
 */
export function klinechartsThemeStyles(theme: ThemeName): DeepPartial<Styles> {
  const dark = theme === "dark";
  const grid = dark ? "#292929" : "#EDEDED";
  const muted = dark ? "#929AA5" : "#76808F";
  const line = dark ? "#333333" : "#DDDDDD";
  const tag = dark ? "#373a40" : "#686D76";
  const rect = dark ? "rgba(10, 10, 10, .6)" : "#FEFEFE";
  const axis = { axisLine: { color: line }, tickText: { color: muted }, tickLine: { color: line } };
  const crosshair = { line: { color: muted }, text: { borderColor: tag, backgroundColor: tag } };
  return {
    grid: { horizontal: { color: grid }, vertical: { color: grid } },
    candle: {
      priceMark: { high: { color: muted }, low: { color: muted } },
      tooltip: { rect: { color: rect, borderColor: dark ? rect : "#F2F3F5" }, text: { color: muted } },
    },
    indicator: { tooltip: { text: { color: muted } } },
    xAxis: axis,
    yAxis: { ...axis },
    separator: { color: line },
    crosshair: { horizontal: crosshair, vertical: { ...crosshair } },
  };
}
