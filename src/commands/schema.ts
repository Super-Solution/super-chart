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

// The command registry's DOM-free descriptors (SC-123). This module is the
// `./commands` package subpath (see package.json/vite.config.ts) — it MUST
// NOT import `klinecharts` or `solid-js`, so a server (e.g. an MCP tool
// gateway in backend/ai-runtime-core) can list what a chart instance supports,
// build a prompt or a tool schema, and validate arguments, without ever
// constructing a chart or even having a DOM available. It imports only
// `../types`, which itself imports klinecharts types ERASED at compile time
// (every klinecharts import there is `import { type X, ... }`) — see
// commands.test.ts's "no runtime klinecharts/solid-js import" assertion,
// which walks this module's static import graph.
//
// The actual `run` implementations (bound to a live ChartPro instance, and
// free to use klinecharts/Solid) live in ./bind.ts, imported only from the
// full package entry — never from this subpath.
//
// Part of SUPer-Chart (Apache-2.0).

import { BUILTIN_LOCALES, CHART_TYPES, LAYOUT_MODES, THEMES } from '../types'

// ---- a small, self-contained JSON-Schema subset -------------------------------
// Enough to describe every command's arguments and validate them (bind.ts's
// execute()) without a dependency on ajv or any other schema library — see
// PLAN.md/LEAN-RULES.md's dependency budget. A host that wants full JSON
// Schema semantics (oneOf, $ref, …) is free to layer that over these; nothing
// here claims to BE the JSON Schema spec, only a practical, typed subset of it.

export type JSONSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null'

export interface JSONSchema {
  type?: JSONSchemaType | readonly JSONSchemaType[]
  description?: string
  enum?: readonly unknown[]
  items?: JSONSchema
  properties?: Readonly<Record<string, JSONSchema>>
  required?: readonly string[]
  additionalProperties?: boolean
  minimum?: number
  maximum?: number
}

/** A command's static shape: what it takes, what it means, and how it should be offered to an agent/palette. */
export interface CommandDescriptor {
  /** Dotted (`chart.setSymbol`); toToolDefinitions() sanitises this for MCP's stricter name charset. */
  id: string
  /** An i18n key (src/i18n/*.json's `command.*` keys); the palette and any tool-listing UI look it up, falling back to the id itself for a locale that lacks it (same fallback every other i18n key in this package uses). */
  titleKey: string
  argsSchema: JSONSchema
  /** Never changes chart state (a "get" or "list" command). */
  readOnly: boolean
  /** Removes or replaces existing user state (clearDrawings, setAnnotations' clear, removeDrawing, …); excluded from toToolDefinitions()'s default set unless explicitly included. */
  destructive: boolean
  /** A default keyboard shortcut the opt-in command palette offers (never bound unless the palette is on). */
  hotkey?: string
  /** Argument values ajv-free callers (and commands.test.ts) can validate the schema against and execute() can smoke-test. */
  example: Readonly<Record<string, unknown>>
}

const PERIOD_EXAMPLE = '1H'

