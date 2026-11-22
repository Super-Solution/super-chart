import { symbolKey, type WorkspaceLoadResult } from '@supersolutions/super-chart-core'
import type { DocumentSync, PullResult } from '@supersolutions/super-chart-core/sync'
import type { ChartWorkspace } from './workspace'

export interface DrawingSyncOptions {
  /** The document id of a symbol's drawings. Default `drawings/<symbolKey>`. The server keeps ids apart per person. */
  id?: (symbolKey: string) => string
  /** Anything that went wrong on the way (a bad document from the server, a document too long to save). Never thrown. */
  onError?: (error: unknown) => void
  /** Pull when the market finishes loading and write what is unsaved when the page is hidden. Default true. */
  automatic?: boolean
}

export interface DrawingSyncBinding {
  /** Brings the shown market's drawings up to date with the server now. Resolves `null` when no market is shown. */
  pull: () => Promise<PullResult | null>
  /** Writes unsaved drawings now. */
  flush: () => Promise<void>
  dispose: () => void
}

/**
 * Connects a workspace's drawings to a `DocumentSync` (from `@supersolutions/super-chart-core/sync`): the person's edits
 * are saved to the server, and each market's drawings are pulled when it is shown. Nothing else is added: the sync, its
 * transport, its journal and its conflict policy are the host's, and the binding only maps the workspace's two methods and
 * one event onto it. The workspace stays usable offline; edits wait in the sync until the server answers.
 */
export function bindDrawingSync (workspace: ChartWorkspace, sync: DocumentSync, options: DrawingSyncOptions = {}): DrawingSyncBinding {
  const docId = options.id ?? ((key: string) => `drawings/${key}`)
  const report = (error: unknown): void => { try { options.onError?.(error) } catch { /* the host's */ } }
  const shownKey = (): string | null => {
    const loaded = workspace.getLoadState().loaded
    return loaded === null ? null : symbolKey(loaded.symbol)
  }
  const stops: Array<() => void> = []

  const apply = (document: string, key: string, decided: boolean): void => {
    // Only into the market it belongs to. A pulled document never goes over an edit that has not been saved; one the
    // person's own decision produced (a merge, or taking the server's side) is exactly what is to be shown.
    if (shownKey() !== key || (!decided && sync.getState(docId(key)).pending)) return
    try { if (workspace.exportDrawings() !== document) workspace.importDrawings(document) } catch (error) { report(error) }
  }

  const pull = async (): Promise<PullResult | null> => {
    const key = shownKey()
    if (key === null) return null
    const id = docId(key)
    let result: PullResult
    try { result = await sync.pull(id) } catch (error) { report(error); return null }
    if (result.status === 'remote' || result.status === 'unchanged') apply(result.document, key, false)
    else if (result.status === 'empty') {
      // Nothing on the server yet: what this device already has becomes its first version.
      try { if (shownKey() === key && workspace.getState().drawings.count > 0) sync.set(id, workspace.exportDrawings()) } catch (error) { report(error) }
    }
    // A failed read is reported by the sync's own `state` event below, once.
    return result
  }

  stops.push(workspace.on('drawingsChange', event => {
    // Events arrive a microtask after the edit; if the market changed in between, those drawings are no longer the shown ones.
    if (event.origin !== 'edit' || shownKey() !== event.key) return
    try { sync.set(docId(event.key), workspace.exportDrawings()) } catch (error) { report(error) }
  }))
  // A conflict settled for the remote side, or merged, is shown straight away.
  stops.push(sync.on('document', event => {
    if (event.reason === 'pull') return
    const key = shownKey()
    if (key !== null && docId(key) === event.id) apply(event.document, key, true)
  }))
  stops.push(sync.on('state', event => { if (event.error !== null && event.state !== 'offline') report(event.error) }))

  if (options.automatic !== false) {
    stops.push(workspace.on('loadResult', (result: WorkspaceLoadResult) => { if (result.status === 'loaded' || result.status === 'unchanged') void pull() }))
    const target = globalThis as { addEventListener?: (type: string, listener: () => void) => void, removeEventListener?: (type: string, listener: () => void) => void, document?: { visibilityState?: string } }
    const online = (): void => { sync.retryNow() }
    const hidden = (): void => { if (target.document?.visibilityState === 'hidden') void sync.flushAll() }
    target.addEventListener?.('online', online)
    target.addEventListener?.('visibilitychange', hidden)
    stops.push(() => { target.removeEventListener?.('online', online); target.removeEventListener?.('visibilitychange', hidden) })
    if (shownKey() !== null) void pull()
  }

  return {
    pull,
    flush: async () => { const key = shownKey(); if (key !== null) await sync.flush(docId(key)) },
    dispose: () => { for (const stop of stops.splice(0)) stop() }
  }
}
