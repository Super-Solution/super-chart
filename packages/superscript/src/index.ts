/**
 * Super Chart — server-safe SuperScript entry (`@super-solution/super-chart/superscript`).
 *
 * The SuperScript runtime and the AI helpers, with no klinecharts, no DOM and
 * no Solid: this entry imports and runs in plain Node, so an MCP tool or a
 * backend can compile and run scripts without installing a canvas chart
 * library. To draw a script, use `createEngineScriptIndicator` from `/scripts`.
 *
 * Only SuperScript runs by default. The JavaScript language evaluates its
 * source with `new Function`, which on a server is full code execution, so this
 * entry refuses every language except `superscript` unless the host registers
 * it here itself, knowingly: `registerLanguage(JavaScriptLanguage)`. (The
 * browser entries no longer register JavaScript either.) A tool that takes a
 * language id from a model or a user should still pin it to `"superscript"`.
 *
 * The registry is shared with this entry's language runtime. The owned `/scripts`
 * bridge accepts SuperScript only and does not execute arbitrary registered code.
 *
 * Part of Super Chart.
 */
import {
  registerLanguage as registerAnyLanguage,
  getLanguage as getAnyLanguage,
  listLanguages as listAnyLanguages,
  SuperScriptLanguage,
  type Bar,
  type ScriptLanguage,
  type ScriptParams,
  type ScriptResult
} from './runtime'

export {
  SuperScriptLanguage,
  JavaScriptLanguage,
  superlib,
  superscriptReference,
  checkSuperScript,
  isSuperScriptError,
  formatDiagnostics,
  SuperScriptError
} from './runtime'
export type {
  Series,
  Bar,
  PlotStyle,
  Plot,
  ScriptResult,
  ScriptLanguage,
  CompiledScript,
  CompileOptions,
  ScriptInput,
  ScriptMeta,
  ScriptParams,
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity
} from './runtime'
export * from './ai'

/** Language ids a host registered through this entry. */
const enabled = new Set<string>([SuperScriptLanguage.id])

/**
 * Register a script language and enable it on this entry. This is the only
 * way to run anything but SuperScript through `./superscript`.
 */
export function registerLanguage (lang: ScriptLanguage): void {
  registerAnyLanguage(lang)
  enabled.add(lang.id)
}

/** The language with this id, if it is enabled on this entry. */
export function getLanguage (id: string): ScriptLanguage | undefined {
  return enabled.has(id) ? getAnyLanguage(id) : undefined
}

/** The languages enabled on this entry (SuperScript plus any the host registered here). */
export function listLanguages (): ScriptLanguage[] {
  return listAnyLanguages().filter(lang => enabled.has(lang.id))
}

/**
 * Compile and run a script. Throws for a language that is not enabled on this
 * entry, including `"javascript"` unless the host registered it here.
 */
export function runScript (source: string, bars: Bar[], languageId = SuperScriptLanguage.id, params?: ScriptParams): ScriptResult {
  const lang = getLanguage(languageId)
  if (lang === undefined) {
    throw new Error(`language "${languageId}" is not enabled on @super-solution/super-chart/superscript; ` +
      'only "superscript" runs by default. Register another language with registerLanguage() from this entry first.')
  }
  return lang.compile(source).run(bars, params)
}
