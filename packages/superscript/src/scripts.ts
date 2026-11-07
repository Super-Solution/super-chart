import { parse, check, evaluate, type LangPlot, type LangParams } from './runtime/language'
import { BUILTINS, PINE_ALIASES, PINE_ARG_NAMES } from './runtime/builtins'
import { SuperScriptError, type Diagnostic } from './runtime/diagnostics'
import type { ScriptInput, ScriptParams } from './runtime'
import { type MarketBar, type EngineIndicatorInstance, type EngineIndicatorSpec, type IndicatorDefinition, type IndicatorFigure, type IndicatorRow } from '@supersolutions/super-chart-core'

/** Per-script ceilings, not a wall-clock timeout or an isolation sandbox. */
export interface EngineScriptLimits {
  readonly sourceLength: number
  readonly nodes: number
  readonly depth: number
  readonly plots: number
  readonly inputs: number
  readonly bars: number
  readonly window: number
  readonly seriesCells: number
  readonly workUnits: number
}

export const ENGINE_SCRIPT_LIMITS: Readonly<EngineScriptLimits> = Object.freeze({
  sourceLength: 32_768,
  nodes: 2_048,
  depth: 64,
  plots: 32,
  inputs: 64,
  bars: 100_000,
  window: 10_000,
  seriesCells: 8_000_000,
  workUnits: 50_000_000
})

export interface EngineScriptOptions {
  readonly name: string
  readonly source: string
  readonly params?: ScriptParams
  /** Optional tighter ceilings. Raising the built-in ceilings is not supported. */
  readonly limits?: Partial<EngineScriptLimits>
}

export type EngineScriptErrorCode = 'LIMIT' | 'UNSUPPORTED' | 'PARAMS' | 'DATA' | 'RESULT' | 'DISPOSED'

export class EngineScriptError extends Error {
  constructor (readonly code: EngineScriptErrorCode, message: string) {
    super(message); this.name = 'EngineScriptError'
  }
}

/** Structural host interface: no EngineChart, DOM, or upstream-engine import. */
export interface EngineScriptHost {
  registerIndicator: (definition: IndicatorDefinition) => void
  unregisterIndicator: (name: string, expectedCalculate?: IndicatorDefinition['calculate']) => boolean
  addIndicator: (spec: EngineIndicatorSpec) => string
  listIndicators: () => readonly EngineIndicatorInstance[]
  removeIndicator: (id: string) => boolean
  updateIndicator: (id: string, changes: Pick<EngineIndicatorSpec, 'params'>) => boolean
}

export interface EngineScriptAttachment {
  readonly id: string
  /** Validate before changing the instance. Unspecified inputs keep their current values. */
  setParams: (params: ScriptParams) => readonly number[]
  /** Remove only this instance, then unregister only this exact calculation if unused. */
  dispose: () => void
}

export interface EngineScriptIndicator {
  readonly title: string
  readonly definition: IndicatorDefinition
  readonly inputs: readonly Readonly<ScriptInput>[]
  readonly diagnostics: readonly Readonly<Diagnostic>[]
  readonly limits: Readonly<EngineScriptLimits>
  attach: (host: EngineScriptHost, options?: Omit<EngineIndicatorSpec, 'name' | 'params'> & { params?: ScriptParams }) => EngineScriptAttachment
  /** Detach all owned instances. Borrowed definitions remain valid until their host releases them. */
  dispose: () => void
}

type Program = ReturnType<typeof parse>
type Expr = Program['statements'][number]['value']
interface WindowGuard { expression: Expr, label: string, scan: boolean, statement: number }
interface Analysis { nodes: number, guards: WindowGuard[] }
const PALETTE = ['#8bafff', '#ffb454', '#cf9bff', '#58c9ac', '#f28b82', '#d8c66a']

