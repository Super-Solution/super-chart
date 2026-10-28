/**
 * Errors Super Chart throws on purpose, so callers (hosts, agents, MCP tools)
 * can tell them apart from bugs.
 *
 * Part of SUPer-Chart (Apache-2.0).
 */

/** A SuperChart method was called after `dispose()`. */
export class ChartDisposedError extends Error {
  readonly code = 'DISPOSED'

  constructor (method: string) {
    super(`SuperChart.${method}() was called after dispose(); create a new chart instead.`)
    this.name = 'ChartDisposedError'
  }
}
