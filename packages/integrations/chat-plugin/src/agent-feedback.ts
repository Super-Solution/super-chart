// SPDX-License-Identifier: GPL-3.0-or-later
import { supportResistance, swingPivots } from '@supersolutions/super-chart-core'
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

export interface MarkWarning { readonly key: string, readonly code: 'time_in_seconds' | 'invalid_plan' | 'flat_range' | 'near_duplicate' | 'plan_no_width', readonly message: string }
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

/** The validator's complaint with a hint added when the likely cause is a date string or seconds where milliseconds belong. */
export function explainProblem (problem: string, annotations: unknown): string {
  if (!/finite time/.test(problem) || !Array.isArray(annotations)) return problem
  const strings = annotations.some(item => Array.isArray((item as { anchors?: unknown })?.anchors) && ((item as { anchors: Array<{ time?: unknown }> }).anchors).some(anchor => typeof anchor?.time === 'string'))
  return strings ? `${problem} Send time as a number, milliseconds since the epoch (for example 1795800000000), not a date string; chart_state gives the first and last bar time to copy.` : problem
}
const num = (value: number): number => Number(value.toPrecision(7))
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
    if (Math.min(...prices) > data.high) return `The price ${num(Math.min(...prices))} is above the recent range ${num(data.low)} to ${num(data.high)}.`
    if (Math.max(...prices) < data.low) return `The price ${num(Math.max(...prices))} is below the recent range ${num(data.low)} to ${num(data.high)}.`
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

export interface Swing { readonly kind: 'high' | 'low', readonly time: number, readonly price: number }

/**
 * The latest swing highs and lows, oldest first, alternating, with the last leg (the move from the previous swing to the
 * latest one) called out: the anchors a trend line or a retracement needs. Times are the bars' own, so a mark placed on
 * them lands on a real bar.
 */
export function swingsOf (bars: readonly (BarLike & { readonly timestamp: number })[], strength = 5, count = 8): { swings: Swing[], lastLeg: { from: Swing, to: Swing, direction: 'up' | 'down' } | null } {
  if (bars.length === 0) return { swings: [], lastLeg: null }
  const pivots = swingPivots(bars, { strength, lookback: bars.length })
  const swings = pivots.slice(-count).map(pivot => ({ kind: pivot.kind, time: bars[pivot.index].timestamp, price: Number(pivot.price.toPrecision(8)) }))
  const to = swings[swings.length - 1], from = swings[swings.length - 2]
  return { swings, lastLeg: to !== undefined && from !== undefined ? { from, to, direction: to.price >= from.price ? 'up' : 'down' } : null }
}

/**
 * Shapes the engine accepts but draws as a note or as nothing: a trade plan whose stop is on the wrong side, a zone or a
 * retracement whose two prices are the same. The agent is told in words, so it corrects the mark instead of reporting it drawn.
 */
export function checkMarkShapes (annotations: readonly ChartAnnotation[]): MarkWarning[] {
  const warnings: MarkWarning[] = []
  for (const mark of annotations) {
    const prices = mark.anchors.map(anchor => anchor.price)
    if (mark.kind === 'plan' && prices.length >= 3 && prices.every(price => typeof price === 'number')) {
      const [entry, target, stop] = prices as number[]
      const valid = target !== entry && (target > entry ? stop < entry : stop > entry)
      const times = mark.anchors.slice(0, 2).map(anchor => anchor.time)
      if (valid && times.length === 2 && times[0] === times[1]) warnings.push({ key: mark.key, code: 'plan_no_width', message: `Plan "${mark.key}" has the same time at entry and target, so it has no width and is drawn as a note. Put the target's time after the entry's: the plan spans from one to the other.` })
      if (!valid) warnings.push({ key: mark.key, code: 'invalid_plan', message: `Plan "${mark.key}" is drawn as a note, not a plan: anchors are entry, target, stop in that order, and the stop must be on the other side of the entry from the target (entry ${entry}, target ${target}, stop ${stop}).` })
    } else if ((mark.kind === 'zone' || mark.kind === 'fibonacci') && prices.length >= 2 && typeof prices[0] === 'number' && prices[0] === prices[1]) {
      warnings.push({ key: mark.key, code: 'flat_range', message: `"${mark.key}" has the same price at both anchors (${prices[0]}), so it has no height. Give the two ends different prices.` })
    }
  }
  // Two level lines within 0.1% of each other draw on top of one another and their labels collide.
  const levels = annotations.flatMap(mark => mark.kind === 'level' && typeof mark.anchors[0]?.price === 'number' ? [{ key: mark.key, price: mark.anchors[0].price }] : []).sort((a, b) => a.price - b.price)
  for (let i = 1; i < levels.length; i++) {
    const a = levels[i - 1], b = levels[i]
    if (Math.abs(b.price - a.price) <= Math.max(Math.abs(a.price), Math.abs(b.price)) * 0.001) warnings.push({ key: b.key, code: 'near_duplicate', message: `"${b.key}" (${b.price}) is on top of "${a.key}" (${a.price}): one line, one label. Drop one or merge their labels.` })
  }
  return warnings
}
