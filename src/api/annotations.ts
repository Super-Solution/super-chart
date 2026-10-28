/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Declarative annotation layers (SC-128): a host or an AI/MCP caller
// describes what should be on the chart by a stable key, and this module
// diffs it against what is already there instead of the remove-everything/
// recreate-everything pattern SupWallet's MainChart/StudioChart use today.
//
// An annotation is NEVER a user (rail-editable) drawing: it is created
// through the same `addHostOverlay` helper a host's own SL/TP lines use
// (src/drawing-editor/controller.ts, owned by an earlier batch — this module
// only calls its already-exported function), so it is immovable by default,
// survives a stray right-click, and is invisible to the drawing editor's
// undo stack, the rail's remove/lock/hide-all and getDrawings()/listDrawings().
//
// Part of SUPer-Chart (Apache-2.0).

import { addHostOverlay, type HostOverlayOptions } from '../drawing-editor/controller'
import { CANVAS_PALETTE } from '../theme/tokens'
import type { Period, Theme } from '../types'
import { timeToPoint, type TimelineBar } from './anchors'

export type AnnotationTone = 'bull' | 'bear' | 'neutral' | 'accent'
export type AnnotationKind = 'level' | 'zone' | 'marker'

export interface AnnotationAnchor {
  time: number
  price?: number
}

export interface AnnotationSpec {
  /** Stable within its layer: the same key upserts instead of creating a duplicate. */
  key: string
  kind: AnnotationKind
  /** 'level'/'marker': one anchor. 'zone': two (opposite corners). */
  anchors: AnnotationAnchor[]
  text?: string
  tone?: AnnotationTone
  /** Overrides `tone`'s resolved colour. */
  color?: string
}

export type AnnotationRejectCode = 'bad_anchor' | 'out_of_range' | 'unknown_kind' | 'duplicate_key' | 'engine_rejected'

export interface AnnotationRejection {
  key: string
  code: AnnotationRejectCode
}

export interface SetAnnotationsResult {
  applied: string[]
  rejected: AnnotationRejection[]
}

const KINDS: readonly AnnotationKind[] = ['level', 'zone', 'marker']
const OVERLAY_NAME: Readonly<Record<AnnotationKind, string>> = {
  level: 'priceLine',
  zone: 'rect',
  marker: 'simpleAnnotation'
}
const ANCHORS_REQUIRED: Readonly<Record<AnnotationKind, number>> = { level: 1, zone: 2, marker: 1 }

function idFor (layer: string, key: string): string {
  return `sc:ann:${layer}:${key}`
}

function groupIdFor (layer: string): string {
  return `sc:ann:${layer}`
}

/** Resolves a tone (or an explicit colour override) against the same palette canvasTheme() paints with. */
export function resolveTone (theme: Theme, tone: AnnotationTone | undefined, color: string | undefined): string {
  if (typeof color === 'string' && color.length > 0) {
    return color
  }
  const palette = CANVAS_PALETTE[theme] ?? CANVAS_PALETTE.light
  switch (tone) {
    case 'bull': return palette.up
    case 'bear': return palette.down
    case 'accent': return palette.accent
    case 'neutral':
    default:
      return palette.textSecond
  }
}

export interface AnnotationsRawChart {
  createOverlay: (create: unknown) => unknown
  overrideOverlay: (create: Record<string, unknown>) => boolean
  removeOverlay: (query: { id?: string, groupId?: string }) => boolean
  getOverlayById: (id: string) => { id: string, name: string } | null
  getDataList: () => readonly TimelineBar[]
}

export interface AnnotationsApiDeps {
  getChart: () => AnnotationsRawChart | null
  getTheme: () => Theme
  getPeriod: () => Period
}

interface TrackedEntry {
  id: string
  kind: AnnotationKind
  fingerprint: string
  spec: AnnotationSpec
}

function fingerprintOf (spec: AnnotationSpec, color: string): string {
  return JSON.stringify({ anchors: spec.anchors, text: spec.text ?? null, color })
}

function validate (spec: AnnotationSpec): AnnotationRejectCode | null {
  if (!KINDS.includes(spec.kind)) {
    return 'unknown_kind'
  }
  const need = ANCHORS_REQUIRED[spec.kind]
  if (!Array.isArray(spec.anchors) || spec.anchors.length < need) {
    return 'bad_anchor'
  }
  for (const a of spec.anchors.slice(0, need)) {
    if (typeof a.time !== 'number' || !Number.isFinite(a.time)) {
      return 'bad_anchor'
    }
    if (spec.kind !== 'level' && spec.kind !== 'marker' && spec.kind !== 'zone') {
      continue
    }
    if (a.price !== undefined && (typeof a.price !== 'number' || !Number.isFinite(a.price))) {
      return 'out_of_range'
    }
  }
  if (spec.kind === 'level' || spec.kind === 'marker') {
    if (typeof spec.anchors[0]?.price !== 'number') {
      return 'bad_anchor'
    }
  }
  if (spec.kind === 'zone') {
    const [a, b] = spec.anchors
    if (typeof a?.price !== 'number' || typeof b?.price !== 'number') {
      return 'bad_anchor'
    }
    if (a.time === b.time && a.price === b.price) {
      return 'out_of_range'
    }
  }
  return null
}

function toOverlayPoints (spec: AnnotationSpec, dataList: readonly TimelineBar[], period: Period): Array<Record<string, unknown>> {
  const need = ANCHORS_REQUIRED[spec.kind]
  return spec.anchors.slice(0, need).map(a => ({
    ...timeToPoint(a.time, dataList, period),
    ...(typeof a.price === 'number' ? { value: a.price } : {})
  }))
}