function limitsOf (overrides: Partial<EngineScriptLimits> = {}): Readonly<EngineScriptLimits> {
  const limits = { ...ENGINE_SCRIPT_LIMITS }
  for (const key of Object.keys(overrides) as Array<keyof EngineScriptLimits>) {
    const value = overrides[key]
    if (!Object.prototype.hasOwnProperty.call(ENGINE_SCRIPT_LIMITS, key) || !Number.isSafeInteger(value) || value! < 1 || value! > ENGINE_SCRIPT_LIMITS[key]) {
      throw new EngineScriptError('LIMIT', `Invalid script ceiling: ${key}`)
    }
    limits[key] = value!
  }
  return Object.freeze(limits)
}

/** Inspect only real call arguments, preserving string tokens and ignoring comments. */
function sourceCode (source: string, limits: EngineScriptLimits): string {
  if (typeof source !== 'string' || source.length > limits.sourceLength) throw new EngineScriptError('LIMIT', 'Script source is too large')
  let code = '', quote = '', depth = 0
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quote !== '') {
      if (c === '\\') { code += c + (source[++i] ?? ''); continue }
      if (c === quote) quote = ''
      code += c; continue
    }
    if (c === '"' || c === "'") { quote = c; code += c; continue }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') { code += ' '; i++ }
      code += '\n'; continue
    }
    if (c === '(' || c === '[') {
      if (++depth > limits.depth) throw new EngineScriptError('LIMIT', 'Script nesting is too deep')
    } else if (c === ')' || c === ']') depth--
    code += c
  }
  // The legacy parser aliases these to ordinary lines/circles. This bridge
  // does not pretend that step/area/cross rendering is implemented.
  // These named plot arguments are silently discarded by the old parser.
  // Recognize them only inside plot/hline calls, not in variable bindings.
  const tokens = code.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_][\w.]*|[()[\],=]|\S/g) ?? []
  if (tokens.length > Math.min(4_096, limits.nodes * 8)) throw new EngineScriptError('LIMIT', 'Script token budget exceeded')
  const calls: Array<{ name: string, depth: number, argument: number }> = []
  let nesting = 0, unary = 0
  const unsupported = new Set(['editable', 'display', 'trackprice', 'show_last', 'join', 'transp', 'force_overlay', 'format', 'precision'])
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    unary = ['+', '-', '!', 'not'].includes(token) ? unary + 1 : 0
    if (unary > limits.depth) throw new EngineScriptError('LIMIT', 'Script unary nesting is too deep')
    const call = calls[calls.length - 1]
    const styleArgument = call?.name === 'plot' && call.depth === nesting &&
      ((tokens[i - 1] === '=' && ['style', 'type'].includes(tokens[i - 2])) || (call.argument === 4 && tokens[i - 1] === ','))
    if (styleArgument && /^plot\.style_(stepline|area|cross)$/.test(token[0] === '"' || token[0] === "'" ? token.slice(1, -1) : token)) {
      throw new EngineScriptError('UNSUPPORTED', 'Step, area and cross script plots are not supported')
    }
    if (token === '(') { nesting++; calls.push({ name: tokens[i - 1] ?? '', depth: nesting, argument: 0 }) }
    else if (token === ')') { if (calls[calls.length - 1]?.depth === nesting) calls.pop(); nesting-- }
    else if (token === '[') nesting++
    else if (token === ']') nesting--
    else if (token === ',' && call?.depth === nesting) call.argument++
    else if (tokens[i + 1] === '=' && calls[calls.length - 1]?.depth === nesting) {
      const name = calls[calls.length - 1].name
      if ((/^(plot|hline)$/.test(name) && unsupported.has(token)) ||
        (/^(indicator|study)$/.test(name) && token !== 'title' && token !== 'overlay') ||
        (/^input(\.int|\.float)?$/.test(name) && !['title', 'minval', 'maxval', 'step', 'defval'].includes(token))) {
        throw new EngineScriptError('UNSUPPORTED', `Script argument is not supported: ${name}.${token}`)
      }
      if (/^(indicator|study)$/.test(name) && token === 'overlay' &&
        (!['true', 'false', '0', '1'].includes(tokens[i + 2]) || ![',', ')'].includes(tokens[i + 3]))) {
        throw new EngineScriptError('UNSUPPORTED', 'Indicator overlay must be a literal boolean')
      }
    }
  }
  return code
}

