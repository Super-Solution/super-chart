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

// Per-instance run bindings for the command registry (SC-123): turns the
// DOM-free descriptors in ./schema.ts into `execute()`/`getCommands()`/
// `toToolDefinitions()` bound to one live ChartPro instance. This module is
// NOT part of the `./commands` subpath (that is schema.ts only) — it is
// exported from the full package entry (src/index.ts), because it is only
// ever useful already holding a live chart, which needs klinecharts anyway.
//
// execute() never throws: every path returns `{ ok: true, result }` or
// `{ ok: false, error }`, and `error` is a ChartErrorJSON so an agent/MCP
// caller gets the same field/allowed/hint shape every other v2 API gives.
// setSymbol/setPeriod already return a Promise<LoadResult> that resolves
// only once the load has settled — execute() just awaits it, so an agent
// that reads data right after a set_period call never sees a stale bar.
//
// Part of SUPer-Chart (Apache-2.0).

import { ChartError, isChartError } from '../api/errors'
import type { ChartErrorJSON } from '../api/errors'
import type { AnnotationSpec, SetAnnotationsResult } from '../api/annotations'
import type { AddDrawingSpec, DrawingLevel, UpdateDrawingChanges } from '../api/drawings'
import type { ApplyLayoutOptions, ApplyLayoutResult, ChartLayoutV1 } from '../api/layout'
import { isChartType, isLayoutMode, isTheme, type ChartPro } from '../types'
import { COMMAND_DESCRIPTORS, findCommandDescriptor, validateAgainstSchema, type CommandDescriptor, type JSONSchema } from './schema'

export interface ExecuteRequest {
  id: string
  args?: Record<string, unknown>
}

export type ExecuteResult<T = unknown> =
  | { ok: true, result: T }
  | { ok: false, error: ChartErrorJSON }

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: JSONSchema
  annotations: { readOnlyHint: boolean, destructiveHint: boolean, idempotentHint: boolean }
}

export interface ToToolDefinitionsOptions {
  /** Only these ids (bypasses the destructive/image-loading default exclusion). */
  include?: readonly string[]
  /** Excluded in addition to the default (destructive + image-loading) exclusion. */
  exclude?: readonly string[]
  /** Narrows (never widens) a command's dynamic enum, e.g. `{ 'indicator.add': { name: ['MA', 'EMA'] } }`. */
  enumOverrides?: Readonly<Record<string, Readonly<Record<string, readonly unknown[]>>>>
}

export interface CommandApis {
  addDrawing: (spec: AddDrawingSpec) => string | null
  updateDrawing: (id: string, changes: UpdateDrawingChanges) => boolean
  listDrawingTools: () => string[]
  drawingLevelsAt: (id: string, timestamp: number) => DrawingLevel[] | null
  setAnnotations: (layer: string, specs: readonly AnnotationSpec[]) => SetAnnotationsResult
  getAnnotations: (layer?: string) => AnnotationSpec[]
  clearAnnotations: (layer: string) => void
  getLayout: () => ChartLayoutV1
  applyLayout: (layout: ChartLayoutV1, options?: ApplyLayoutOptions) => ApplyLayoutResult
}

export interface CommandBindingDeps {
  getChart: () => ChartPro | null
  apis: CommandApis
}

// An image drawing loads the `text` field as a URL. Do not offer that tool to
// an agent by default. Updating an existing drawing can change an image URL,
// so drawing.update also requires an explicit include. This is a tool-list
// default, not an authorization boundary for execute() itself.
const IMAGE_LOADING_COMMANDS = new Set(['drawing.update'])
const IMAGE_LOADING_DRAWING_TOOLS = new Set(['image'])

const IDEMPOTENT_COMMANDS = new Set([
  'chart.setSymbol', 'chart.setPeriod', 'chart.setChartType', 'chart.setTheme', 'chart.setTimezone',
  'chart.setLocale', 'chart.setLayoutMode', 'chart.setPriceScale', 'indicator.setVisible',
  'drawing.update', 'layout.apply', 'annotation.set'
])

type Runner = (chart: ChartPro, args: Record<string, unknown>, apis: CommandApis) => unknown

function need<T> (value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new ChartError({ code: 'INVALID_ARGUMENT', field, received: value, hint: 'Required.' })
  }
  return value
}

