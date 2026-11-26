/**
 * The SuperScript language: a sticky tokenizer with positions, a parser that
 * turns the whole script into a tree once (at compile time), a checker and an
 * evaluator that runs the tree over bars. Every input the language does not
 * support is reported with its line and column instead of being dropped or
 * turned into a plausible wrong number.
 *
 * Part of Super Chart.
 */
import type { Series } from '@supersolutions/super-chart-core'
import {
  BUILTINS, PINE_ALIASES, PINE_ARG_NAMES, PINE_COLORS, SERIES_NAMES, asSeries, zipValue,
  type Builtin, type BuiltinContext, type PriceSeries, type Value
} from './builtins'
import {
  DiagnosticThrow, SuperScriptError, closest, diag, fail,
  type Diagnostic, type Span
} from './diagnostics'

// These mirror the public types in ./index (kept structurally identical, so
// this module needs nothing from it at runtime).
export interface LangBar { timestamp: number, open: number, high: number, low: number, close: number, volume?: number }
export interface LangPlotStyle {
  color?: string
  lineWidth?: number
  type?: 'line' | 'histogram' | 'circle'
  histbase?: number
  lineStyle?: 'solid' | 'dashed' | 'dotted'
}
export interface LangPlot { id: string, title: string, values: Series, style?: LangPlotStyle, kind?: 'plot' | 'hline' }
export interface LangInput {
  id: string
  title: string
  defval: number
  min?: number
  max?: number
  step?: number
  type: 'int' | 'float'
}
export type LangParams = ReadonlyArray<number | null | undefined> | Readonly<Record<string, number | null | undefined>>

// --------------------------------------------------------------------------
// Tokens
// --------------------------------------------------------------------------

type TokenKind = 'num' | 'str' | 'color' | 'id' | 'op' | 'nl'
interface Token extends Span { k: TokenKind, v: string }

