// SPDX-License-Identifier: GPL-3.0-or-later
// Event marks from a datafeed: validation with stable codes, and the placement of each mark on a bar. DOM-free, so a
// server, a test or an agent can run the same checks the chart does.

import type { DatafeedMark, MarkTone } from './feed'

export const MARK_LIMITS = Object.freeze({ perBar: 10, perAnswer: 1000, idLength: 128, labelLength: 24, textLength: 1024, categoryLength: 32, colorLength: 128 })

/**
 * Why a mark was left out. Stable: assert on these.
 * `bad_response` the answer was not an array (it is reported once, with an empty id). `bad_mark` not an object.
 * `bad_id`, `bad_time`, `bad_label`, `bad_text`, `bad_tone`, `bad_color`, `bad_category` the field is missing or malformed.
 * `duplicate_id` the id was already used (the first one stays). `out_of_range` the time is outside the asked range.
 * `too_many` past 1000 marks in one answer. `no_bar` no loaded bar contains the time. `too_many_on_bar` an eleventh mark on one bar.
 */
export type MarkRejectCode = 'bad_response' | 'bad_mark' | 'bad_id' | 'bad_time' | 'bad_label' | 'bad_text' | 'bad_tone' | 'bad_color' | 'bad_category' | 'duplicate_id' | 'out_of_range' | 'too_many' | 'no_bar' | 'too_many_on_bar'
export interface MarkRejection { readonly id: string, readonly code: MarkRejectCode }

const TONES: readonly string[] = ['bull', 'bear', 'neutral', 'accent']
const hasControl = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) { const code = text.charCodeAt(i); if (code < 32 || code === 127) return true }
  return false
}
const plain = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !hasControl(value)

/**
 * Checks what a datafeed returned. Valid marks come back frozen and in the order given; every other mark is listed in
 * `rejected` with its code, so one bad entry never hides the rest. `range` is the `[from, to)` that was asked.
 */
export function validateMarks (raw: unknown, range: { from: number, to: number }): { marks: readonly DatafeedMark[], rejected: readonly MarkRejection[] } {
  const marks: DatafeedMark[] = [], rejected: MarkRejection[] = []
  if (!Array.isArray(raw)) return { marks: Object.freeze(marks), rejected: Object.freeze([Object.freeze({ id: '', code: 'bad_response' as const })]) }
  const seen = new Set<string>()
  for (const item of raw as unknown[]) {
    const reject = (id: string, code: MarkRejectCode): void => { rejected.push(Object.freeze({ id, code })) }
    if (item === null || typeof item !== 'object' || Array.isArray(item)) { reject('', 'bad_mark'); continue }
    const mark = item as Record<string, unknown>
    const id = typeof mark.id === 'string' ? mark.id : ''
    if (typeof mark.id !== 'string' || mark.id.length === 0 || mark.id.length > MARK_LIMITS.idLength || mark.id.trim() === '') { reject(id.slice(0, MARK_LIMITS.idLength), 'bad_id'); continue }
    if (seen.has(id)) { reject(id, 'duplicate_id'); continue }
    if (typeof mark.time !== 'number' || !Number.isFinite(mark.time) || Math.abs(mark.time) > 8.64e15) { reject(id, 'bad_time'); continue }
    if (!plain(mark.label, MARK_LIMITS.labelLength) || mark.label.trim() === '') { reject(id, 'bad_label'); continue }
    if (mark.text !== undefined && !plain(mark.text, MARK_LIMITS.textLength)) { reject(id, 'bad_text'); continue }
    if (mark.tone !== undefined && !TONES.includes(mark.tone as string)) { reject(id, 'bad_tone'); continue }
    if (mark.color !== undefined && (!plain(mark.color, MARK_LIMITS.colorLength) || mark.color.trim() === '')) { reject(id, 'bad_color'); continue }
    if (mark.category !== undefined && (!plain(mark.category, MARK_LIMITS.categoryLength) || mark.category.trim() === '')) { reject(id, 'bad_category'); continue }
    seen.add(id)
    if (mark.time < range.from || mark.time >= range.to) { reject(id, 'out_of_range'); continue }
    if (marks.length >= MARK_LIMITS.perAnswer) { reject(id, 'too_many'); continue }
    marks.push(Object.freeze({
      id,
      time: mark.time,
      label: mark.label,
      ...(mark.text !== undefined ? { text: mark.text } : {}),
      ...(mark.tone !== undefined ? { tone: mark.tone as MarkTone } : {}),
      ...(mark.color !== undefined ? { color: mark.color } : {}),
      ...(mark.category !== undefined ? { category: mark.category } : {})
    }))
  }
  return { marks: Object.freeze(marks), rejected: Object.freeze(rejected) }
}

/** The marks that share one bar. */
export interface MarkGroup {
  /** Index into the bars the marks were placed on. */
  readonly index: number
  /** That bar's open time: where the marker is drawn. */
  readonly time: number
  readonly marks: readonly DatafeedMark[]
}

/**
 * Puts each mark on the bar that contains its time: the one with the latest open time at or before it. The newest bar
 * contains the time up to one bar-length (the gap to the bar before it) past its open; a mark before the first bar or
 * after that is `no_bar`. At most 10 marks stay on a bar (the first ten in the order given); the rest are
 * `too_many_on_bar`. Groups come back in bar order. `times` is the bars' open times, ascending.
 */
export function placeMarks (marks: readonly DatafeedMark[], times: ArrayLike<number>): { groups: readonly MarkGroup[], rejected: readonly MarkRejection[] } {
  const n = times.length, rejected: MarkRejection[] = [], byBar = new Map<number, DatafeedMark[]>()
  const step = n >= 2 ? times[n - 1] - times[n - 2] : Infinity
  for (const mark of marks) {
    let low = 0, high = n - 1, found = -1
    while (low <= high) {
      const middle = (low + high) >> 1
      if (times[middle] <= mark.time) { found = middle; low = middle + 1 } else high = middle - 1
    }
    if (found < 0 || (found === n - 1 && mark.time >= times[found] + step)) { rejected.push(Object.freeze({ id: mark.id, code: 'no_bar' as const })); continue }
    const list = byBar.get(found)
    if (list === undefined) byBar.set(found, [mark])
    else if (list.length >= MARK_LIMITS.perBar) rejected.push(Object.freeze({ id: mark.id, code: 'too_many_on_bar' as const }))
    else list.push(mark)
  }
  const groups = [...byBar.entries()].sort((a, b) => a[0] - b[0]).map(([index, list]) => Object.freeze({ index, time: times[index], marks: Object.freeze(list) }))
  return { groups: Object.freeze(groups), rejected: Object.freeze(rejected) }
}

/**
 * The `[from, to)` to ask a datafeed for when the view shows `[viewFrom, viewTo)`: the view and one view-width either
 * side, so a small pan stays inside what was fetched. Null when the view is empty or not finite.
 */
export function marksWindow (viewFrom: number, viewTo: number): { from: number, to: number } | null {
  if (!Number.isFinite(viewFrom) || !Number.isFinite(viewTo) || viewTo <= viewFrom) return null
  const span = viewTo - viewFrom
  return { from: Math.floor(viewFrom - span), to: Math.ceil(viewTo + span) }
}