export const COMMAND_DESCRIPTORS: readonly CommandDescriptor[] = [
  // ---- chart ------------------------------------------------------------
  {
    id: 'chart.setSymbol',
    titleKey: 'command.chart.setSymbol',
    argsSchema: {
      type: 'object',
      properties: { ticker: { type: 'string', description: 'The symbol ticker, as the datafeed knows it.' } },
      required: ['ticker'],
      additionalProperties: true
    },
    readOnly: false,
    destructive: false,
    example: { ticker: 'BTC-USDT' }
  },
  {
    id: 'chart.setPeriod',
    titleKey: 'command.chart.setPeriod',
    argsSchema: {
      type: 'object',
      properties: { period: { type: 'string', description: "Shorthand ('1H', '4h', 'D', 'W', 'M', 'Y') or a TradingView resolution ('240')." } },
      required: ['period']
    },
    readOnly: false,
    destructive: false,
    example: { period: PERIOD_EXAMPLE }
  },
  {
    id: 'chart.setChartType',
    titleKey: 'command.chart.setChartType',
    argsSchema: { type: 'object', properties: { type: { type: 'string', enum: CHART_TYPES } }, required: ['type'] },
    readOnly: false,
    destructive: false,
    example: { type: 'candle_solid' }
  },
  {
    id: 'chart.setTheme',
    titleKey: 'command.chart.setTheme',
    argsSchema: { type: 'object', properties: { theme: { type: 'string', enum: THEMES } }, required: ['theme'] },
    readOnly: false,
    destructive: false,
    example: { theme: 'dark' }
  },
  {
    id: 'chart.setTimezone',
    titleKey: 'command.chart.setTimezone',
    argsSchema: { type: 'object', properties: { timezone: { type: 'string', description: "An IANA zone (e.g. 'Asia/Taipei'), or 'local'." } }, required: ['timezone'] },
    readOnly: false,
    destructive: false,
    example: { timezone: 'Asia/Taipei' }
  },
  {
    id: 'chart.setLocale',
    titleKey: 'command.chart.setLocale',
    argsSchema: { type: 'object', properties: { locale: { type: 'string', enum: BUILTIN_LOCALES } }, required: ['locale'] },
    readOnly: false,
    destructive: false,
    example: { locale: 'en-US' }
  },
  {
    id: 'chart.setLayoutMode',
    titleKey: 'command.chart.setLayoutMode',
    argsSchema: { type: 'object', properties: { mode: { type: 'string', enum: LAYOUT_MODES } }, required: ['mode'] },
    readOnly: false,
    destructive: false,
    example: { mode: 'auto' }
  },
  {
    id: 'chart.resetView',
    titleKey: 'command.chart.resetView',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: false,
    destructive: false,
    hotkey: 'Alt+R',
    example: {}
  },
  {
    id: 'chart.scrollToLatest',
    titleKey: 'command.chart.scrollToLatest',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: false,
    destructive: false,
    example: {}
  },
  {
    id: 'chart.setPriceScale',
    titleKey: 'command.chart.setPriceScale',
    argsSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['normal', 'percentage', 'log'] },
        reverse: { type: 'boolean' },
        fit: { type: 'boolean' }
      }
    },
    readOnly: false,
    destructive: false,
    example: { type: 'log' }
  },
  {
    id: 'chart.snapshot',
    titleKey: 'command.chart.snapshot',
    argsSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['png', 'jpeg', 'webp'] },
        quality: { type: 'number', minimum: 0, maximum: 1 }
      }
    },
    readOnly: true,
    destructive: false,
    example: { format: 'png' }
  },
  {
    id: 'chart.describe',
    titleKey: 'command.chart.describe',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    destructive: false,
    example: {}
  },
  {
    id: 'chart.getState',
    titleKey: 'command.chart.getState',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    destructive: false,
    example: {}
  },
  // ---- history ------------------------------------------------------------
  {
    id: 'history.undo',
    titleKey: 'command.history.undo',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: false,
    destructive: false,
    hotkey: 'Ctrl+Z',
    example: {}
  },
  {
    id: 'history.redo',
    titleKey: 'command.history.redo',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: false,
    destructive: false,
    hotkey: 'Ctrl+Shift+Z',
    example: {}
  },
  // ---- indicators ---------------------------------------------------------
  {
    id: 'indicator.add',
    titleKey: 'command.indicator.add',
    argsSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'An indicator name from getIndicatorCatalog(), or any registered one.' },
        pane: { type: 'string', enum: ['main', 'new'] },
        calcParams: { type: 'array', items: { type: 'number' } }
      },
      required: ['name']
    },
    readOnly: false,
    destructive: false,
    example: { name: 'MA', calcParams: [20, 50, 200] }
  },
  {
    id: 'indicator.remove',
    titleKey: 'command.indicator.remove',
    argsSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, paneId: { type: 'string' } },
      required: ['name', 'paneId']
    },
    readOnly: false,
    destructive: true,
    example: { name: 'MA', paneId: 'candle_pane' }
  },
  {
    id: 'indicator.setVisible',
    titleKey: 'command.indicator.setVisible',
    argsSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, visible: { type: 'boolean' }, paneId: { type: 'string' } },
      required: ['name', 'visible']
    },
    readOnly: false,
    destructive: false,
    example: { name: 'MA', visible: false }
  },
  {
    id: 'indicator.list',
    titleKey: 'command.indicator.list',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    destructive: false,
    example: {}
  },
  // ---- drawings (SC-127) ---------------------------------------------------
  {
    id: 'drawing.add',
    titleKey: 'command.drawing.add',
    argsSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'A tool name from listDrawingTools()/getDrawingToolCatalog().' },
        points: {
          type: 'array',
          items: {
            type: 'object',
            properties: { time: { type: 'number' }, price: { type: 'number' } },
            required: ['time']
          }
        },
        text: { type: 'string' },
        locked: { type: 'boolean' }
      },
      required: ['tool', 'points']
    },
    readOnly: false,
    destructive: false,
    example: { tool: 'horizontalStraightLine', points: [{ time: 1_700_000_000_000, price: 65_000 }] }
  },
  {
    id: 'drawing.update',
    titleKey: 'command.drawing.update',
    argsSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        points: { type: 'array', items: { type: 'object', properties: { time: { type: 'number' }, price: { type: 'number' } }, required: ['time'] } },
        text: { type: 'string' },
        locked: { type: 'boolean' },
        visible: { type: 'boolean' }
      },
      required: ['id']
    },
    readOnly: false,
    destructive: false,
    example: { id: 'overlay_1', visible: false }
  },
  {
    id: 'drawing.remove',
    titleKey: 'command.drawing.remove',
    argsSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    readOnly: false,
    destructive: true,
    example: { id: 'overlay_1' }
  },
  {
    id: 'drawing.list',
    titleKey: 'command.drawing.list',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    destructive: false,
    example: {}
  },
  {
    id: 'drawing.clearAll',
    titleKey: 'command.drawing.clearAll',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: false,
    destructive: true,
    example: {}
  },
  // ---- annotations (SC-128) ------------------------------------------------
  {
    id: 'annotation.set',
    titleKey: 'command.annotation.set',
    argsSchema: {
      type: 'object',
      properties: {
        layer: { type: 'string' },
        specs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              kind: { type: 'string', enum: ['level', 'zone', 'marker'] },
              anchors: { type: 'array', items: { type: 'object', properties: { time: { type: 'number' }, price: { type: 'number' } }, required: ['time'] } },
              text: { type: 'string' },
              tone: { type: 'string', enum: ['bull', 'bear', 'neutral', 'accent'] }
            },
            required: ['key', 'kind', 'anchors']
          }
        }
      },
      required: ['layer', 'specs']
    },
    readOnly: false,
    destructive: false,
    example: { layer: 'ai', specs: [{ key: 'resistance-1', kind: 'level', anchors: [{ time: 1_700_000_000_000, price: 70_000 }], tone: 'bear' }] }
  },
  {
    id: 'annotation.clear',
    titleKey: 'command.annotation.clear',
    argsSchema: { type: 'object', properties: { layer: { type: 'string' } }, required: ['layer'] },
    readOnly: false,
    destructive: true,
    example: { layer: 'ai' }
  },
  // ---- layout (SC-121) ------------------------------------------------------
  {
    id: 'layout.get',
    titleKey: 'command.layout.get',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    destructive: false,
    example: {}
  },
  {
    id: 'layout.apply',
    titleKey: 'command.layout.apply',
    argsSchema: { type: 'object', properties: { layout: { type: 'object' } }, required: ['layout'] },
    readOnly: false,
    destructive: true,
    example: { layout: { v: 1, symbol: 'BTC-USDT', chartType: 'candle_solid', timezone: 'Etc/UTC', indicators: [], drawings: [] } }
  },
  // ---- replay (SC-178 companion) --------------------------------------------
  {
    id: 'replay.start',
    titleKey: 'command.replay.start',
    argsSchema: { type: 'object', properties: { index: { type: 'integer' }, timestamp: { type: 'number' } } },
    readOnly: false,
    destructive: false,
    example: {}
  },
  {
    id: 'replay.step',
    titleKey: 'command.replay.step',
    argsSchema: { type: 'object', properties: { n: { type: 'integer' } } },
    readOnly: false,
    destructive: false,
    example: { n: 1 }
  },
  {
    id: 'replay.play',
    titleKey: 'command.replay.play',
    argsSchema: { type: 'object', properties: { speed: { type: 'number', minimum: 0.1 } } },
    readOnly: false,
    destructive: false,
    example: {}
  },
  {
    id: 'replay.pause',
    titleKey: 'command.replay.pause',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: false,
    destructive: false,
    example: {}
  },
  {
    id: 'replay.exit',
    titleKey: 'command.replay.exit',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: false,
    destructive: false,
    example: {}
  }
]