/**
 * Creates the layered annotation store for one chart instance. Each layer
 * (a plain string namespace: 'host', 'ai', a host's own name) keeps its own
 * key -> overlay map, diffed on every setAnnotations() call: an unchanged
 * spec makes no klinecharts call at all (so canvasTheme()'s theme colours are
 * the only thing that ever repaints them idle), a changed one calls
 * overrideOverlay, and a kind change removes and recreates under the same id.
 */
export function createAnnotationsApi (deps: AnnotationsApiDeps) {
  const layers = new Map<string, Map<string, TrackedEntry>>()

  const layerOf = (layer: string): Map<string, TrackedEntry> => {
    let m = layers.get(layer)
    if (m === undefined) {
      m = new Map()
      layers.set(layer, m)
    }
    return m
  }

  const setAnnotations = (layer: string, specs: readonly AnnotationSpec[], opts?: { symbol?: string, period?: Period }): SetAnnotationsResult => {
    const chart = deps.getChart()
    const result: SetAnnotationsResult = { applied: [], rejected: [] }
    if (chart === null) {
      return result
    }
    const tracked = layerOf(layer)
    const dataList = chart.getDataList()
    const period = opts?.period ?? deps.getPeriod()
    const theme = deps.getTheme()
    const seenKeys = new Set<string>()
    const nextByKey = new Map<string, AnnotationSpec>()

    for (const spec of specs) {
      if (seenKeys.has(spec.key)) {
        result.rejected.push({ key: spec.key, code: 'duplicate_key' })
        continue
      }
      seenKeys.add(spec.key)
      const problem = validate(spec)
      if (problem !== null) {
        result.rejected.push({ key: spec.key, code: problem })
        continue
      }
      nextByKey.set(spec.key, spec)
    }

    // Remove entries whose key is no longer present.
    for (const [key, entry] of [...tracked]) {
      if (!nextByKey.has(key)) {
        chart.removeOverlay({ id: entry.id })
        tracked.delete(key)
      }
    }

    for (const [key, spec] of nextByKey) {
      const color = resolveTone(theme, spec.tone, spec.color)
      const fingerprint = fingerprintOf(spec, color)
      const existing = tracked.get(key)
      const id = idFor(layer, key)
      if (existing !== undefined && existing.kind === spec.kind && existing.fingerprint === fingerprint) {
        result.applied.push(id)
        continue
      }
      if (existing !== undefined && existing.kind !== spec.kind) {
        chart.removeOverlay({ id: existing.id })
        tracked.delete(key)
      }
      const points = toOverlayPoints(spec, dataList, period)
      const patch: Record<string, unknown> = {
        points,
        styles: styleFor(spec.kind, color),
        extendData: spec.text ?? ''
      }
      if (existing !== undefined && existing.kind === spec.kind) {
        const ok = chart.overrideOverlay({ id: existing.id, ...patch })
        if (!ok) {
          result.rejected.push({ key, code: 'engine_rejected' })
          continue
        }
        tracked.set(key, { id: existing.id, kind: spec.kind, fingerprint, spec })
        result.applied.push(existing.id)
        continue
      }
      const created = addHostOverlay(chart as unknown as Parameters<typeof addHostOverlay>[0], {
        id,
        name: OVERLAY_NAME[spec.kind],
        groupId: groupIdFor(layer),
        ...patch
      } satisfies Parameters<typeof addHostOverlay>[1], { draggable: false } satisfies HostOverlayOptions)
      if (created === null) {
        result.rejected.push({ key, code: 'engine_rejected' })
        continue
      }
      tracked.set(key, { id: created, kind: spec.kind, fingerprint, spec })
      result.applied.push(created)
    }

    return result
  }

  const getAnnotations = (layer?: string): AnnotationSpec[] => {
    if (layer === undefined) {
      return [...layers.values()].flatMap(m => [...m.values()].map(e => e.spec))
    }
    return [...(layers.get(layer)?.values() ?? [])].map(e => e.spec)
  }

  const clearAnnotations = (layer: string): void => {
    const chart = deps.getChart()
    const tracked = layers.get(layer)
    if (chart === null || tracked === undefined) {
      layers.delete(layer)
      return
    }
    chart.removeOverlay({ groupId: groupIdFor(layer) })
    layers.delete(layer)
  }

  return { setAnnotations, getAnnotations, clearAnnotations }
}

/**
 * klinecharts' own nested style shape (line/polygon/text — see
 * src/drawing-editor/fakeChart.ts's DEFAULT_STYLE for the exact keys). 'zone'
 * and 'marker' are a best-effort mapping onto that schema: unknown nested
 * keys klinecharts ignores rather than rejects, so a mismatch here is
 * cosmetic, never a runtime error. The 'level' shape (a labelled priceLine)
 * is exercised by the annotations tests; 'zone'/'marker' colouring is not
 * pixel-verified in this batch.
 */
function styleFor (kind: AnnotationKind, color: string): Record<string, unknown> {
  switch (kind) {
    case 'level':
      return { line: { color, style: 'dashed' }, text: { color } }
    case 'zone':
      return { polygon: { style: 'fill', color: `${color}22`, borderColor: color, borderSize: 1, borderStyle: 'solid' } }
    case 'marker':
    default:
      return { text: { color, backgroundColor: color } }
  }
}
