// SPDX-License-Identifier: GPL-3.0-or-later
import type { EngineRenderFrame, EngineRenderOptions } from '@supersolutions/super-chart-core'
import { nearestChartIndex } from '@supersolutions/super-chart-core'
import { CANVAS_FONT, FONT_SANS } from './tokens'

/** The colour each line series was painted with, per model, so the legend names it in the same colour. */
export const seriesColors = new WeakMap<object, Map<string, string>>()

export interface LegendPalette {
  readonly background: string
  readonly ink: string
  readonly muted: string
  readonly up: string
  readonly down: string
  readonly flat: string
  readonly font: string
}
interface Span { readonly text: string, readonly color: string, readonly font: string, readonly gapBefore?: number }

const ROW = 17
const PAD_X = 8
const PAD_Y = 6

/** 1 234 -> 1.23K, 5 600 000 -> 5.60M. Volume is read at a glance, not to the unit. */
export function compactNumber (value: number): string {
  const abs = Math.abs(value)
  const unit = (n: number, suffix: string): string => `${Number((value / n).toPrecision(3))}${suffix}`
  if (abs >= 1e12) return unit(1e12, 'T')
  if (abs >= 1e9) return unit(1e9, 'B')
  if (abs >= 1e6) return unit(1e6, 'M')
  if (abs >= 1e3) return unit(1e3, 'K')
  return String(Number(value.toPrecision(3)))
}

function valueAt (points: ReadonlyArray<{ readonly index: number, readonly value: number }>, index: number): number | null {
  let lo = 0, hi = points.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid].index < index) lo = mid + 1; else hi = mid }
  return points[lo]?.index === index ? points[lo].value : null
}

/**
 * The legend's rows for one bar: the title and open, high, low, close with the change from the bar before, then one row
 * per indicator on the price pane with its current values. `index` is a position in the frame's bars.
 */
export function legendRows (frame: EngineRenderFrame, index: number, options: EngineRenderOptions, p: LegendPalette, digits: number, availableWidth: number, measure: (font: string, text: string) => number, ids?: Array<string | null>): Span[][] {
  const bars = frame.snapshot.bars, bar = bars[index]
  if (bar === undefined) return []
  const label = `500 11px ${FONT_SANS}`, mono = p.font
  const dir = bar.close > bar.open ? p.up : bar.close < bar.open ? p.down : p.flat
  const price = (value: number): string => options.formatPrice?.(value, digits) ?? value.toFixed(digits)
  const rows: Span[][] = []
  const title: Span[] = options.legendTitle === undefined || options.legendTitle === '' ? [] : [{ text: options.legendTitle, color: p.ink, font: `600 12px ${FONT_SANS}` }]
  const head: Span[] = []
  const compact = availableWidth < 400
  const previous = index > 0 ? bars[index - 1].close : frame.previousClose
  const quote: Array<[string, string]> = compact ? [['C', price(bar.close)]] : [['O', price(bar.open)], ['H', price(bar.high)], ['L', price(bar.low)], ['C', price(bar.close)]]
  for (const [name, value] of quote) {
    head.push({ text: name, color: p.muted, font: label, gapBefore: head.length === 0 ? 0 : 8 }, { text: value, color: dir, font: mono, gapBefore: 2 })
  }
  if (previous !== undefined && Number.isFinite(previous) && previous !== 0) {
    const diff = bar.close - previous, sign = diff > 0 ? '+' : diff < 0 ? '−' : ''
    head.push({ text: `${sign}${price(Math.abs(diff))} (${sign}${Math.abs(diff / previous * 100).toFixed(2)}%)`, color: dir, font: mono, gapBefore: 8 })
  }
  const spanWidth = (spans: readonly Span[]): number => spans.reduce((sum, span) => sum + (span.gapBefore ?? 0) + measure(span.font, span.text), 0)
  if (title.length > 0 && spanWidth(title) + 12 + spanWidth(head) <= availableWidth) rows.push([...title, ...head.map((span, i) => i === 0 ? { ...span, gapBefore: 12 } : span)])
  else { if (title.length > 0) rows.push(title); rows.push(head) }
  // `ids`, when given, says for each row which indicator it belongs to (null for the quote rows), for the chart to find a row under the pointer.
  if (ids !== undefined) for (let i = 0; i < rows.length; i++) ids.push(null)

  const model = frame.model, colors = seriesColors.get(model)
  for (const entry of frame.legend ?? []) {
    const spans: Span[] = [{ text: entry.label, color: p.muted, font: label }]
    for (const id of entry.seriesIds) {
      const series = model.plottedSeries.find(item => item.source.id === id)
      if (series === undefined) continue
      const value = valueAt(series.points, index)
      const bar = series.source.type === 'bar'
      spans.push({
        text: value === null ? '—' : bar ? compactNumber(value) : price(value),
        color: bar ? dir : colors?.get(id) ?? p.ink,
        font: mono,
        gapBefore: 8
      })
    }
    if (spans.length > 1) { rows.push(spans); ids?.push(entry.id) }
  }
  return rows
}