/** The static registry, unfiltered — a live chart's getCommands() (bind.ts) returns the same list, id-for-id. */
export function getCommandDescriptors (): readonly CommandDescriptor[] {
  return COMMAND_DESCRIPTORS
}

export function findCommandDescriptor (id: string): CommandDescriptor | undefined {
  return COMMAND_DESCRIPTORS.find(c => c.id === id)
}

// ---- lightweight schema validation (no ajv dependency) ------------------------

export interface ValidationError {
  path: string
  message: string
}

function typeOfValue (value: unknown): JSONSchemaType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'boolean') return 'boolean'
  return 'object'
}

function matchesType (value: unknown, type: JSONSchemaType): boolean {
  if (type === 'number') {
    return typeof value === 'number' && Number.isFinite(value)
  }
  if (type === 'integer') {
    return typeof value === 'number' && Number.isInteger(value)
  }
  return typeOfValue(value) === type
}

/**
 * Validates `value` against `schema`, collecting every problem (not just the
 * first) so an agent/tool caller gets one useful error back. Covers the
 * subset of JSON Schema this module's descriptors actually use — type,
 * enum, properties/required/additionalProperties, items, minimum/maximum —
 * deliberately not the whole spec (see the module comment above).
 */
export function validateAgainstSchema (value: unknown, schema: JSONSchema, path = ''): ValidationError[] {
  const errors: ValidationError[] = []
  const label = path === '' ? '(root)' : path
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some(t => matchesType(value, t))) {
      errors.push({ path: label, message: `expected ${types.join(' | ')}, got ${typeOfValue(value)}` })
      return errors // further checks would be noise once the base type is wrong
    }
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push({ path: label, message: `expected one of ${schema.enum.map(v => JSON.stringify(v)).join(', ')}` })
  }
  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    errors.push({ path: label, message: `must be >= ${schema.minimum}` })
  }
  if (typeof schema.maximum === 'number' && typeof value === 'number' && value > schema.maximum) {
    errors.push({ path: label, message: `must be <= ${schema.maximum}` })
  }
  if (schema.properties !== undefined && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (!(key in obj)) {
        errors.push({ path: path === '' ? key : `${path}.${key}`, message: 'required' })
      }
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in obj) {
        errors.push(...validateAgainstSchema(obj[key], sub, path === '' ? key : `${path}.${key}`))
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in schema.properties)) {
          errors.push({ path: path === '' ? key : `${path}.${key}`, message: 'unexpected property' })
        }
      }
    }
  }
  if (schema.items !== undefined && Array.isArray(value)) {
    value.forEach((item, i) => { errors.push(...validateAgainstSchema(item, schema.items as JSONSchema, `${path}[${i}]`)) })
  }
  return errors
}
