// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * What a chart says to someone who cannot see the canvas: a summary of the visible window, and a one-bar readout
 * for keyboard stepping. Values arrive as plain strings (prices at the chart's own precision, dates in the chart's
 * own timezone rules) so a host can phrase them in its language with `EngineChartOptions.descriptions`; the
 * English wording below is only the default.
 */
import { derivePrecision, formatBarDate, type EngineFrame, type EngineRenderOptions, type MarketBar } from '@supersolutions/super-chart-core'

/** Strings for the summary of what the chart currently shows. */
export interface ChartSummaryText {
  /** The series style, for example `candles`. */
  chartType: string
  /** Bars loaded, and how many of them are in view. */
  total: string
  shown: string
  /** Time of the first and last bar in view. */
  from: string
  to: string
  /** The last bar in view. */
  open: string
  high: string
  low: string
  close: string
  /** Signed percentage against the bar before it, for example `+1.23%`; empty when there is no earlier bar or it closed at 0. */
  change: string
  /** Names of the visible indicators, comma separated; empty when there are none. */
  indicators: string
}

/** Strings for one bar, read out when a keyboard user steps the crosshair onto it. */
export interface BarReadoutText {
  time: string
  open: string
  high: string
  low: string
  close: string
  /** Empty when the bar carries no volume. */
  volume: string
  /** As in `ChartSummaryText.change`. */
  change: string
}

/** Wording hooks; each one replaces the English default for that sentence. */
export interface ChartDescriptions {
  summary?: (text: ChartSummaryText) => string
  bar?: (text: BarReadoutText) => string
}

export function defaultSummary (t: ChartSummaryText): string {
  return `Price chart, ${t.chartType}. ${t.shown} of ${t.total} bars in view, ${t.from} to ${t.to}. ` +
    `Last bar in view: open ${t.open}, high ${t.high}, low ${t.low}, close ${t.close}${t.change === '' ? '' : `, ${t.change} from the previous close`}.` +
    (t.indicators === '' ? '' : ` Indicators: ${t.indicators}.`)
}

export function defaultBar (t: BarReadoutText): string {
  return `${t.time}: open ${t.open}, high ${t.high}, low ${t.low}, close ${t.close}${t.change === '' ? '' : `, ${t.change}`}${t.volume === '' ? '' : `, volume ${t.volume}`}`
}

const DAY_OR_LARGER = new Set(['day', 'week', 'month', 'year'])
const dtfs = new Map<string, Intl.DateTimeFormat>()
function displayFormat (timeZone: string): Intl.DateTimeFormat {
  let dtf = dtfs.get(timeZone)
  if (dtf === undefined) {
    try { dtf = new Intl.DateTimeFormat('en', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone }) } catch { dtf = new Intl.DateTimeFormat('en', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }) }
    if (dtfs.size >= 8) dtfs.delete(dtfs.keys().next().value as string)
    dtfs.set(timeZone, dtf)
  }
  return dtf
}

function timeText (timestamp: number, options: EngineRenderOptions): string {
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) return String(timestamp)
  const timespan = options.timespan ?? ''
  const format = DAY_OR_LARGER.has(timespan) ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm'
  return formatBarDate({ displayDtf: displayFormat(options.timeZone ?? 'UTC'), timestamp, timespan, symbolTimezone: options.symbolTimezone, type: 'tooltip', format })
}

function changeText (close: number, previousClose: number | undefined): string {
  if (previousClose === undefined || !Number.isFinite(previousClose) || previousClose === 0) return ''
  const percent = (close - previousClose) / Math.abs(previousClose) * 100
  if (!Number.isFinite(percent)) return ''
  return `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`
}

const volumeFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 2, notation: 'compact' })

/** Digits the chart itself prints on its price axis. */
export function priceDigits (frame: EngineFrame, options: EngineRenderOptions): number {
  return options.pricePrecision ?? frame.pricePrecision ?? derivePrecision(frame.snapshot.bars)
}

/** The summary strings for the visible window, or null while the chart has nothing to show. */
export function chartSummaryText (frame: EngineFrame, options: EngineRenderOptions, total: number, indicatorNames: readonly string[]): ChartSummaryText | null {
  const bars = frame.snapshot.bars
  if (bars.length === 0) return null
  const first = bars[0], last = bars[bars.length - 1]
  const digits = priceDigits(frame, options)
  const previous = bars.length > 1 ? bars[bars.length - 2].close : frame.previousClose
  return {
    chartType: options.chartType ?? 'candles',
    total: String(total),
    shown: String(bars.length),
    from: timeText(first.timestamp, options),
    to: timeText(last.timestamp, options),
    open: last.open.toFixed(digits),
    high: last.high.toFixed(digits),
    low: last.low.toFixed(digits),
    close: last.close.toFixed(digits),
    change: changeText(last.close, previous),
    indicators: indicatorNames.join(', ')
  }
}

/** The readout strings for one bar and the close before it. */
export function barReadoutText (bar: Readonly<MarketBar>, previousClose: number | undefined, digits: number, options: EngineRenderOptions): BarReadoutText {
  return {
    time: timeText(bar.timestamp, options),
    open: bar.open.toFixed(digits),
    high: bar.high.toFixed(digits),
    low: bar.low.toFixed(digits),
    close: bar.close.toFixed(digits),
    volume: bar.volume === undefined || bar.volume === null || !Number.isFinite(bar.volume) ? '' : volumeFormat.format(bar.volume),
    change: changeText(bar.close, previousClose)
  }
}

/** Visually hidden, still read by screen readers. */
const HIDDEN = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;'

/**
 * Two hidden elements inside the chart: a description the region points at with `aria-describedby` (read when the
 * chart gets focus, never announced by itself, so a live feed does not chatter), and a polite live region used only
 * for what the person just did with the keyboard.
 */
export function attachChartSpeech (root: HTMLElement): { setDescription: (text: string) => void, announce: (text: string) => void, dispose: () => void } {
  const doc = root.ownerDocument
  const description = doc.createElement('div'), status = doc.createElement('div')
  const id = `sc-chart-desc-${Math.random().toString(36).slice(2, 10)}`
  description.id = id; description.style.cssText = HIDDEN
  status.style.cssText = HIDDEN
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true')
  root.append(description, status)
  root.setAttribute('aria-describedby', id)
  let announcement: ReturnType<typeof setTimeout> | null = null
  return {
    setDescription: text => { if (description.textContent !== text) description.textContent = text },
    // Clearing first makes a repeated sentence (the same bar twice) announce again.
    announce: text => {
      status.textContent = ''
      if (announcement !== null) clearTimeout(announcement)
      announcement = setTimeout(() => { announcement = null; status.textContent = text }, 30)
    },
    dispose: () => {
      if (announcement !== null) clearTimeout(announcement)
      root.removeAttribute('aria-describedby'); description.remove(); status.remove()
    }
  }
}