// One alternative per group; `y` (sticky) so nothing is ever skipped silently.
const TOKEN = /([ \t\r\f\v]+)|(\/\/[^\n]*)|(\n)|((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|("[^"\n]*"|'[^'\n]*')|(["'])|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)|(#[0-9A-Fa-f]{3,8}(?![0-9A-Za-z_]))|(:=|\+=|-=|\*=|\/=|=>|==|!=|<=|>=|&&|\|\||[()[\],=+\-*/%<>!?:])/y
const DIRECTIVE_LINE = /[ \t]*@[^\n]*/y

function lex (source: string, diags: Diagnostic[]): Token[] {
  const tokens: Token[] = []
  let line = 1
  let lineStart = 0
  let pos = 0
  let atLineStart = true
  while (pos < source.length) {
    if (atLineStart) {
      atLineStart = false
      // A bare `@title X` line (no //) is a directive, as it always was.
      DIRECTIVE_LINE.lastIndex = pos
      if (DIRECTIVE_LINE.exec(source) !== null) { pos = DIRECTIVE_LINE.lastIndex; continue }
    }
    const col = pos - lineStart + 1
    TOKEN.lastIndex = pos
    const m = TOKEN.exec(source)
    if (m === null) {
      const ch = String.fromCodePoint(source.codePointAt(pos) ?? 0)
      diags.push(diag('error', 'UNEXPECTED_CHAR', `unexpected character '${ch}'`, { line, col, endCol: col + 1 },
        ch === '^' ? 'use pow(a, b) for powers' : ch === ';' ? 'put one statement per line' : undefined))
      pos += ch.length
      continue
    }
    const text = m[0]
    pos = TOKEN.lastIndex
    const at: Span = { line, col, endCol: col + text.length }
    if (m[1] !== undefined || m[2] !== undefined) continue
    if (m[3] !== undefined) {
      tokens.push({ k: 'nl', v: '\n', ...at })
      line++
      lineStart = pos
      atLineStart = true
    } else if (m[4] !== undefined) {
      tokens.push({ k: 'num', v: text, ...at })
    } else if (m[5] !== undefined) {
      tokens.push({ k: 'str', v: text.slice(1, -1), ...at })
    } else if (m[6] !== undefined) {
      diags.push(diag('error', 'UNTERMINATED_STRING', 'this string is never closed', at))
      const end = source.indexOf('\n', pos)
      pos = end < 0 ? source.length : end
    } else if (m[7] !== undefined) {
      tokens.push({ k: 'id', v: text, ...at })
    } else if (m[8] !== undefined) {
      tokens.push({ k: 'color', v: text, ...at })
    } else {
      tokens.push({ k: 'op', v: text, ...at })
    }
  }
  return tokens
}

const CONTINUES = new Set(['+', '-', '*', '/', '%', '<', '>', '<=', '>=', '==', '!=', '&&', '||', '?', ':', '=', ','])

/** Split into statements: one per line, continued inside brackets or after an operator. */
function statements (tokens: Token[], diags: Diagnostic[]): Token[][] {
  const out: Token[][] = []
  let cur: Token[] = []
  const open: Token[] = []
  for (const t of tokens) {
    if (t.k === 'nl') {
      const prev = cur[cur.length - 1]
      const cont = prev !== undefined && ((prev.k === 'op' && CONTINUES.has(prev.v)) || (prev.k === 'id' && (prev.v === 'and' || prev.v === 'or' || prev.v === 'not')))
      if (open.length > 0 || cont) continue
      if (cur.length > 0) out.push(cur)
      cur = []
      continue
    }
    if (t.k === 'op' && (t.v === '(' || t.v === '[')) open.push(t)
    else if (t.k === 'op' && (t.v === ')' || t.v === ']') && open.length > 0) open.pop()
    cur.push(t)
  }
  if (open.length > 0) {
    const o = open[0]
    diags.push(diag('error', 'UNBALANCED', `'${o.v}' is never closed`, o))
  } else if (cur.length > 0) {
    out.push(cur)
  }
  return out
}

// --------------------------------------------------------------------------
// Tree
// --------------------------------------------------------------------------

interface KwArg { name: string, value: Expr, at: Span }
type Expr =
  | { k: 'num', v: number, text: string, at: Span }
  | { k: 'str', v: string, at: Span }
  | { k: 'color', v: string, at: Span }
  | { k: 'na', at: Span }
  | { k: 'id', name: string, at: Span }
  | { k: 'call', name: string, args: Expr[], kw: KwArg[], at: Span, input?: number }
  | { k: 'index', target: Expr, offset: Expr, at: Span }
  | { k: 'unary', op: string, arg: Expr, at: Span }
  | { k: 'bin', op: string, l: Expr, r: Expr, at: Span }
  | { k: 'tern', c: Expr, a: Expr, b: Expr, at: Span }

type Stmt =
  | { k: 'assign', name: string, value: Expr, at: Span }
  | { k: 'plot', value: Expr, title?: string, style: LangPlotStyle, lineWidth?: Expr, histbase?: Expr, at: Span }
  | { k: 'hline', value: Expr, title?: string, style: LangPlotStyle, lineWidth?: Expr, at: Span }
  | { k: 'expr', value: Expr, at: Span }

interface Program {
  statements: Stmt[]
  title: string
  overlay: boolean
  /** Input ids, by input index. */
  inputIds: string[]
  /** Names whose assignment failed to parse: reading them is not reported again. */
  poisoned: Set<string>
  diagnostics: Diagnostic[]
}

const CONTROL = new Set(['if', 'else', 'for', 'while', 'switch', 'return', 'break', 'continue'])
const TYPE_WORDS = new Set(['float', 'int', 'bool', 'string', 'color', 'series', 'simple', 'const'])
const REASSIGN = new Set([':=', '+=', '-=', '*=', '/='])
const DECLARATIONS = new Set(['indicator', 'study', 'strategy'])
const IGNORED_CALLS = new Set(['plotshape', 'plotchar', 'plotarrow', 'plotcandle', 'plotbar', 'bgcolor', 'barcolor', 'fill', 'alertcondition', 'alert'])
const IGNORED_PREFIXES = ['strategy.', 'label.', 'line.', 'box.', 'table.', 'linefill.', 'polyline.', 'log.', 'runtime.']
const INPUTS = new Set(['input', 'input.int', 'input.float'])
/** plot()/hline() keywords that only change looks TradingView offers and Super Chart does not. */
const COSMETIC_KW = new Set(['editable', 'display', 'trackprice', 'show_last', 'join', 'transp', 'force_overlay', 'format', 'precision'])
const INPUT_COSMETIC_KW = new Set(['tooltip', 'group', 'inline', 'confirm', 'display', 'options'])
const PLOT_STYLES = new Map<string, LangPlotStyle['type']>([
  ['plot.style_line', 'line'], ['plot.style_linebr', 'line'], ['plot.style_stepline', 'line'], ['plot.style_area', 'line'],
  ['plot.style_histogram', 'histogram'], ['plot.style_columns', 'histogram'],
  ['plot.style_circles', 'circle'], ['plot.style_cross', 'circle']
])
const HLINE_STYLES = new Map<string, LangPlotStyle['lineStyle']>([
  ['hline.style_dashed', 'dashed'], ['hline.style_dotted', 'dotted'], ['hline.style_solid', 'solid']
])
const PREC = new Map<string, number>([['or', 1], ['||', 1], ['and', 2], ['&&', 2], ['==', 3], ['!=', 3], ['<', 4], ['<=', 4], ['>', 4], ['>=', 4], ['+', 5], ['-', 5], ['*', 6], ['/', 6], ['%', 6]])

/** From the start of `a` to the end of `b` when both are on one line, else `fallback`. */
const span = (a: Span, b: Span, fallback: Span): Span => (a.line === b.line && b.endCol >= a.col ? { line: a.line, col: a.col, endCol: b.endCol } : fallback)

/** Deepest nesting of brackets, calls, ternaries and prefix operators a script may use. Real scripts stay in single digits. */
const MAX_NESTING = 200

class Parser {
  private pos = 0
  private depth = 0
  constructor (private readonly toks: Token[], private readonly inputs: { count: number }) {}

  peek (o = 0): Token | undefined { return this.toks[this.pos + o] }
  atEnd (): boolean { return this.pos >= this.toks.length }
  isOp (v: string, o = 0): boolean { const t = this.peek(o); return t !== undefined && t.k === 'op' && t.v === v }
  isId (v: string, o = 0): boolean { const t = this.peek(o); return t !== undefined && t.k === 'id' && t.v === v }

  next (): Token {
    const t = this.toks[this.pos]
    if (t === undefined) {
      const last = this.toks[this.toks.length - 1]
      fail('UNEXPECTED_TOKEN', 'unexpected end of the statement', { line: last.line, col: last.endCol, endCol: last.endCol + 1 })
    }
    this.pos++
    return t
  }

  expect (v: string): Token {
    const t = this.peek()
    if (t === undefined || t.k !== 'op' || t.v !== v) {
      if (t === undefined) {
        const last = this.toks[this.toks.length - 1]
        fail('UNEXPECTED_TOKEN', `expected '${v}' at the end of the statement`, { line: last.line, col: last.endCol, endCol: last.endCol + 1 })
      }
      fail('UNEXPECTED_TOKEN', `expected '${v}', found '${t.v}'`, t)
    }
    this.pos++
    return t
  }

  /** Nothing may follow a complete statement. */
  end (): void {
    const t = this.peek()
    if (t !== undefined) {
      fail('TRAILING_TOKENS', `unexpected '${t.v === '\n' ? '\\n' : t.v}' after the end of the statement`, t,
        t.k === 'op' && t.v === '^' ? 'use pow(a, b) for powers' : 'put one statement per line; is an operator or a comma missing?')
    }
  }

  /** Count one level of recursion; a script nested past MAX_NESTING is a diagnostic, not a stack overflow. */
  private enter (at: Token | undefined): void {
    if (++this.depth > MAX_NESTING) {
      const where = at ?? this.toks[this.toks.length - 1]
      fail('UNSUPPORTED', `this expression is nested more than ${MAX_NESTING} levels deep`, where, 'split it into several named steps')
    }
  }

  expr (): Expr {
    this.enter(this.peek())
    const c = this.binary(1)
    if (this.isOp('?')) {
      const q = this.next()
      const a = this.expr()
      this.expect(':')
      const b = this.expr()
      this.depth--
      return { k: 'tern', c, a, b, at: span(c.at, b.at, q) }
    }
    this.depth--
    return c
  }

  binary (min: number): Expr {
    let l = this.unary()
    for (;;) {
      const t = this.peek()
      if (t === undefined || (t.k !== 'op' && t.k !== 'id')) return l
      const p = PREC.get(t.v)
      if (p === undefined || p < min) return l
      this.pos++
      const r = this.binary(p + 1)
      l = { k: 'bin', op: t.v === 'and' ? '&&' : t.v === 'or' ? '||' : t.v, l, r, at: span(l.at, r.at, t) }
    }
  }

  unary (): Expr {
    const t = this.peek()
    if (t !== undefined && ((t.k === 'op' && (t.v === '-' || t.v === '+' || t.v === '!')) || (t.k === 'id' && t.v === 'not'))) {
      this.pos++
      this.enter(t)
      const arg = this.unary()
      this.depth--
      return { k: 'unary', op: t.v === '!' ? 'not' : t.v, arg, at: span(t, arg.at, t) }
    }
    return this.postfix()
  }

  postfix (): Expr {
    let e = this.primary()
    while (this.isOp('[')) {
      const open = this.next()
      const offset = this.expr()
      const close = this.expect(']')
      e = { k: 'index', target: e, offset, at: span(e.at, close, open) }
    }
    return e
  }

  primary (): Expr {
    const t = this.next()
    switch (t.k) {
      case 'num': return { k: 'num', v: parseFloat(t.v), text: t.v, at: t }
      case 'str': return { k: 'str', v: t.v, at: t }
      case 'color': return { k: 'color', v: t.v, at: t }
      case 'op':
        if (t.v === '(') { const e = this.expr(); this.expect(')'); return e }
        if (REASSIGN.has(t.v)) fail('REASSIGNMENT', `'${t.v}' is not supported`, t, reassignHint(t.v))
        return fail('UNEXPECTED_TOKEN', `unexpected '${t.v}'`, t)
      case 'id': {
        if (t.v === 'true' || t.v === 'false') return { k: 'num', v: t.v === 'true' ? 1 : 0, text: t.v, at: t }
        if (this.isOp('(')) return this.call(t)
        if (t.v === 'na') return { k: 'na', at: t }
        const color = PINE_COLORS.get(t.v)
        if (color !== undefined) return { k: 'color', v: color, at: t }
        return { k: 'id', name: t.v, at: t }
      }
      default: return fail('UNEXPECTED_TOKEN', 'unexpected end of line', t)
    }
  }

  call (name: Token): Expr {
    const node: Expr = { k: 'call', name: name.v, args: [], kw: [], at: name }
    // Numbered in source order, before the arguments (an input inside an input's arguments is an error anyway).
    if (INPUTS.has(name.v)) node.input = this.inputs.count++
    this.expect('(')
    if (this.isOp(')')) { this.next(); return node }
    for (;;) {
      const t = this.peek()
      if (t !== undefined && t.k === 'id' && this.isOp('=', 1)) {
        this.pos += 2
        node.kw.push({ name: t.v, value: this.expr(), at: t })
      } else {
        const e = this.expr()
        if (node.kw.length > 0) fail('UNEXPECTED_TOKEN', 'a positional argument cannot follow a keyword argument', e.at)
        node.args.push(e)
      }
      if (this.isOp(',')) { this.next(); continue }
      this.expect(')')
      return node
    }
  }
}

function reassignHint (op: string): string {
  return op === ':='
    ? 'SuperScript bindings are single-assignment series, so Pine\'s recursive `x := f(x[1])` cannot be expressed; bind a new name instead'
    : `write it out: x2 = x ${op[0]} …`
}

interface Directives { title?: string, overlay: boolean }

function directives (source: string): Directives {
  const title = /@title[ \t]+([^\n]+)/.exec(source)
  const overlay = /(^|\n)[ \t]*(\/\/[ \t]*)?@overlay\b/.test(source)
  const d: Directives = { overlay }
  if (title !== null) d.title = title[1].replace(/\r$/, '').trim()
  return d
}

/** Parse the whole script. Never throws: problems become diagnostics. */
export function parse (source: string): Program {
  const diagnostics: Diagnostic[] = []
  const dir = directives(source)
  const program: Program = { statements: [], title: dir.title ?? 'SuperScript', overlay: dir.overlay, inputIds: [], poisoned: new Set(), diagnostics }
  const inputs = { count: 0 }
  const assignedInputs = new Map<number, string>()
  const tokens = lex(source, diagnostics)
  const badLines = new Set(diagnostics.map((d) => d.line))
  for (const toks of statements(tokens, diagnostics)) {
    const first = inputs.count
    if (toks.some((t) => badLines.has(t.line))) {
      // Already reported by the tokenizer; parsing the rest would only add noise.
      const target = toks.find((t, i) => t.k === 'id' && toks[i + 1]?.k === 'op' && toks[i + 1].v === '=')
      if (target !== undefined) program.poisoned.add(target.v)
      continue
    }
    try {
      const st = statement(toks, new Parser(toks, inputs), program, dir, diagnostics)
      if (st === null) continue
      program.statements.push(st)
      if (st.k === 'assign' && st.value.k === 'call' && st.value.input !== undefined) assignedInputs.set(st.value.input, st.name)
    } catch (e) {
      if (!(e instanceof DiagnosticThrow)) throw e
      diagnostics.push(e.diagnostic)
      // Inputs numbered in a statement that failed to parse are dropped again.
      inputs.count = first
      const target = toks.find((t, i) => t.k === 'id' && toks[i + 1]?.k === 'op' && (toks[i + 1].v === '=' || REASSIGN.has(toks[i + 1].v)))
      if (target !== undefined) program.poisoned.add(target.v)
    }
  }
  const used = new Set<string>()
  for (let i = 0; i < inputs.count; i++) {
    let id = assignedInputs.get(i) ?? `in${i}`
    if (used.has(id)) id = `${id}_${i}`
    used.add(id)
    program.inputIds.push(id)
  }
  return program
}

function statement (toks: Token[], p: Parser, program: Program, dir: Directives, diags: Diagnostic[]): Stmt | null {
  const arrow = toks.find((t) => t.k === 'op' && t.v === '=>')
  if (arrow !== undefined) fail('FUNCTION_DEF', 'function definitions are not supported', arrow, 'inline the expression, or bind it to a name')
  let t0 = toks[0]
  if (t0.k === 'id' && CONTROL.has(t0.v)) {
    fail('CONTROL_FLOW', `'${t0.v}' is not supported`, t0, 'SuperScript works on whole series: use cond ? a : b instead of if/else, and sum()/highest()/… instead of loops')
  }
  // `var x = …` and `float x = …` declare nothing extra in a single-assignment language.
  while (t0.k === 'id' && (t0.v === 'var' || t0.v === 'varip' || TYPE_WORDS.has(t0.v)) && p.peek(1)?.k === 'id') {
    diags.push(diag('warning', 'IGNORED_KEYWORD', `'${t0.v}' is ignored`, t0, t0.v.startsWith('var') ? 'SuperScript bindings are series; var has no effect' : undefined))
    p.next()
    t0 = p.peek() as Token
  }
  const t1 = p.peek(1)
  if (t0.k === 'id' && t1 !== undefined && t1.k === 'op' && REASSIGN.has(t1.v)) {
    fail('REASSIGNMENT', `'${t1.v}' is not supported`, t1, reassignHint(t1.v))
  }
  if (t0.k === 'id' && t1 !== undefined && t1.k === 'op' && t1.v === '=') {
    if (SERIES_NAMES.includes(t0.v)) fail('BUILTIN_REASSIGNED', `'${t0.v}' is a built-in series and cannot be assigned`, t0, 'bind a new name')
    if (t0.v.includes('.') || t0.v === 'na' || t0.v === 'true' || t0.v === 'false') fail('UNEXPECTED_TOKEN', `'${t0.v}' cannot be assigned`, t0)
    p.next(); p.next()
    const value = p.expr()
    p.end()
    return { k: 'assign', name: t0.v, value, at: t0 }
  }
  if (t0.k === 'id' && p.isOp('(', 1)) {
    if (t0.v === 'plot') return plotStatement(p, diags)
    if (t0.v === 'hline') return hlineStatement(p, diags)
    if (DECLARATIONS.has(t0.v)) {
      const call = p.primary()
      p.end()
      if (call.k === 'call') declaration(call, program, dir, diags)
      return null
    }
    if (IGNORED_CALLS.has(t0.v) || IGNORED_PREFIXES.some((x) => t0.v.startsWith(x))) {
      diags.push(diag('warning', 'IGNORED_STATEMENT', `${t0.v}() is not supported and is ignored`, t0))
      return null
    }
  }
  const value = p.expr()
  p.end()
  diags.push(diag('warning', 'UNUSED_EXPRESSION', 'this expression is computed but not used', value.at, 'bind it (x = …) or draw it (plot(…))'))
  return { k: 'expr', value, at: value.at }
}

function declaration (call: Extract<Expr, { k: 'call' }>, program: Program, dir: Directives, diags: Diagnostic[]): void {
  if (call.name === 'strategy') {
    diags.push(diag('warning', 'IGNORED_STATEMENT', 'strategy() is not supported; orders are ignored and the script runs as an indicator', call.at))
  }
  let title: string | undefined
  const a0 = call.args[0]
  if (a0 !== undefined && a0.k === 'str') title = a0.v
  const kw = call.kw.find((k) => k.name === 'title')?.value
  if (kw !== undefined && kw.k === 'str') title = kw.v
  if (dir.title === undefined && title !== undefined) program.title = title
  const ov = call.kw.find((k) => k.name === 'overlay')?.value
  if (ov !== undefined && ov.k === 'num' && ov.v === 1) program.overlay = true
}

/** A colour value: "#rrggbb", "red", #rrggbb or color.red. */
function colorOf (e: Expr, diags: Diagnostic[]): string | undefined {
  if (e.k === 'str' || e.k === 'color') return e.v
  if (e.k === 'call' && e.name === 'color.new') {
    fail('UNSUPPORTED', 'color.new() is not supported', e.at, 'write the colour with its alpha as "#rrggbbaa"')
  }
  diags.push(diag('warning', 'IGNORED_KEYWORD', 'a colour must be a constant such as "#ff6d00" or color.red; the default colour is used', e.at))
  return undefined
}

function stringOf (e: Expr, what: string, diags: Diagnostic[]): string | undefined {
  if (e.k === 'str') return e.v
  diags.push(diag('warning', 'IGNORED_KEYWORD', `${what} must be a string; ignored`, e.at))
  return undefined
}

function plotStatement (p: Parser, diags: Diagnostic[]): Stmt {
  const call = p.primary()
  p.end()
  if (call.k !== 'call') return fail('UNEXPECTED_TOKEN', 'expected plot(…)', call.at)
  const [value, title, color, lineWidth, style] = call.args
  if (value === undefined) fail('ARITY', 'plot() needs a value to draw', call.at)
  if (call.args.length > 5) fail('ARITY', 'plot() takes at most 5 positional arguments (value, title, color, linewidth, style)', call.args[5].at)
  const st: Extract<Stmt, { k: 'plot' }> = { k: 'plot', value, style: {}, at: call.at }
  const setType = (e: Expr): void => {
    const s = e.k === 'str' ? e.v : e.k === 'id' ? e.name : ''
    const mapped = s === 'line' || s === 'histogram' || s === 'circle' ? s : PLOT_STYLES.get(s)
    if (mapped === undefined) diags.push(diag('warning', 'UNKNOWN_KEYWORD', `unknown plot type '${s}'; drawn as a line`, e.at, 'type="line", "histogram" or "circle"'))
    else st.style.type = mapped
  }
  if (title !== undefined) st.title = stringOf(title, 'the title', diags)
  if (color !== undefined) st.style.color = colorOf(color, diags)
  if (lineWidth !== undefined) st.lineWidth = lineWidth
  if (style !== undefined) setType(style)
  const seen = new Set<string>()
  for (const kw of call.kw) {
    if (seen.has(kw.name)) fail('DUPLICATE_ARGUMENT', `'${kw.name}' is given twice`, kw.at)
    seen.add(kw.name)
    switch (kw.name) {
      case 'title': st.title = stringOf(kw.value, 'the title', diags); break
      case 'color': st.style.color = colorOf(kw.value, diags); break
      case 'type': case 'style': setType(kw.value); break
      case 'lineWidth': case 'linewidth': st.lineWidth = kw.value; break
      case 'histbase': st.histbase = kw.value; break
      default:
        if (!COSMETIC_KW.has(kw.name)) diags.push(diag('warning', 'UNKNOWN_KEYWORD', `unknown plot() keyword '${kw.name}' is ignored`, kw.at, 'plot(value, title=, color=, type=, lineWidth=, histbase=)'))
    }
  }
  if (st.title === undefined) delete st.title
  if (st.style.color === undefined) delete st.style.color
  return st
}

function hlineStatement (p: Parser, diags: Diagnostic[]): Stmt {
  const call = p.primary()
  p.end()
  if (call.k !== 'call') return fail('UNEXPECTED_TOKEN', 'expected hline(…)', call.at)
  const [value, title, color] = call.args
  if (value === undefined) fail('ARITY', 'hline() needs a price', call.at)
  if (call.args.length > 3) fail('ARITY', 'hline() takes at most 3 positional arguments (price, title, color)', call.args[3].at)
  const st: Extract<Stmt, { k: 'hline' }> = { k: 'hline', value, style: { lineStyle: 'dashed' }, at: call.at }
  if (title !== undefined) st.title = stringOf(title, 'the title', diags)
  if (color !== undefined) st.style.color = colorOf(color, diags)
  for (const kw of call.kw) {
    switch (kw.name) {
      case 'title': st.title = stringOf(kw.value, 'the title', diags); break
      case 'color': st.style.color = colorOf(kw.value, diags); break
      case 'linestyle': case 'lineStyle': {
        const v = kw.value.k === 'id' ? HLINE_STYLES.get(kw.value.name) : kw.value.k === 'str' ? kw.value.v : undefined
        if (v === 'solid' || v === 'dashed' || v === 'dotted') st.style.lineStyle = v
        else diags.push(diag('warning', 'UNKNOWN_KEYWORD', 'unknown line style; dashed is used', kw.value.at))
        break
      }
      case 'linewidth': case 'lineWidth': st.lineWidth = kw.value; break
      default:
        if (!COSMETIC_KW.has(kw.name)) diags.push(diag('warning', 'UNKNOWN_KEYWORD', `unknown hline() keyword '${kw.name}' is ignored`, kw.at))
    }
  }
  if (st.title === undefined) delete st.title
  if (st.style.color === undefined) delete st.style.color
  return st
}

// --------------------------------------------------------------------------
// Evaluation
// --------------------------------------------------------------------------

/** Thrown when an expression reads a name whose own statement failed (reported once, there). */
class Poisoned extends Error {}

export interface Evaluation { plots: LangPlot[], inputs: LangInput[], diagnostics: Diagnostic[] }

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

class Evaluator implements BuiltinContext {
  readonly n: number
  private readonly cache = new Map<string, Series>()
  private readonly vars = new Map<string, Value>()
  private readonly poisoned: Set<string>
  readonly inputs: LangInput[] = []
  readonly diagnostics: Diagnostic[] = []

  constructor (private readonly program: Program, private readonly bars: readonly LangBar[], private readonly params: LangParams | undefined, private readonly check: boolean) {
    this.n = bars.length
    this.poisoned = new Set(program.poisoned)
  }

  series (name: PriceSeries | 'time'): Series {
    return this.base(name)
  }

  private base (name: string): Series {
    const hit = this.cache.get(name)
    if (hit !== undefined) return hit
    const f = (v: number | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v)
    const b = this.bars
    let s: Series
    switch (name) {
      case 'open': s = b.map((x) => f(x.open)); break
      case 'high': s = b.map((x) => f(x.high)); break
      case 'low': s = b.map((x) => f(x.low)); break
      case 'close': s = b.map((x) => f(x.close)); break
      case 'volume': s = b.map((x) => f(x.volume)); break
      case 'hl2': s = b.map((x) => f((x.high + x.low) / 2)); break
      case 'hlc3': s = b.map((x) => f((x.high + x.low + x.close) / 3)); break
      case 'ohlc4': s = b.map((x) => f((x.open + x.high + x.low + x.close) / 4)); break
      case 'bar_index': s = b.map((_x, i) => i); break
      default: s = b.map((x) => f(x.timestamp))
    }
    this.cache.set(name, s)
    return s
  }

  run (): Evaluation {
    const plots: LangPlot[] = []
    for (const st of this.program.statements) {
      try {
        switch (st.k) {
          case 'assign':
            this.vars.set(st.name, this.eval(st.value))
            this.poisoned.delete(st.name)
            break
          case 'plot': {
            const values = asSeries(this.eval(st.value), this.n)
            const style: LangPlotStyle = { ...st.style }
            if (st.lineWidth !== undefined) style.lineWidth = this.constant(st.lineWidth, 'lineWidth')
            if (st.histbase !== undefined) style.histbase = this.constant(st.histbase, 'histbase')
            plots.push({ id: `p${plots.length}`, title: st.title ?? `plot ${plots.length + 1}`, values, style })
            break
          }
          case 'hline': {
            const price = this.eval(st.value)
            if (typeof price !== 'number') fail('EXPECTED_CONSTANT', 'hline() draws a constant price; use plot() for a series', st.value.at)
            const style: LangPlotStyle = { ...st.style }
            if (st.lineWidth !== undefined) style.lineWidth = this.constant(st.lineWidth, 'linewidth')
            plots.push({ id: `p${plots.length}`, title: st.title ?? '', values: asSeries(price, this.n), style, kind: 'hline' })
            break
          }
          default: this.eval(st.value)
        }
      } catch (e) {
        if (st.k === 'assign') this.poisoned.add(st.name)
        if (e instanceof Poisoned) continue
        if (!(e instanceof DiagnosticThrow)) throw e
        if (!this.check) throw new SuperScriptError(e.diagnostic)
        this.diagnostics.push(e.diagnostic)
      }
    }
    return { plots, inputs: this.inputs, diagnostics: this.diagnostics }
  }

  private constant (e: Expr, what: string): number {
    const v = this.eval(e)
    if (typeof v !== 'number' || !Number.isFinite(v)) fail('EXPECTED_CONSTANT', `${what} must be a constant number`, e.at)
    return v
  }

  eval (e: Expr): Value {
    switch (e.k) {
      case 'num': return Number.isFinite(e.v) ? e.v : NaN // 1e999
      case 'str': return fail('TYPE', 'a string is only allowed as a title or a colour', e.at)
      case 'color': return fail('TYPE', 'a colour is only allowed as a plot()/hline() colour', e.at)
      case 'na': return asSeries(NaN, this.n)
      case 'id': return this.identifier(e.name, e.at)
      case 'index': {
        const target = this.eval(e.target)
        const off = this.eval(e.offset)
        if (typeof off !== 'number') {
          fail('BAD_OFFSET', 'a history offset must be a constant (a number, an input, or arithmetic on them)', e.offset.at, 'offsets that vary bar by bar are not supported')
        }
        if (!Number.isInteger(off) || off < 0) {
          fail('BAD_OFFSET', `a history offset must be a whole number >= 0, got ${off}`, e.offset.at, off < 0 ? 'a negative offset would read future bars' : undefined)
        }
        return shift(asSeries(target, this.n), off)
      }
      case 'unary': {
        const v = this.eval(e.arg)
        if (e.op === '-') return typeof v === 'number' ? -v : v.map((x) => (x == null ? null : -x))
        if (e.op === '+') return v
        return typeof v === 'number' ? (Number.isNaN(v) ? NaN : v === 0 ? 1 : 0) : v.map((x) => (x == null ? null : x === 0 ? 1 : 0))
      }
      case 'bin': {
        const l = this.eval(e.l)
        const r = this.eval(e.r)
        return zipValue(l, r, BINARY[e.op], this.n)
      }
      case 'tern': {
        const c = this.eval(e.c)
        const a = this.eval(e.a)
        const b = this.eval(e.b)
        if (typeof c === 'number') {
          if (Number.isNaN(c)) return typeof a === 'number' && typeof b === 'number' ? NaN : asSeries(NaN, this.n)
          return c !== 0 ? a : b
        }
        const as = asSeries(a, this.n)
        const bs = asSeries(b, this.n)
        return c.map((cv, i) => (cv == null ? null : cv !== 0 ? as[i] : bs[i]))
      }
      case 'call': return this.call(e)
    }
  }

  private identifier (name: string, at: Span): Value {
    const bound = this.vars.get(name)
    if (bound !== undefined) return bound
    if (this.poisoned.has(name)) throw new Poisoned()
    if (SERIES_NAMES.includes(name)) return this.base(name)
    // Pine's ta.tr and ta.obv are variables.
    if (name === 'ta.tr') return (BUILTINS.get('tr') as Builtin).impl([], this)
    if (name === 'ta.obv') return (BUILTINS.get('obv') as Builtin).impl([], this)
    if (name === 'ta.vwap') return fail('PINE_MISMATCH', 'Pine\'s ta.vwap resets every session; SuperScript\'s vwap() is cumulative from the first bar', at, 'write vwap() if that is what you want')
    if (BUILTINS.has(name) || PINE_ALIASES.has(name)) return fail('TYPE', `'${name}' is a function: call it as ${name}(…)`, at)
    if (name.startsWith('color.')) return fail('TYPE', 'a colour is only allowed as a plot()/hline() colour', at)
    const guess = closest(name, [...SERIES_NAMES, ...this.vars.keys(), 'na'])
    return fail('UNKNOWN_IDENTIFIER', `unknown identifier '${name}'`, at, guess !== undefined ? `did you mean '${guess}'?` : undefined)
  }

  private call (e: Extract<Expr, { k: 'call' }>): Value {
    const name = e.name
    if (e.input !== undefined) return this.input(e, e.input)
    if (name === 'plot' || name === 'hline') return fail('STATEMENT', `${name}() is a statement: put it on its own line`, e.at)
    if (name.startsWith('input.')) return fail('UNSUPPORTED', `${name}() is not supported`, e.at, 'only numeric inputs: input(), input.int(), input.float()')
    if (name.startsWith('request.')) return fail('UNSUPPORTED', `${name}() is not supported`, e.at, 'a script sees only the chart\'s own symbol and timeframe')
    if (name === 'color.new' || name.startsWith('color.')) return fail('TYPE', 'a colour is only allowed as a plot()/hline() colour', e.at)
    const pine = this.pineAdapter(e)
    if (pine !== undefined) return pine
    const b = BUILTINS.get(PINE_ALIASES.get(name) ?? name)
    if (b === undefined) {
      const guess = closest(name, [...BUILTINS.keys(), ...PINE_ALIASES.keys()])
      return fail('UNKNOWN_FUNCTION', `unknown function '${name}'`, e.at, guess !== undefined ? `did you mean '${guess}'?` : undefined)
    }
    return this.callBuiltin(b, this.bind(b, e))
  }

  /** Pine calls whose SuperScript form takes different arguments: accepted only when the meaning is the same. */
  private pineAdapter (e: Extract<Expr, { k: 'call' }>): Value | undefined {
    const isId = (x: Expr | undefined, id: string): boolean => x !== undefined && x.k === 'id' && x.name === id
    const [a0, a1, a2, a3] = e.args
    switch (e.name) {
      case 'ta.cci':
      case 'ta.mfi': {
        const target = e.name.slice(3)
        if (e.args.length === 2 && e.kw.length === 0 && isId(a0, 'hlc3')) return this.callBuiltin(BUILTINS.get(target) as Builtin, [this.argument(BUILTINS.get(target) as Builtin, 0, a1)])
        return fail('PINE_MISMATCH', `SuperScript's ${target}(len) always uses hlc3`, e.at, target === 'cci' ? 'write cci(len) for hlc3, or (src - sma(src,len)) / (0.015 * dev(src,len)) for another source' : `write ${target}(len)`)
      }
      case 'ta.stoch':
        if (e.args.length === 4 && e.kw.length === 0 && isId(a0, 'close') && isId(a1, 'high') && isId(a2, 'low')) return this.callBuiltin(BUILTINS.get('stoch') as Builtin, [this.argument(BUILTINS.get('stoch') as Builtin, 0, a3)])
        return fail('PINE_MISMATCH', 'SuperScript\'s stoch(len) is %K of close within high/low', e.at, 'write stoch(len)')
      case 'ta.vwap':
        return fail('PINE_MISMATCH', 'Pine\'s ta.vwap resets every session; SuperScript\'s vwap() is cumulative from the first bar', e.at, 'write vwap() if that is what you want')
      default: return undefined
    }
  }

  /** Positional and keyword arguments to one value per parameter (defaults filled). */
  private bind (b: Builtin, e: Extract<Expr, { k: 'call' }>): Value[] {
    const shown = `${b.name}(${b.params.map((p) => p.name).join(', ')})`
    if (e.args.length > b.params.length) {
      fail('ARITY', `${b.name}() takes ${b.params.length === 0 ? 'no arguments' : `at most ${b.params.length} (${b.params.map((p) => p.name).join(', ')})`}, got ${e.args.length}`, e.args[b.params.length].at, `write ${shown}`)
    }
    const given: Array<Expr | undefined> = b.params.map((_p, i) => e.args[i])
    for (const kw of e.kw) {
      const pname = PINE_ARG_NAMES.get(kw.name) ?? kw.name
      const i = b.params.findIndex((p) => p.name === pname)
      if (i < 0) fail('UNKNOWN_ARGUMENT', `${b.name}() has no argument '${kw.name}'`, kw.at, `write ${shown}`)
      if (given[i] !== undefined) fail('DUPLICATE_ARGUMENT', `'${b.params[i].name}' is given twice`, kw.at)
      given[i] = kw.value
    }
    return b.params.map((p, i) => {
      const g = given[i]
      if (g === undefined) {
        if (p.default !== undefined) return p.default
        return fail('ARITY', `${b.name}() needs ${p.name}`, e.at, `write ${shown}`)
      }
      return this.argument(b, i, g)
    })
  }

  private argument (b: Builtin, i: number, e: Expr): Value {
    const p = b.params[i]
    const v = this.eval(e)
    if (p.kind === 'series') return v
    if (typeof v !== 'number') {
      const lengthOnly = b.params.length === 1 && (b.name === 'cci' || b.name === 'mfi' || b.name === 'stoch' || b.name === 'atr')
      return fail('EXPECTED_CONSTANT', `${b.name}()'s ${p.name} must be a constant (a number, an input, or arithmetic on them), not a series`, e.at,
        lengthOnly ? `SuperScript's ${b.name}() takes only the length: ${b.name}(len)` : undefined)
    }
    if (p.kind === 'number') {
      if (!Number.isFinite(v)) fail('EXPECTED_CONSTANT', `${b.name}()'s ${p.name} must be a finite number`, e.at)
      return v
    }
    const min = p.kind === 'count' ? 0 : p.min ?? 1
    if (!Number.isInteger(v) || v < min || (p.max !== undefined && v > p.max)) {
      const range = p.max === undefined ? `>= ${min}` : `from ${min} to ${p.max}`
      fail('BAD_LENGTH', `${b.name}()'s ${p.name} must be a whole number ${range}, got ${Number.isNaN(v) ? 'na' : v}`, e.at)
    }
    return v
  }

  private callBuiltin (b: Builtin, args: Value[]): Value {
    return b.impl(args, this)
  }

  private input (e: Extract<Expr, { k: 'call' }>, index: number): Value {
    const at = e.at
    const [d, t] = e.args
    if (d === undefined) fail('ARITY', `${e.name}() needs a default value`, at, `write ${e.name}(14, title="Length")`)
    if (e.args.length > 2) fail('ARITY', `${e.name}() takes at most 2 positional arguments (default, title)`, e.args[2].at, 'pass minval=, maxval=, step= by keyword')
    const num = (x: Expr, what: string): number => {
      const v = this.eval(x)
      if (typeof v !== 'number' || !Number.isFinite(v)) fail('EXPECTED_CONSTANT', `${e.name}()'s ${what} must be a constant number`, x.at)
      return v
    }
    const defval = num(d, 'default')
    let title: string | undefined
    if (t !== undefined) {
      if (t.k !== 'str') fail('TYPE', `${e.name}()'s second argument is its title and must be a string`, t.at)
      title = t.v
    }
    const input: LangInput = {
      id: this.program.inputIds[index] ?? `in${index}`,
      title: '',
      defval,
      type: e.name === 'input.float' ? 'float' : e.name === 'input.int' ? 'int' : d.k === 'num' && /[.eE]/.test(d.text) ? 'float' : Number.isInteger(defval) ? 'int' : 'float'
    }
    const seen = new Set<string>()
    for (const kw of e.kw) {
      if (seen.has(kw.name)) fail('DUPLICATE_ARGUMENT', `'${kw.name}' is given twice`, kw.at)
      seen.add(kw.name)
      switch (kw.name) {
        case 'title':
          if (title !== undefined) fail('DUPLICATE_ARGUMENT', 'the title is given twice', kw.at)
          if (kw.value.k !== 'str') fail('TYPE', 'title must be a string', kw.value.at)
          title = kw.value.v
          break
        case 'defval': fail('DUPLICATE_ARGUMENT', 'the default is given twice', kw.at); break
        case 'minval': input.min = num(kw.value, 'minval'); break
        case 'maxval': input.max = num(kw.value, 'maxval'); break
        case 'step': input.step = num(kw.value, 'step'); break
        default:
          if (!INPUT_COSMETIC_KW.has(kw.name)) fail('UNKNOWN_ARGUMENT', `${e.name}() has no argument '${kw.name}'`, kw.at, `write ${e.name}(14, title="Length", minval=1, maxval=100, step=1)`)
      }
    }
    input.title = title ?? input.id
    if (input.type === 'int' && !Number.isInteger(input.defval)) input.type = 'float'
    this.inputs[index] = input
    return resolveParam(input, index, this.params)
  }
}

const BINARY: Record<string, (x: number, y: number) => number> = {
  '+': (x, y) => x + y,
  '-': (x, y) => x - y,
  '*': (x, y) => x * y,
  '/': (x, y) => x / y,
  '%': (x, y) => x % y,
  '<': (x, y) => (x < y ? 1 : 0),
  '<=': (x, y) => (x <= y ? 1 : 0),
  '>': (x, y) => (x > y ? 1 : 0),
  '>=': (x, y) => (x >= y ? 1 : 0),
  '==': (x, y) => (x === y ? 1 : 0),
  '!=': (x, y) => (x !== y ? 1 : 0),
  '&&': (x, y) => (x !== 0 && y !== 0 ? 1 : 0),
  '||': (x, y) => (x !== 0 || y !== 0 ? 1 : 0)
}

function shift (s: Series, n: number): Series {
  if (n <= 0) return s
  return s.map((_v, i) => (i - n >= 0 ? s[i - n] : null))
}

/** The value input `index` takes: the host's parameter (by position or id), clamped, or its default. */
function resolveParam (input: LangInput, index: number, params: LangParams | undefined): number {
  let v: number | null | undefined
  if (Array.isArray(params)) v = (params as ReadonlyArray<number | null | undefined>)[index]
  else if (params !== undefined && hasOwn(params, input.id)) v = (params as Readonly<Record<string, number | null | undefined>>)[input.id]
  if (typeof v !== 'number' || !Number.isFinite(v)) return input.defval
  if (input.type === 'int') v = Math.round(v)
  if (input.min !== undefined) v = Math.max(v, input.min)
  if (input.max !== undefined) v = Math.min(v, input.max)
  return v
}

/** Check a parsed program: parse diagnostics plus a dry run over no bars with the defaults. */
export function check (program: Program): Evaluation {
  const ev = new Evaluator(program, [], undefined, true).run()
  const diagnostics = [...program.diagnostics, ...ev.diagnostics]
  if (diagnostics.every((d) => d.severity !== 'error') && ev.plots.length === 0) {
    diagnostics.push(diag('warning', 'NO_PLOTS', 'the script draws nothing', { line: 1, col: 1, endCol: 1 }, 'add plot(…)'))
  }
  diagnostics.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.col - b.col))
  return { plots: ev.plots, inputs: ev.inputs, diagnostics }
}

/** Evaluate a checked program over bars. Throws SuperScriptError (with a position) for a parameter-dependent problem. */
export function evaluate (program: Program, bars: readonly LangBar[], params?: LangParams): Evaluation {
  return new Evaluator(program, bars, params, false).run()
}