function analyze (program: Program, limits: EngineScriptLimits): Analysis {
  let nodes = 0, statementIndex = 0
  const guards: WindowGuard[] = []
  const visit = (expression: Expr, depth: number): void => {
    if (++nodes > limits.nodes || depth > limits.depth) throw new EngineScriptError('LIMIT', 'Script expression budget exceeded')
    const child = (e: Expr): void => visit(e, depth + 1)
    switch (expression.k) {
      case 'bin': child(expression.l); child(expression.r); break
      case 'tern': child(expression.c); child(expression.a); child(expression.b); break
      case 'unary': child(expression.arg); break
      case 'index':
        guards.push({ expression: expression.offset, label: 'history offset', scan: false, statement: statementIndex })
        child(expression.target); child(expression.offset); break
      case 'call': {
        expression.args.forEach(child); expression.kw.forEach(kw => child(kw.value))
        let name = PINE_ALIASES.get(expression.name) ?? expression.name
        let args = expression.args
        if (expression.name === 'ta.cci' || expression.name === 'ta.mfi') { name = expression.name.slice(3); args = expression.args.slice(1) }
        else if (expression.name === 'ta.stoch') { name = 'stoch'; args = expression.args.slice(3) }
        const builtin = BUILTINS.get(name)
        builtin?.params.forEach((param, index) => {
          if (param.kind !== 'length' && param.kind !== 'count') return
          const expressionValue = args[index] ?? expression.kw.find(kw => (PINE_ARG_NAMES.get(kw.name) ?? kw.name) === param.name)?.value
          if (expressionValue !== undefined) { guards.push({
            expression: expressionValue,
            label: `${name}.${param.name}`,
            statement: statementIndex,
            // Conservative: even amortised rolling algorithms can fall back to
            // window scans after arithmetic overflows in a nested expression.
            scan: param.kind === 'length' || name === 'pivothigh' || name === 'pivotlow'
          }) }
        })
        break
      }
    }
  }
  for (const statement of program.statements) {
    visit(statement.value, 1)
    if ((statement.k === 'plot' || statement.k === 'hline') && statement.lineWidth !== undefined) visit(statement.lineWidth, 1)
    if (statement.k === 'plot' && statement.histbase !== undefined) visit(statement.histbase, 1)
    statementIndex++
  }
  return { nodes, guards }
}

/** Reuse the evaluator's constant/input rules, without evaluating any price data. */
function guardProgram (program: Program, guards: readonly WindowGuard[]): { program: Program, plots: number[], windows: number[] } {
  const statements: Program['statements'] = [], plots: number[] = [], windows: number[] = []
  let plotIndex = 0
  program.statements.forEach((statement, index) => {
    // Capture constants before the statement, in their original binding scope.
    // The legacy parser allows a later `x = ...` to replace an earlier binding.
    guards.forEach((guard, guardIndex) => {
      if (guard.statement !== index) return
      statements.push({
        k: 'plot',
        value: { k: 'num', v: 0, text: '0', at: guard.expression.at },
        histbase: guard.expression,
        style: {},
        at: guard.expression.at
      })
      windows[guardIndex] = plotIndex++
    })
    statements.push(statement)
    if (statement.k === 'plot' || statement.k === 'hline') plots.push(plotIndex++)
  })
  return { program: { ...program, statements }, plots, windows }
}