const RUNNERS: Readonly<Record<string, Runner>> = {
  // Async runners are awaited by execute() below regardless (Promise.resolve wraps a sync result too).
  // execute() awaits runner results; keep the chart's original promise.
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  'chart.setSymbol': (chart, args) => chart.setSymbol({ ticker: need(args.ticker as string, 'ticker'), ...args }),
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  'chart.setPeriod': (chart, args) => chart.setPeriod(need(args.period as string, 'period')),
  'chart.setChartType': (chart, args) => {
    const type = args.type
    if (!isChartType(type)) {
      throw new ChartError({ code: 'INVALID_ARGUMENT', field: 'type', received: type })
    }
    chart.setChartType(type)
    return { chartType: chart.getChartType() }
  },
  'chart.setTheme': (chart, args) => {
    if (!isTheme(args.theme)) {
      throw new ChartError({ code: 'UNKNOWN_THEME', field: 'theme', received: args.theme })
    }
    chart.setTheme(args.theme)
    return { theme: chart.getTheme() }
  },
  'chart.setTimezone': (chart, args) => {
    chart.setTimezone(need(args.timezone as string, 'timezone'))
    return { timezone: chart.getTimezone() }
  },
  'chart.setLocale': (chart, args) => {
    chart.setLocale(need(args.locale as string, 'locale'))
    return { locale: chart.getLocale() }
  },
  'chart.setLayoutMode': (chart, args) => {
    if (!isLayoutMode(args.mode)) {
      throw new ChartError({ code: 'INVALID_ARGUMENT', field: 'mode', received: args.mode })
    }
    chart.setLayoutMode(args.mode)
    return { sizeClass: chart.getSizeClass() }
  },
  'chart.resetView': chart => { chart.resetView(); return {} },
  'chart.scrollToLatest': chart => { chart.scrollToLatest(); return {} },
  'chart.setPriceScale': (chart, args) => { chart.setPriceScale(args); return chart.getPriceScale() },
  'chart.snapshot': (chart, args) => chart.snapshot(args),
  'chart.describe': chart => chart.describe(),
  'chart.getState': chart => chart.getState(),
  'history.undo': chart => ({ applied: chart.undo() }),
  'history.redo': chart => ({ applied: chart.redo() }),
  'indicator.add': (chart, args) => {
    const handle = chart.addIndicator(need(args.name as string, 'name'), { pane: args.pane as 'main' | 'new' | undefined, calcParams: args.calcParams as unknown[] | undefined })
    if (handle === null) {
      throw new ChartError({ code: 'UNKNOWN_INDICATOR', field: 'name', received: args.name })
    }
    return handle
  },
  'indicator.remove': (chart, args) => ({ removed: chart.removeIndicator({ name: need(args.name as string, 'name'), paneId: need(args.paneId as string, 'paneId') }) }),
  'indicator.setVisible': (chart, args) => ({ applied: chart.setIndicatorVisible(need(args.name as string, 'name'), need(args.visible as boolean, 'visible'), args.paneId as string | undefined) }),
  'indicator.list': chart => chart.getIndicators(),
  'drawing.add': (chart, args, apis) => {
    const id = apis.addDrawing(args as unknown as AddDrawingSpec)
    if (id === null) {
      throw new ChartError({ code: 'UNKNOWN_DRAWING_TOOL', field: 'tool', received: args.tool, allowed: apis.listDrawingTools() })
    }
    return { id }
  },
  'drawing.update': (chart, args, apis) => ({ applied: apis.updateDrawing(need(args.id as string, 'id'), args as unknown as UpdateDrawingChanges) }),
  'drawing.remove': (chart, args) => { chart.removeDrawing(need(args.id as string, 'id')); return {} },
  'drawing.list': chart => chart.listDrawings(),
  'drawing.clearAll': chart => { chart.clearDrawings(); return {} },
  'annotation.set': (chart, args, apis) => apis.setAnnotations(need(args.layer as string, 'layer'), (args.specs as AnnotationSpec[] | undefined) ?? []),
  'annotation.clear': (chart, args, apis) => { apis.clearAnnotations(need(args.layer as string, 'layer')); return {} },
  'layout.get': (chart, args, apis) => apis.getLayout(),
  'layout.apply': (chart, args, apis) => apis.applyLayout(need(args.layout as ChartLayoutV1, 'layout')),
  'replay.start': (chart, args) => ({ started: chart.replay.start(args) }),
  'replay.step': (chart, args) => { chart.replay.step(args.n as number | undefined); return chart.replay.getState() },
  'replay.play': (chart, args) => { chart.replay.play(args as { speed?: number }); return chart.replay.getState() },
  'replay.pause': chart => { chart.replay.pause(); return chart.replay.getState() },
  'replay.exit': chart => { chart.replay.exit(); return chart.replay.getState() }
}

function toErrorJSON (e: unknown, field: string): ChartErrorJSON {
  if (isChartError(e)) {
    return e.toJSON()
  }
  return {
    name: 'ChartError',
    code: 'INVALID_ARGUMENT',
    field,
    received: null,
    message: e instanceof Error ? e.message : String(e)
  }
}

/**
 * Validates `request.args` against the command's schema, runs it, and never
 * throws. Unknown command id, a schema violation, a ChartError from the
 * underlying v2 call, and any other thrown value all come back as
 * `{ ok: false, error }` with the same ChartErrorJSON shape.
 */
