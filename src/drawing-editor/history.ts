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

// A capped undo/redo stack of opaque {undo, redo} entries (SC-092). Pure
// bookkeeping: it knows nothing about drawings, overlays or klinecharts —
// DrawingEditor (controller.ts) builds entries that capture and restore its
// own state. Any new action clears the redo tail, matching every editor
// (browser, word processor) users already know. Part of SUPer-Chart (Apache-2.0).

export interface HistoryEntry {
  undo: () => void
  redo: () => void
}

export interface HistoryOptions {
  /** Oldest entries are dropped once this many accumulate. @default 100 */
  cap?: number
}

export class History {
  private readonly entries: HistoryEntry[] = []
  /** Number of entries currently "done" (entries[0..cursor-1]); redo entries are entries[cursor..]. */
  private cursor = 0
  private readonly cap: number

  constructor (options: HistoryOptions = {}) {
    this.cap = options.cap ?? 100
  }

  get canUndo (): boolean {
    return this.cursor > 0
  }

  get canRedo (): boolean {
    return this.cursor < this.entries.length
  }

  /** Number of entries currently kept (done + redoable). */
  get size (): number {
    return this.entries.length
  }

  /** Push a new entry as the most recent action: drops any redo tail, then trims the oldest entry past the cap. */
  push (entry: HistoryEntry): HistoryEntry {
    this.entries.splice(this.cursor)
    this.entries.push(entry)
    this.cursor = this.entries.length
    if (this.entries.length > this.cap) {
      this.entries.shift()
      this.cursor = this.entries.length
    }
    return entry
  }

  /**
   * The most recently pushed entry, for a caller that wants to coalesce the
   * next action into it (e.g. a color drag's many onInput events) — but only
   * while it is still the freshest thing that happened: null once an undo,
   * redo or clear has run since it was pushed.
   */
  top (): HistoryEntry | null {
    return this.entries.length > 0 && this.cursor === this.entries.length ? this.entries[this.entries.length - 1] : null
  }

  /** Undo the most recent (not-yet-undone) entry. Returns false with nothing to undo. */
  undo (): boolean {
    if (!this.canUndo) {
      return false
    }
    this.cursor--
    this.entries[this.cursor].undo()
    return true
  }

  /** Redo the most recently undone entry. Returns false with nothing to redo. */
  redo (): boolean {
    if (!this.canRedo) {
      return false
    }
    this.entries[this.cursor].redo()
    this.cursor++
    return true
  }

  /** Drop every entry (e.g. on dispose(), or a host that does not want cross-symbol undo). */
  clear (): void {
    this.entries.length = 0
    this.cursor = 0
  }
}
