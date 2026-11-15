/** Command registry and ranking for the workspace command palette. No DOM: the view is `commandPaletteView.ts`. */

export interface WorkspaceCommand {
  /** Stable identifier, unique per workspace. Registering the same id again replaces the earlier command. */
  readonly id: string
  /** Shown in the palette and matched against the query. */
  readonly title: string
  /** Section heading and an extra match target, such as `Drawing` or `Interval`. */
  readonly group?: string
  /** Extra words that find this command (`['hotkey', 'ctrl']`). */
  readonly keywords?: readonly string[]
  /** Display only, such as `Alt+←`. The palette does not bind it. */
  readonly shortcut?: string
  /** Called when the palette lists commands; a command returning false is left out. */
  readonly when?: () => boolean
  readonly run: () => void | Promise<void>
}

export const COMMAND_LIMITS = Object.freeze({ commands: 512, id: 128, title: 256 })

export function validateCommand (command: WorkspaceCommand): void {
  if (command === null || typeof command !== 'object') throw new TypeError('A command must be an object')
  if (typeof command.id !== 'string' || command.id.trim() === '' || command.id.length > COMMAND_LIMITS.id) throw new TypeError('A command needs a nonempty id of at most 128 characters')
  if (typeof command.title !== 'string' || command.title.trim() === '' || command.title.length > COMMAND_LIMITS.title) throw new TypeError('A command needs a title of at most 256 characters')
  if (typeof command.run !== 'function') throw new TypeError('A command needs a run function')
  if (command.when !== undefined && typeof command.when !== 'function') throw new TypeError('A command `when` must be a function')
  if (command.keywords !== undefined && (!Array.isArray(command.keywords) || command.keywords.some(word => typeof word !== 'string'))) throw new TypeError('Command keywords must be strings')
}

/** Insertion-ordered registry. Built-in commands and host commands live in the same list. */
export class CommandRegistry {
  private readonly commands = new Map<string, WorkspaceCommand>()

  /** Returns the function that removes this exact registration (a later replacement of the id is left alone). */
  register (command: WorkspaceCommand): () => void {
    validateCommand(command)
    if (!this.commands.has(command.id) && this.commands.size >= COMMAND_LIMITS.commands) throw new RangeError('Too many commands registered')
    const stored = Object.freeze({ ...command })
    this.commands.set(command.id, stored)
    return () => { if (this.commands.get(command.id) === stored) this.commands.delete(command.id) }
  }

  unregister (id: string): boolean { return this.commands.delete(id) }
  get (id: string): WorkspaceCommand | undefined { return this.commands.get(id) }
  clear (): void { this.commands.clear() }

  /** Commands that apply now (`when` not false), in registration order. A throwing `when` hides the command. */
  list (): WorkspaceCommand[] {
    const result: WorkspaceCommand[] = []
    for (const command of this.commands.values()) {
      let visible = true
      try { visible = command.when?.() !== false } catch { visible = false }
      if (visible) result.push(command)
    }
    return result
  }
}

function score (command: WorkspaceCommand, tokens: readonly string[]): number {
  const title = command.title.toLowerCase()
  const rest = [command.group ?? '', ...(command.keywords ?? []), command.id].join(' ').toLowerCase()
  let total = 0
  for (const token of tokens) {
    const at = title.indexOf(token)
    if (at === 0) total += 100
    else if (at > 0 && /[\s:/\-_(]/.test(title[at - 1])) total += 70
    else if (at > 0) total += 40
    else if (rest.includes(token)) total += 20
    else return -1
  }
  // Shorter titles first among equal matches: `RSI` before `RSI divergence studies`.
  return total - Math.min(title.length, 60) / 100
}

/** Rank commands for a query: every word must match; title prefix beats word start beats substring beats keyword. */
export function filterCommands (commands: readonly WorkspaceCommand[], query: string, limit = 50): WorkspaceCommand[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return commands.slice(0, limit)
  const ranked: Array<{ command: WorkspaceCommand, score: number, order: number }> = []
  commands.forEach((command, order) => {
    const value = score(command, tokens)
    if (value >= 0) ranked.push({ command, score: value, order })
  })
  ranked.sort((a, b) => b.score - a.score || a.order - b.order)
  return ranked.slice(0, limit).map(item => item.command)
}
