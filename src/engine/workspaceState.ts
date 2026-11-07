import type { DataState } from '../core/dataLoader'
import type { Period, SymbolInfo } from '../core/feed'
import type { CandleMode } from '../core/realtimeSeries'
import { periodKey, symbolKey } from '../core/marketKeys'
import type { EngineIndicatorInstance } from './indicators'

export interface WorkspaceMarket { symbol: SymbolInfo, period: Period }
export type WorkspaceLoadResult =
  | { status: 'loaded', symbol: SymbolInfo, period: Period, bars: number }
  | { status: 'unchanged', symbol: SymbolInfo, period: Period }
  | { status: 'superseded', by: WorkspaceMarket }
  | { status: 'error', symbol: SymbolInfo, period: Period, message: string, timeout: boolean }
  | { status: 'cancelled', symbol: SymbolInfo, period: Period }
  | { status: 'disposed' }
export interface WorkspaceLoadState {
  requested: WorkspaceMarket
  /** Data actually applied to the chart, including a settled empty result. */
  loaded: WorkspaceMarket | null
  status: DataState | 'cancelled'
  loadingMore: boolean
  error: { message: string, phase: 'initial' | 'more' | 'sync', timeout: boolean } | null
}
export interface WorkspaceReplayState {
  active: boolean
  index: number | null
  length: number
  timestamp: number | null
  atEnd: boolean
  playing: boolean
  speed: number
}
export interface WorkspaceState {
  schema: 1
  load: WorkspaceLoadState
  replay: WorkspaceReplayState
  data: { count: number, firstTimestamp: number | null, lastTimestamp: number | null }
  view: { from: number, to: number, following: boolean, mode: CandleMode }
  indicators: readonly EngineIndicatorInstance[]
  drawings: { count: number, selectedId: string | null }
}
export interface WorkspaceEvents {
  marketChange: { previous: WorkspaceMarket, requested: WorkspaceMarket }
  loadState: WorkspaceLoadState
  loadResult: WorkspaceLoadResult
  dataChange: { market: WorkspaceMarket, kind: 'reset' | 'prepend' | 'tail', count: number }
  replayChange: WorkspaceReplayState
}

export function copyWorkspaceMarket (market: WorkspaceMarket): WorkspaceMarket {
  return { symbol: { ...market.symbol }, period: { ...market.period } }
}
export function workspaceMarketKey (market: WorkspaceMarket): string {
  return `${symbolKey(market.symbol)}:${periodKey(market.period)}`
}

interface PendingLoad {
  market: WorkspaceMarket
  sealed: boolean
  superseded: PendingLoad[]
  promise: Promise<WorkspaceLoadResult>
  resolve: (result: WorkspaceLoadResult) => void
}

/**
 * Waits for the owner's actual data application, never for request dispatch.
 * Calls before the next microtask share one final market/outcome. A later
 * request supersedes the active batch. This queue does not fetch or abort;
 * DataLoader remains responsible for the network and its generation guards.
 */
export class WorkspaceLoadQueue {
  private active: PendingLoad | null = null
  private disposed = false
  constructor (private readonly schedule: (callback: () => void) => void, private readonly reportSuperseded: (result: WorkspaceLoadResult) => void) {}
  get pending (): boolean { return this.active !== null }
  current (market: WorkspaceMarket): Promise<WorkspaceLoadResult> | null {
    return this.active !== null && workspaceMarketKey(this.active.market) === workspaceMarketKey(market) ? this.active.promise : null
  }

  // Repeated same-tick requests deliberately share the same promise object.
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  request (market: WorkspaceMarket): Promise<WorkspaceLoadResult> {
    if (this.disposed) return Promise.resolve({ status: 'disposed' })
    const next = copyWorkspaceMarket(market)
    if (this.active !== null && !this.active.sealed) {
      this.active.market = next
      return this.active.promise
    }
    const superseded = this.active === null ? [] : [this.active]
    let settle!: (result: WorkspaceLoadResult) => void
    const promise = new Promise<WorkspaceLoadResult>(resolve => { settle = resolve })
    const active: PendingLoad = { market: next, sealed: false, superseded, promise, resolve: settle }
    this.active = active
    this.schedule(() => { active.sealed = true; this.retireSuperseded(active) })
    return promise
  }

  private retireSuperseded (active: PendingLoad): void {
    for (const previous of active.superseded.splice(0)) {
      const result: WorkspaceLoadResult = { status: 'superseded', by: copyWorkspaceMarket(active.market) }
      previous.resolve(result); this.reportSuperseded(result)
    }
  }

  settle (market: WorkspaceMarket, result: WorkspaceLoadResult): boolean {
    if (this.active === null || !this.active.sealed || workspaceMarketKey(this.active.market) !== workspaceMarketKey(market)) return false
    const active = this.active; this.active = null; active.resolve(result)
    return true
  }

  cancel (): WorkspaceLoadResult | null {
    const active = this.active
    if (active === null) return null
    this.retireSuperseded(active)
    const result: WorkspaceLoadResult = { status: 'cancelled', ...copyWorkspaceMarket(active.market) }
    this.active = null; active.resolve(result)
    return result
  }

  dispose (): void {
    this.disposed = true
    const active = this.active; this.active = null
    for (const previous of active?.superseded.splice(0) ?? []) previous.resolve({ status: 'disposed' })
    active?.resolve({ status: 'disposed' })
  }
}

function frozenCopy<T> (value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(item => frozenCopy(item))) as T
  if (value !== null && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, frozenCopy(item)]))) as T
  }
  return value
}

/** Microtask delivery avoids re-entering DataLoader halfway through applying a page. */
export class WorkspaceEventBus {
  private readonly listeners = new Map<keyof WorkspaceEvents, Set<(event: never) => void>>()
  constructor (private readonly warn: (...args: unknown[]) => void, private readonly schedule: (callback: () => void) => void = queueMicrotask) {}
  on<K extends keyof WorkspaceEvents> (type: K, listener: (event: WorkspaceEvents[K]) => void): () => void {
    if (!['marketChange', 'loadState', 'loadResult', 'dataChange', 'replayChange'].includes(type)) throw new RangeError('Unknown workspace event')
    if (typeof listener !== 'function') throw new TypeError('Workspace listener must be a function')
    let set = this.listeners.get(type)
    if (set === undefined) { set = new Set(); this.listeners.set(type, set) }
    set.add(listener as (event: never) => void)
    return () => this.off(type, listener)
  }

  off<K extends keyof WorkspaceEvents> (type: K, listener: (event: WorkspaceEvents[K]) => void): void {
    this.listeners.get(type)?.delete(listener as (event: never) => void)
  }

  emit<K extends keyof WorkspaceEvents> (type: K, event: WorkspaceEvents[K]): void {
    const listeners = [...(this.listeners.get(type) ?? [])]
    if (listeners.length === 0) return
    const snapshot = frozenCopy(event)
    this.schedule(() => {
      for (const listener of listeners) {
        if (!this.listeners.get(type)?.has(listener)) continue
        try { listener(snapshot as never) } catch (error) { this.warn(`[super-chart] workspace ${type} listener failed`, error) }
      }
    })
  }

  clear (): void { this.listeners.clear() }
}