/** The row an indicator pane carries: its title and the value of each of its lines for one bar, each in the colour of its line. */
export function indicatorLegendRows (frame: EngineRenderFrame, index: number, p: LegendPalette): Span[][] {
  const model = frame.model, colors = seriesColors.get(model), spans: Span[] = []
  if (frame.title !== undefined && frame.title !== '') spans.push({ text: frame.title, color: p.ink, font: `600 11px ${FONT_SANS}` })
  for (const series of model.plottedSeries) {
    const value = valueAt(series.points, index)
    const bar = series.source.type === 'bar'
    spans.push({
      text: value === null ? '—' : bar ? compactNumber(value) : String(Number(value.toPrecision(5))),
      color: bar ? p.ink : colors?.get(series.source.id) ?? p.ink,
      font: p.font,
      gapBefore: spans.length === 0 ? 0 : 8
    })
  }
  return spans.length === 0 ? [] : [spans]
}

/** The legend: translucent plates behind the text so candles never make it unreadable. */
export function paintLegend (ctx: CanvasRenderingContext2D, frame: EngineRenderFrame, x: number | null, options: EngineRenderOptions, p: LegendPalette, digits: number): void {
  const m = frame.model, g = m.geometry, bars = frame.snapshot.bars
  if (bars.length === 0 || options.legend === false) return
  let index = bars.length - 1
  if (x !== null && x >= g.left && x <= g.right && frame.inspectBar?.(x) != null) index = nearestChartIndex(m, x) ?? index
  const available = Math.max(0, g.plotWidth - PAD_X * 2)
  const measure = (font: string, text: string): number => { ctx.font = font; return ctx.measureText(text).width }
  const rows = frame.indicatorPane === true ? indicatorLegendRows(frame, index, p) : legendRows(frame, index, options, p, digits, available, measure)
  ctx.save()
  try {
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
    rows.forEach((spans, row) => {
      const y = g.top + PAD_Y + row * ROW + ROW / 2
      let cursor = g.left + PAD_X
      const limit = g.left + PAD_X + available
      const width = spans.reduce((sum, span) => sum + (span.gapBefore ?? 0) + measure(span.font, span.text), 0)
      ctx.globalAlpha = 0.72; ctx.fillStyle = p.background
      ctx.fillRect(g.left + PAD_X - 4, y - ROW / 2 + 1, Math.min(available + 8, width + 8), ROW - 2)
      ctx.globalAlpha = 1
      for (const span of spans) {
        cursor += span.gapBefore ?? 0
        const w = measure(span.font, span.text)
        if (cursor + w > limit) break
        ctx.font = span.font; ctx.fillStyle = span.color
        ctx.fillText(span.text, cursor, y)
        cursor += w
      }
    })
  } finally { ctx.restore() }
  ctx.font = CANVAS_FONT
}

/** Where one indicator's row sits in the legend, in pixels from the pane's top left: for putting buttons beside it. */
export interface LegendRowBox { readonly id: string, readonly left: number, readonly right: number, readonly top: number, readonly bottom: number }

/** The legend's indicator rows with their boxes, for the latest bar (the legend at rest). */
export function legendRowBoxes (ctx: CanvasRenderingContext2D, frame: EngineRenderFrame, options: EngineRenderOptions, p: LegendPalette, digits: number): LegendRowBox[] {
  const m = frame.model, g = m.geometry, bars = frame.snapshot.bars
  if (bars.length === 0 || options.legend === false || frame.indicatorPane === true) return []
  const available = Math.max(0, g.plotWidth - PAD_X * 2)
  const measure = (font: string, text: string): number => { ctx.font = font; return ctx.measureText(text).width }
  const ids: Array<string | null> = []
  const rows = legendRows(frame, bars.length - 1, options, p, digits, available, measure, ids)
  const boxes: LegendRowBox[] = []
  rows.forEach((spans, row) => {
    const id = ids[row]
    if (id === null || id === undefined) return
    const width = spans.reduce((sum, span) => sum + (span.gapBefore ?? 0) + measure(span.font, span.text), 0)
    const top = g.top + PAD_Y + row * ROW
    boxes.push({ id, left: g.left + PAD_X - 4, right: g.left + PAD_X + Math.min(available, width) + 4, top, bottom: top + ROW })
  })
  return boxes
}
