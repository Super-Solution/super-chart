/**
 * SuperScript diagnostics: every problem has a severity, a code, a message and
 * a 1-based position, so a person, an editor or an AI repair loop can act on
 * it. Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */

export type DiagnosticSeverity = 'error' | 'warning'

/**
 * Codes are stable; messages may be reworded.
 *
 * Errors (the script does not compile):
 * UNEXPECTED_CHAR, UNTERMINATED_STRING, UNEXPECTED_TOKEN, TRAILING_TOKENS,
 * UNBALANCED, REASSIGNMENT (`:=`, `+=`, …), CONTROL_FLOW (`if`, `for`, …),
 * FUNCTION_DEF (`f(x) => …`), BUILTIN_REASSIGNED, UNKNOWN_IDENTIFIER,
 * UNKNOWN_FUNCTION, ARITY, UNKNOWN_ARGUMENT, DUPLICATE_ARGUMENT,
 * EXPECTED_CONSTANT, BAD_LENGTH, BAD_OFFSET, TYPE, PINE_MISMATCH,
 * UNSUPPORTED, STATEMENT (`plot()` inside an expression).
 *
 * Warnings (the script compiles; the part named is ignored):
 * IGNORED_STATEMENT (plotshape, bgcolor, strategy.*, …), UNUSED_EXPRESSION,
 * IGNORED_KEYWORD (var, float, …), UNKNOWN_KEYWORD (an unknown plot()
 * keyword), NO_PLOTS.
 */
export type DiagnosticCode =
  | 'UNEXPECTED_CHAR' | 'UNTERMINATED_STRING' | 'UNEXPECTED_TOKEN' | 'TRAILING_TOKENS' | 'UNBALANCED'
  | 'REASSIGNMENT' | 'CONTROL_FLOW' | 'FUNCTION_DEF' | 'BUILTIN_REASSIGNED'
  | 'UNKNOWN_IDENTIFIER' | 'UNKNOWN_FUNCTION' | 'ARITY' | 'UNKNOWN_ARGUMENT' | 'DUPLICATE_ARGUMENT'
  | 'EXPECTED_CONSTANT' | 'BAD_LENGTH' | 'BAD_OFFSET' | 'TYPE' | 'PINE_MISMATCH' | 'UNSUPPORTED' | 'STATEMENT'
  | 'IGNORED_STATEMENT' | 'UNUSED_EXPRESSION' | 'IGNORED_KEYWORD' | 'UNKNOWN_KEYWORD' | 'NO_PLOTS'

export interface Diagnostic {
  severity: DiagnosticSeverity
  code: DiagnosticCode
  message: string
  /** 1-based line. */
  line: number
  /** 1-based column of the first character. */
  col: number
  /** 1-based column just past the last character. */
  endCol: number
  /** A suggested fix, when there is one. */
  hint?: string
}

/** Where a node or token sits in the source. */
export interface Span { line: number, col: number, endCol: number }

const BRAND = Symbol.for('zzyzx.superscript.error')

/**
 * Thrown by `compile()` for the first error (all diagnostics are on
 * `diagnostics`) and by `run()` for a problem that only shows with real
 * parameters. Identify it with `isSuperScriptError(e)`: the `.` and `./lite`
 * CommonJS/UMD builds each carry their own copy of this class, so
 * `instanceof` can miss.
 */
export class SuperScriptError extends Error {
  readonly code: DiagnosticCode
  readonly line: number
  readonly col: number
  readonly endCol: number
  readonly hint?: string
  readonly diagnostics: Diagnostic[]

  constructor (diagnostic: Diagnostic, diagnostics: Diagnostic[] = [diagnostic]) {
    super(`${diagnostic.message} (line ${diagnostic.line}, col ${diagnostic.col})${diagnostic.hint !== undefined ? `; ${diagnostic.hint}` : ''}`)
    // Set explicitly: a minifier renames the class.
    this.name = 'SuperScriptError'
    this.code = diagnostic.code
    this.line = diagnostic.line
    this.col = diagnostic.col
    this.endCol = diagnostic.endCol
    if (diagnostic.hint !== undefined) this.hint = diagnostic.hint
    this.diagnostics = diagnostics
    Object.defineProperty(this, BRAND, { value: true })
  }
}

/** True for a SuperScriptError from any copy of this package. */
export function isSuperScriptError (e: unknown): e is SuperScriptError {
  return typeof e === 'object' && e !== null && (e as Record<symbol, unknown>)[BRAND] === true
}

/** An internal throwable carrying one diagnostic (converted to SuperScriptError or collected). */
export class DiagnosticThrow extends Error {
  constructor (readonly diagnostic: Diagnostic) {
    super(diagnostic.message)
  }
}

export function diag (severity: DiagnosticSeverity, code: DiagnosticCode, message: string, at: Span, hint?: string): Diagnostic {
  const d: Diagnostic = { severity, code, message, line: at.line, col: at.col, endCol: at.endCol }
  if (hint !== undefined) d.hint = hint
  return d
}

export function fail (code: DiagnosticCode, message: string, at: Span, hint?: string): never {
  throw new DiagnosticThrow(diag('error', code, message, at, hint))
}

/**
 * Diagnostics as text, one per problem, each with its source line and a caret
 * under the span: what a model needs to repair its script.
 */
export function formatDiagnostics (diagnostics: readonly Diagnostic[], source?: string): string {
  const lines = source?.split('\n')
  return diagnostics.map((d) => {
    let s = `line ${d.line}, col ${d.col}: ${d.severity} ${d.code}: ${d.message}`
    if (d.hint !== undefined) s += ` (${d.hint})`
    const text = lines?.[d.line - 1]
    if (text !== undefined) {
      s += `\n  ${text.replace(/\r$/, '')}\n  ${' '.repeat(Math.max(d.col - 1, 0))}${'^'.repeat(Math.max(d.endCol - d.col, 1))}`
    }
    return s
  }).join('\n')
}

/** The closest candidate within edit distance 2, for "did you mean" hints. */
export function closest (word: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined
  let bestD = 3
  const w = word.toLowerCase()
  for (const c of candidates) {
    const d = distance(w, c.toLowerCase(), bestD)
    if (d < bestD) { bestD = d; best = c }
  }
  return best
}

function distance (a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) >= cap) return cap
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}
