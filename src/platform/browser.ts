/** Browser lifecycle adapter; the data state machine lives in core. */
import type { LoaderEnv as CoreLoaderEnv, EventTargetLike } from '../core/loaderEnvironment'

export interface LoaderEnv extends Omit<CoreLoaderEnv, 'visibility' | 'connectivity'> {
  document?: EventTargetLike & { hidden: boolean }
  window?: EventTargetLike
}

export function browserEnvironment (): LoaderEnv {
  const g = globalThis as any
  const doc = typeof document !== 'undefined' ? document : undefined
  const win = typeof window !== 'undefined' ? window : undefined
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
    requestFrame: typeof g.requestAnimationFrame === 'function' ? fn => g.requestAnimationFrame(fn) : undefined,
    cancelFrame: typeof g.cancelAnimationFrame === 'function' ? handle => { g.cancelAnimationFrame(handle) } : undefined,
    hidden: () => doc?.hidden === true,
    queueMicrotask: fn => { typeof g.queueMicrotask === 'function' ? g.queueMicrotask(fn) : Promise.resolve().then(fn) },
    document: doc,
    window: win,
    warn: (...args) => { console.warn(...args) }
  }
}