function figuresOf (plots: readonly LangPlot[]): readonly IndicatorFigure[] {
  return Object.freeze(plots.map((plot, index) => {
    const style = plot.style ?? {}, width = style.lineWidth ?? 1.5, base = style.histbase ?? 0
    if (!Number.isFinite(width) || width <= 0 || width > 32 || !Number.isFinite(base)) throw new EngineScriptError('RESULT', 'Plot width/base must be finite; width must be within (0, 32]')
    const dash = style.lineStyle === 'dotted' ? [1, 3] : style.lineStyle === 'dashed' || (style.lineStyle === undefined && plot.kind === 'hline') ? [4, 4] : []
    return Object.freeze({
      key: plot.id,
      title: plot.title,
      color: style.color ?? PALETTE[index % PALETTE.length],
      type: style.type === 'histogram' ? 'bar' as const : style.type === 'circle' ? 'circle' as const : 'line' as const,
      lineWidth: width,
      dash: Object.freeze(dash),
      ...(style.type === 'histogram' ? { base } : {})
    })
  }))
}

function sameFigures (a: readonly IndicatorFigure[], b: readonly IndicatorFigure[]): boolean {
  return a.length === b.length && a.every((figure, i) => {
    const next = b[i]
    return figure.key === next.key && figure.title === next.title && figure.type === next.type && figure.color === next.color &&
      figure.lineWidth === next.lineWidth && figure.base === next.base && figure.dash?.join(',') === next.dash?.join(',')
  })
}

function normalizeParams (inputs: readonly Readonly<ScriptInput>[], given: ScriptParams | undefined, current: readonly number[]): readonly number[] {
  if (given !== undefined) {
    if (typeof given !== 'object' || given === null) throw new EngineScriptError('PARAMS', 'Script inputs must be an array or object')
    if (Array.isArray(given) ? given.length > inputs.length : Object.keys(given).some(key => !inputs.some(input => input.id === key))) {
      throw new EngineScriptError('PARAMS', 'Unknown script input')
    }
  }
  return Object.freeze(inputs.map((input, i) => {
    const supplied = Array.isArray(given) ? given[i] : given !== undefined && Object.prototype.hasOwnProperty.call(given, input.id) ? (given as Record<string, number | null | undefined>)[input.id] : undefined
    let value = supplied == null ? current[i] : supplied
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new EngineScriptError('PARAMS', `Input must be finite: ${input.id}`)
    if (input.type === 'int') value = Math.round(value)
    if (input.min !== undefined) value = Math.max(input.min, value)
    if (input.max !== undefined) value = Math.min(input.max, value)
    return value
  }))
}

function validateBars (bars: readonly MarketBar[], limits: EngineScriptLimits): void {
  if (!Array.isArray(bars) || bars.length > limits.bars) throw new EngineScriptError('LIMIT', 'Script history exceeds the bar ceiling; history is not silently truncated')
  let previous = -Infinity
  for (const bar of bars) {
    if (bar == null || ![bar.timestamp, bar.open, bar.high, bar.low, bar.close].every(value => typeof value === 'number' && Number.isFinite(value)) ||
      Math.abs(bar.timestamp) > 8.64e15 || bar.timestamp <= previous || bar.high < Math.max(bar.open, bar.low, bar.close) || bar.low > Math.min(bar.open, bar.high, bar.close) ||
      (bar.volume !== undefined && (typeof bar.volume !== 'number' || !Number.isFinite(bar.volume) || bar.volume < 0))) {
      throw new EngineScriptError('DATA', 'Scripts require ascending unique epoch-ms timestamps, finite coherent OHLC and nonnegative reported volume')
    }
    previous = bar.timestamp
  }
}

/**
 * Optional owned-engine bridge. Import this module on demand; it never imports
 * klinecharts or the arbitrary-JavaScript language registry. The own parser and
 * evaluator run SuperScript only; warnings about ignored constructs are errors.
 *
 * Calculations see every revealed raw bar, not HA values or a viewport slice.
 * `time` is the feed's epoch milliseconds and `bar_index` starts at the first
 * loaded bar. Prepending history therefore intentionally changes cumulative and
 * indexed formulas. Replay must supply only its revealed prefix, as EngineChart
 * does. Resource ceilings reject work; they never truncate or invent results.
 * The synchronous runtime has no interruptible wall-clock deadline.
 */
