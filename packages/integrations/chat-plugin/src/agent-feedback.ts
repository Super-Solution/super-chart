// SPDX-License-Identifier: GPL-3.0-or-later
import { supportResistance } from '@supersolutions/super-chart-core'
import type { ChartAnnotation } from '@supersolutions/super-protocol'

/** What an agent needs to check its own marks against: how far the loaded data reaches in time and price. */
export interface DataSummary {
  readonly count: number
  readonly first: number | null
  readonly last: number | null
  readonly low: number | null
  readonly high: number | null
  readonly lastClose: number | null
}

export interface MarkWarning { readonly key: string, readonly code: 'time_in_seconds', readonly message: string }
export interface MarkPlacement { readonly key: string, readonly status: 'offscreen' | 'unprojectable' | 'no-data', readonly why: string }

interface BarLike { readonly timestamp: number, readonly high: number, readonly low: number, readonly close: number }

/** Time range of the loaded bars, and the price range and last close of the bars given (the agent reads the recent ones). */
export function summarizeData (count: number, first: number | null, last: number | null, bars: readonly BarLike[]): DataSummary {
  let low = Infinity, high = -Infinity
  for (const bar of bars) { if (bar.low < low) low = bar.low; if (bar.high > high) high = bar.high }
  return Object.freeze({ count, first, last, low: bars.length === 0 ? null : low, high: bars.length === 0 ? null : high, lastClose: bars.length === 0 ? null : bars[bars.length - 1].close })
}

/** Below this a timestamp in milliseconds would be before 1973, so a model that wrote seconds is the likelier cause. */
const SECONDS_BELOW = 1e11

/**
 * Agents often write Unix seconds where the tool asks for milliseconds. When every time in a mark is a plausible number of
 * seconds and none could be a plausible number of milliseconds, the mark's times are multiplied by 1000 and the agent is told.
 * Marks that already look right are returned as they are.
 */
export function correctTimeUnits (annotations: readonly ChartAnnotation[]): { annotations: ChartAnnotation[], warnings: MarkWarning[] } {
  const warnings: MarkWarning[] = []
  const fixed = annotations.map(mark => {
    const times = mark.anchors.map(anchor => anchor.time)
    if (times.length === 0 || !times.every(time => Number.isFinite(time) && time > 1e8 && time < SECONDS_BELOW)) return mark
    warnings.push({ key: mark.key, code: 'time_in_seconds', message: `Anchor times for "${mark.key}" looked like Unix seconds, so they were multiplied by 1000. Send milliseconds since the epoch.` })
    return { ...mark, anchors: mark.anchors.map(anchor => ({ ...anchor, time: anchor.time * 1000 })) } as ChartAnnotation
  })
  return { annotations: fixed, warnings }
}

const iso = (time: number): string => new Date(time).toISOString().slice(0, 16).replace('T', ' ')

/** Why a mark the engine accepted is not on screen, in words an agent can act on; null when it is shown or nothing useful can be said. */
export function whyNotShown (mark: Pick<ChartAnnotation, 'anchors'>, status: string, data: DataSummary): string | null {
  if (status === 'visible') return null
  if (status === 'no-data') return 'The chart has no bars loaded yet.'
  if (status === 'unprojectable') return 'The anchors could not be placed on the chart. Check that time is in milliseconds and price is a number.'
  const times = mark.anchors.map(anchor => anchor.time)
  const prices = mark.anchors.map(anchor => anchor.price).filter((price): price is number => typeof price === 'number')
  if (data.first !== null && data.last !== null) {
    if (Math.max(...times) < data.first) return `Every anchor is before the first loaded bar (${iso(data.first)}). Only loaded bars can be marked.`
    if (Math.min(...times) > data.last) return `Every anchor is after the last bar (${iso(data.last)}).`
  }
  if (data.low !== null && data.high !== null && prices.length > 0) {
    if (Math.min(...prices) > data.high) return `The price ${Math.min(...prices)} is above the recent range ${data.low} to ${data.high}.`
    if (Math.max(...prices) < data.low) return `The price ${Math.max(...prices)} is below the recent range ${data.low} to ${data.high}.`
  }
  return 'The mark is outside the part of the chart on screen; it is kept and shows when the view reaches it.'
}

export interface PriceLevel { readonly price: number, readonly touches: number, readonly lastTime: number }

/**
 * Support and resistance read from the bars given (the agent reads the recent ones), nearest the last close first. An agent
 * that draws a line at one of these prices draws it where price turned, not where a guess landed.
 */
export function levelsOf (bars: readonly (BarLike & { readonly timestamp: number })[], strength = 5): { support: PriceLevel[], resistance: PriceLevel[], lastClose: number | null } {
  if (bars.length === 0) return { support: [], resistance: [], lastClose: null }
  const found = supportResistance(bars, { strength, lookback: bars.length })
  const shape = (level: { price: number, touches: number, lastIndex: number }): PriceLevel =>
    ({ price: Number(level.price.toPrecision(8)), touches: level.touches, lastTime: bars[level.lastIndex].timestamp })
  return { support: found.support.slice(0, 5).map(shape), resistance: found.resistance.slice(0, 5).map(shape), lastClose: bars[bars.length - 1].close }
}
