// SPDX-License-Identifier: GPL-3.0-or-later
import { CHART_LIMITS as PROTOCOL_LIMITS, validateChartCardSpec as validateProtocolCard, type CardValidationResult, type ChartAnnotation as ProtocolAnnotation, type ChartCardSpec as ProtocolCard } from '@supersolutions/super-protocol'

/**
 * The parts of `@supersolutions/super-protocol` 0.3.0 this plugin uses while the package still pins 0.2.0 from npm: card
 * references (`ref.ts`) and the `trend`, `ray`, `fibonacci` and `plan` annotation kinds. The behaviour and the messages
 * match the protocol exactly (its conformance data pins them). Once 0.3.0 is published, import these from the protocol and
 * delete this file.
 */

// ---- card references -------------------------------------------------------------------------------------------

export interface CardRef { target: string, params: Record<string, string[]> }
export type CardRefEvent = 'enter' | 'leave' | 'activate'
export type CardRefResult = { ok: true, label?: string } | { ok: false, code: string, reason: string }

const REF_TARGET = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const REF_NAME = /^[a-z][A-Za-z0-9_-]{0,31}$/
const REF_LIMITS = { length: 512, names: 16, values: 32, value: 256 }
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

function encodeValue (value: string): string {
  let out = ''
  for (const byte of new TextEncoder().encode(value)) {
    const c = String.fromCharCode(byte)
    out += byte < 128 && /[A-Za-z0-9._~-]/.test(c) ? c : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

/** Writes a reference as a `ref:` link, names in alphabetical order, or null when it breaks a limit. */
export function formatCardRef (ref: CardRef): string | null {
  if (!REF_TARGET.test(ref.target)) return null
  const names = Object.keys(ref.params).sort()
  if (names.length > REF_LIMITS.names) return null
  const parts: string[] = []
  for (const name of names) {
    const values = ref.params[name]
    if (!REF_NAME.test(name) || !Array.isArray(values) || values.length === 0 || values.length > REF_LIMITS.values) return null
    for (const value of values) {
      if (typeof value !== 'string' || value === '' || value.length > REF_LIMITS.value) return null
      parts.push(`${name}=${encodeValue(value)}`)
    }
  }
  const href = `ref:${ref.target}${parts.length > 0 ? `?${parts.join('&')}` : ''}`
  return href.length > REF_LIMITS.length ? null : href
}

export interface ChartRef { chartId: string, key?: string, from?: number, to?: number, low?: number, high?: number }
export type ChartRefParse = { ok: true, chart: ChartRef } | { ok: false, error: string }
type RangeName = Exclude<keyof ChartRef, 'chartId' | 'key'>
const DECIMAL = /^-?[0-9]+(?:\.[0-9]+)?$/

/** The chart vocabulary: no params, `key`, or `from` and `to` with optional `low` and `high`. */
export function parseChartRef (ref: CardRef): ChartRefParse {
  const fail = (error: string): ChartRefParse => ({ ok: false, error })
  const values: Partial<Record<RangeName, number>> = {}
  let key: string | undefined
  for (const name of Object.keys({ key: 0, from: 0, to: 0, low: 0, high: 0 }) as Array<'key' | RangeName>) {
    if (!hasOwn(ref.params, name)) continue
    const list = ref.params[name]
    if (list.length !== 1) return fail(`a chart ref takes one ${name}.`)
    if (name === 'key') { key = list[0]; continue }
    const n = DECIMAL.test(list[0]) ? Number(list[0]) : NaN
    if (!Number.isFinite(n)) return fail(`a chart ref ${name} must be a plain decimal number.`)
    values[name] = n === 0 ? 0 : n
  }
  const chart: ChartRef = { chartId: ref.target }
  const { from, to, low, high } = values
  if (key !== undefined) {
    if (from !== undefined || to !== undefined || low !== undefined || high !== undefined) return fail('a chart ref uses key or a time range, not both.')
    if (key.length > 128) return fail('a chart ref key is at most 128 characters.')
    chart.key = key
    return { ok: true, chart }
  }
  if ((from === undefined) !== (to === undefined)) return fail('a chart ref time range needs both from and to.')
  if (from !== undefined && to !== undefined) {
    if (from > to) return fail('a chart ref from must not be after to.')
    chart.from = from; chart.to = to
  }
  if ((low === undefined) !== (high === undefined)) return fail('a chart ref price band needs both low and high.')
  if (low !== undefined && high !== undefined) {
    if (from === undefined) return fail('a chart ref price band needs a time range.')
    if (low > high) return fail('a chart ref low must not be above high.')
    chart.low = low; chart.high = high
  }
  return { ok: true, chart }
}

// ---- annotation kinds ------------------------------------------------------------------------------------------

export type ChartAnnotationKind = 'level' | 'zone' | 'marker' | 'trend' | 'ray' | 'fibonacci' | 'plan'
export const CHART_ANNOTATION_ANCHORS: Readonly<Record<ChartAnnotationKind, number>> = Object.freeze({ level: 1, zone: 2, marker: 1, trend: 2, ray: 2, fibonacci: 2, plan: 3 })
const KINDS = Object.keys(CHART_ANNOTATION_ANCHORS) as ChartAnnotationKind[]
const ANNOTATION_LIMITS = { anchors: 3, params: 16, paramString: 128 }

export type ChartAnnotation = Omit<ProtocolAnnotation, 'kind'> & { kind: ChartAnnotationKind, params?: Record<string, number | string | boolean> }
export type ChartCardSpec = Omit<ProtocolCard, 'annotations'> & { annotations?: ChartAnnotation[] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function validateAnnotation (v: unknown): string | null {
  if (!isObject(v)) return 'an annotation must be an object.'
  if (typeof v.key !== 'string' || v.key.trim() === '' || v.key.length > PROTOCOL_LIMITS.keyLength) return `annotation.key must be a non-empty string of at most ${PROTOCOL_LIMITS.keyLength} characters.`
  if (!KINDS.includes(v.kind as ChartAnnotationKind)) return 'annotation.kind must be "level", "zone", "marker", "trend", "ray", "fibonacci" or "plan".'
  if (!Array.isArray(v.anchors) || v.anchors.length === 0 || v.anchors.length > ANNOTATION_LIMITS.anchors) return 'annotation.anchors must hold one to three anchors.'
  for (const a of v.anchors) {
    if (!isObject(a) || !finite(a.time)) return 'annotation anchors need a finite time.'
    if (a.price !== undefined && !finite(a.price)) return 'annotation anchor price must be a finite number.'
  }
  const anchors = v.anchors as Array<{ price?: number }>
  const kind = v.kind as ChartAnnotationKind
  const needed = CHART_ANNOTATION_ANCHORS[kind]
  if (kind === 'level' && (anchors.length !== 1 || anchors[0]?.price === undefined)) return 'a level needs exactly one anchor with a price.'
  else if (kind === 'zone' && (anchors.length !== 2 || anchors.some(a => a.price === undefined))) return 'a zone needs two anchors, both with a price.'
  else if (kind === 'marker' && anchors.length !== 1) return 'a marker needs exactly one anchor.'
  else if (kind !== 'level' && kind !== 'zone' && kind !== 'marker' && (anchors.length !== needed || anchors.some(a => a.price === undefined))) return `a ${kind} needs ${needed} anchors, all with a price.`
  if (v.params !== undefined) {
    if (kind === 'level' || kind === 'zone' || kind === 'marker') return 'annotation.params applies only to trend, ray, fibonacci and plan.'
    if (!isObject(v.params)) return 'annotation.params must be an object.'
    const entries = Object.entries(v.params)
    if (entries.length > ANNOTATION_LIMITS.params) return `annotation.params may hold at most ${ANNOTATION_LIMITS.params} entries.`
    for (const [name, value] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name)) return 'annotation.params keys must be 1 to 32 letters, digits, dash or underscore, starting with a letter.'
      if (typeof value === 'number' ? !Number.isFinite(value) : typeof value === 'string' ? value.length > ANNOTATION_LIMITS.paramString : typeof value !== 'boolean') return `annotation.params.${name} must be a finite number, a boolean or a string of at most ${ANNOTATION_LIMITS.paramString} characters.`
    }
  }
  if (v.text !== undefined && (typeof v.text !== 'string' || v.text.length > PROTOCOL_LIMITS.textLength)) return `annotation.text must be a string of at most ${PROTOCOL_LIMITS.textLength} characters.`
  if (v.tone !== undefined && !['bull', 'bear', 'neutral', 'accent'].includes(v.tone as string)) return 'annotation.tone must be bull, bear, neutral or accent.'
  if (v.color !== undefined && (typeof v.color !== 'string' || v.color.length > 128)) return 'annotation.color must be a short CSS color string.'
  return null
}

export function validateChartAnnotations (v: unknown): string | null {
  if (!Array.isArray(v)) return 'annotations must be an array.'
  if (v.length > PROTOCOL_LIMITS.annotations) return `at most ${PROTOCOL_LIMITS.annotations} annotations per chart.`
  const keys = new Set<string>()
  for (const item of v) {
    const problem = validateAnnotation(item)
    if (problem !== null) return problem
    const key = (item as ChartAnnotation).key
    if (keys.has(key)) return `duplicate annotation key "${key}".`
    keys.add(key)
  }
  return null
}

/** A chart card spec: everything the protocol checks, with annotations checked against the kinds above. */
export function validateChartCard (spec: unknown): CardValidationResult {
  if (!isObject(spec) || spec.annotations === undefined) return validateProtocolCard(spec)
  const { annotations, ...rest } = spec
  const result = validateProtocolCard(rest)
  if (!result.ok) return result
  const problem = validateChartAnnotations(annotations)
  return problem === null ? result : { ok: false, error: problem }
}

/** The card kind with the annotation schema widened to the kinds above. */
export function widenChartCardKind<T extends { schema: Record<string, unknown>, validate: (spec: unknown) => CardValidationResult, summary: string }> (kind: T): T {
  const schema = JSON.parse(JSON.stringify(kind.schema)) as { properties?: { annotations?: { items?: { properties?: Record<string, unknown> } } } }
  const properties = schema.properties?.annotations?.items?.properties
  if (properties !== undefined) {
    properties.kind = { enum: [...KINDS], description: 'level: 1 anchor with price. zone: 2 anchors with price. marker: 1 anchor. trend and ray: 2 anchors with price. fibonacci: 2 anchors with price. plan: 3 anchors with price (entry, target, stop).' }
    properties.anchors = { type: 'array', maxItems: ANNOTATION_LIMITS.anchors }
    properties.params = { type: 'object', description: 'Options for trend, ray, fibonacci and plan, for example { extend: "right" } or { levels: "0,0.5,1" }.' }
  }
  return { ...kind, schema: schema as Record<string, unknown>, validate: validateChartCard, summary: kind.summary.replace('(levels, zones, markers)', '(levels, zones, markers, trend lines, rays, fibonacci retracements, trade plans)') }
}