export function createEngineScriptIndicator (options: EngineScriptOptions): EngineScriptIndicator {
  if (typeof options.name !== 'string' || options.name.trim() === '') throw new TypeError('Script indicator name must not be empty')
  const limits = limitsOf(options.limits)
  sourceCode(options.source, limits)
  let program: Program
  try { program = parse(options.source) } catch (error) {
    if (error instanceof RangeError) throw new EngineScriptError('LIMIT', 'Script parser recursion budget exceeded')
    throw error
  }
  const analysis = analyze(program, limits), checked = check(program)
  if (checked.diagnostics.length > 0) throw new SuperScriptError(checked.diagnostics[0], checked.diagnostics)
  if (checked.plots.length === 0 || checked.plots.length > limits.plots || checked.inputs.length > limits.inputs) throw new EngineScriptError('LIMIT', 'Script plot/input ceiling exceeded')
  const inputs = Object.freeze(checked.inputs.map(input => {
    if (!Number.isFinite(input.defval) || (input.min !== undefined && !Number.isFinite(input.min)) || (input.max !== undefined && !Number.isFinite(input.max)) ||
      (input.min !== undefined && input.max !== undefined && input.min > input.max) ||
      (input.min !== undefined && input.defval < input.min) || (input.max !== undefined && input.defval > input.max) ||
      (input.step !== undefined && (!Number.isFinite(input.step) || input.step <= 0)) ||
      (input.type === 'int' && [input.min, input.max].some(value => value !== undefined && !Number.isSafeInteger(value)))) {
      throw new EngineScriptError('PARAMS', `Invalid input bounds: ${input.id}`)
    }
    return Object.freeze({ ...input })
  }))
  const initialParams = normalizeParams(inputs, options.params, inputs.map(input => input.defval))
  const guarded = guardProgram(program, analysis.guards)
  const preflight = (params: readonly number[]): { figures: readonly IndicatorFigure[], scan: number } => {
    const result = evaluate(guarded.program, [], params as LangParams)
    const plots = guarded.plots.map((index, i) => ({ ...result.plots[index], id: checked.plots[i].id, title: checked.plots[i].title }))
    if (result.inputs.length !== inputs.length || result.inputs.some((input, i) => {
      const initial = inputs[i]
      return input.id !== initial.id || input.type !== initial.type || input.defval !== initial.defval || input.min !== initial.min || input.max !== initial.max || input.step !== initial.step
    })) throw new EngineScriptError('UNSUPPORTED', 'Input declarations depend on other inputs; use fixed defaults and bounds')
    let scan = 0
    for (let i = 0; i < analysis.guards.length; i++) {
      const guard = analysis.guards[i], value = result.plots[guarded.windows[i]]?.style?.histbase
      if (value === undefined || !Number.isSafeInteger(value) || value < 0 || value > limits.window) throw new EngineScriptError('LIMIT', `Script ${guard.label} exceeds the window ceiling (${limits.window})`)
      if (guard.scan) scan += 2 * value
    }
    return { figures: figuresOf(plots), scan }
  }
  let cachedParams = initialParams, cached = preflight(initialParams)
  const figures = cached.figures
  const validated = (params: readonly number[]): readonly number[] => {
    if (params.length !== inputs.length) throw new EngineScriptError('PARAMS', `Script requires ${inputs.length} inputs`)
    const normalized = normalizeParams(inputs, params, initialParams)
    if (normalized.some((value, i) => value !== cachedParams[i])) {
      const next = preflight(normalized)
      if (!sameFigures(figures, next.figures)) throw new EngineScriptError('UNSUPPORTED', 'These inputs change plot width/base; recompile the script before replacing its definition')
      cached = next; cachedParams = normalized
    }
    return normalized
  }
  const definition: IndicatorDefinition = Object.freeze({
    name: options.name,
    params: initialParams,
    pane: program.overlay ? 'price' as const : 'separate' as const,
    figures,
    validateParams: (params: readonly number[]): void => {
      const normalized = validated(params)
      if (normalized.some((value, i) => value !== params[i])) throw new EngineScriptError('PARAMS', 'Script inputs must respect their numeric bounds and integer type; attachment.setParams normalizes them')
    },
    calculate: (bars: readonly MarketBar[], params: readonly number[]): readonly IndicatorRow[] => {
      const actual = validated(params)
      validateBars(bars, limits)
      if (bars.length * (analysis.nodes + figures.length + 10) > limits.seriesCells || bars.length * (analysis.nodes * 8 + cached.scan) > limits.workUnits) {
        throw new EngineScriptError('LIMIT', 'Script estimated calculation budget exceeded')
      }
      const result = evaluate(program, bars, actual)
      if (!sameFigures(figures, figuresOf(result.plots)) || result.plots.some(plot => plot.values.length !== bars.length)) throw new EngineScriptError('RESULT', 'Script results do not match their declared plots/history')
      return bars.map((_bar, index) => {
        const row: Record<string, number | null> = Object.create(null)
        for (const plot of result.plots) {
          const value = plot.values[index]
          row[plot.id] = typeof value === 'number' && Number.isFinite(value) ? value : null
        }
        return row
      })
    }
  })
  let disposed = false
  const owned = new Map<EngineScriptHost, EngineScriptAttachment>()
  return Object.freeze({
    title: program.title,
    definition,
    inputs,
    limits,
    diagnostics: Object.freeze(checked.diagnostics.map(diagnostic => Object.freeze({ ...diagnostic }))),
    attach: (host: EngineScriptHost, settings: Omit<EngineIndicatorSpec, 'name' | 'params'> & { params?: ScriptParams } = {}): EngineScriptAttachment => {
      if (disposed) throw new EngineScriptError('DISPOSED', 'Script bridge has been disposed')
      if (owned.has(host)) throw new Error('This script is already attached to this host')
      const params = validated(normalizeParams(inputs, settings.params, initialParams))
      host.registerIndicator(definition)
      let id: string
      try { id = host.addIndicator({ ...settings, name: definition.name, params }) } catch (error) {
        try { host.unregisterIndicator(definition.name, definition.calculate) } catch { /* Preserve the original registration error. */ }
        throw error
      }
      let detached = false
      const attachment = Object.freeze({
        id,
        setParams: (given: ScriptParams): readonly number[] => {
          if (detached || disposed) throw new EngineScriptError('DISPOSED', 'Script attachment has been disposed')
          const current = host.listIndicators().find(instance => instance.id === id)
          if (current?.name !== definition.name) throw new Error('Script instance no longer exists')
          const next = validated(normalizeParams(inputs, given, current.params))
          if (!host.updateIndicator(id, { params: next })) throw new Error('Script instance no longer exists')
          return next
        },
        dispose: (): void => {
          if (detached) return
          detached = true; owned.delete(host)
          let failure: unknown, failed = false
          try {
            if (host.listIndicators().some(instance => instance.id === id && instance.name === definition.name)) host.removeIndicator(id)
          } catch (error) { failure = error; failed = true }
          try { host.unregisterIndicator(definition.name, definition.calculate) } catch (error) { if (!failed) { failure = error; failed = true } }
          if (failed) throw failure
        }
      })
      owned.set(host, attachment); return attachment
    },
    dispose: (): void => {
      if (disposed) return
      disposed = true
      let failure: unknown, failed = false
      for (const attachment of [...owned.values()]) {
        try { attachment.dispose() } catch (error) { if (!failed) { failure = error; failed = true } }
      }
      if (failed) throw failure
    }
  })
}