export async function execute (deps: CommandBindingDeps, request: ExecuteRequest): Promise<ExecuteResult> {
  const descriptor = findCommandDescriptor(request.id)
  if (descriptor === undefined) {
    return { ok: false, error: new ChartError({ code: 'INVALID_ARGUMENT', field: 'id', received: request.id, allowed: COMMAND_DESCRIPTORS.map(c => c.id) }).toJSON() }
  }
  const args = request.args ?? {}
  const problems = validateAgainstSchema(args, descriptor.argsSchema)
  if (problems.length > 0) {
    const [first] = problems
    return {
      ok: false,
      error: new ChartError({
        code: 'INVALID_ARGUMENT',
        field: first.path,
        received: args,
        hint: problems.map(p => `${p.path}: ${p.message}`).join('; ')
      }).toJSON()
    }
  }
  const chart = deps.getChart()
  if (chart === null) {
    return { ok: false, error: new ChartError({ code: 'NOT_READY', field: 'chart', received: null, hint: 'The chart has not mounted (or has been disposed) yet.' }).toJSON() }
  }
  const runner = RUNNERS[descriptor.id]
  if (runner === undefined) {
    // Only reachable if schema.ts adds a descriptor without a matching runner — a programming error, not user input.
    return { ok: false, error: new ChartError({ code: 'INVALID_ARGUMENT', field: 'id', received: request.id, hint: 'This command has no implementation yet.' }).toJSON() }
  }
  try {
    const result = await runner(chart, args, deps.apis)
    return { ok: true, result: result ?? null }
  } catch (e) {
    return { ok: false, error: toErrorJSON(e, 'args') }
  }
}

export function getCommands (): readonly CommandDescriptor[] {
  return COMMAND_DESCRIPTORS
}

function sanitizeToolName (id: string): string {
  const snake = id.replace(/\./g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
  return snake.slice(0, 64)
}

/** Fills in a live enum for a schema property, narrowed by an override when one is given (never widened). */
function withDynamicEnum (schema: JSONSchema, property: string, values: readonly unknown[] | undefined, override: readonly unknown[] | undefined): JSONSchema {
  if (schema.properties === undefined || !(property in schema.properties)) {
    return schema
  }
  const base = values ?? schema.properties[property].enum
  const enumValues = override !== undefined && base !== undefined
    ? base.filter(v => override.includes(v))
    : (override ?? base)
  if (enumValues === undefined) {
    return schema
  }
  return {
    ...schema,
    properties: { ...schema.properties, [property]: { ...schema.properties[property], enum: enumValues } }
  }
}

function dynamicSchemaFor (id: string, schema: JSONSchema, chart: ChartPro | null, apis: CommandApis, overrides: Readonly<Record<string, readonly unknown[]>> | undefined, allowImageDrawingTools: boolean): JSONSchema {
  if (id === 'drawing.add') {
    const tools = apis.listDrawingTools().filter(tool => allowImageDrawingTools || !IMAGE_LOADING_DRAWING_TOOLS.has(tool))
    return withDynamicEnum(schema, 'tool', tools, overrides?.tool)
  }
  if (chart === null) {
    return schema
  }
  switch (id) {
    case 'chart.setPeriod':
      return withDynamicEnum(schema, 'period', chart.getPeriods().map(p => p.text), overrides?.period)
    case 'indicator.add':
    case 'indicator.remove':
    case 'indicator.setVisible':
      return withDynamicEnum(schema, 'name', chart.getIndicatorCatalog().map(e => e.name), overrides?.name)
    default:
      return schema
  }
}

/**
 * Neutral MCP-shaped tool definitions: sanitised names (`^[a-zA-Z0-9_-]{1,64}$`),
 * an inputSchema with dynamic enums resolved against THIS instance, and
 * readOnly/destructive/idempotent annotations. Destructive commands and
 * image-URL-loading tools are excluded from the default set (pass them in
 * `include` to get them anyway). This never depends on
 * `@supersolution/super-chat-core` or any other tool-calling library: a host maps
 * the result to its own ToolDefinition shape (SupWallet's tools.ts already
 * does this for its hand-written enums, which toToolDefinitions replaces).
 */
export function toToolDefinitions (deps: CommandBindingDeps, options?: ToToolDefinitionsOptions, titleFor?: (descriptor: CommandDescriptor) => string): ToolDefinition[] {
  const chart = deps.getChart()
  const include = options?.include
  const exclude = new Set(options?.exclude ?? [])
  return COMMAND_DESCRIPTORS
    .filter(c => {
      if (exclude.has(c.id)) {
        return false
      }
      if (include !== undefined) {
        return include.includes(c.id)
      }
      if (c.destructive || IMAGE_LOADING_COMMANDS.has(c.id)) {
        return false
      }
      return true
    })
    .map(c => ({
      name: sanitizeToolName(c.id),
      description: titleFor?.(c) ?? c.titleKey,
      inputSchema: dynamicSchemaFor(c.id, c.argsSchema, chart, deps.apis, options?.enumOverrides?.[c.id], include?.includes('drawing.add') === true),
      annotations: { readOnlyHint: c.readOnly, destructiveHint: c.destructive, idempotentHint: IDEMPOTENT_COMMANDS.has(c.id) }
    }))
}
