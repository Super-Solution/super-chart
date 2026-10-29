/** Platform lifecycle is injected. No DOM or React Native module is imported. */
import type { FrameScheduler } from './coalesce'

export interface EventTargetLike {
  addEventListener: (type: string, fn: () => void) => void
  removeEventListener: (type: string, fn: () => void) => void
}

export interface LoaderEnv extends FrameScheduler {
  queueMicrotask: (fn: () => void) => void
  /** Host foreground/background events; optional. */
  visibility?: EventTargetLike & { hidden: boolean }
  /** Host reconnect events; optional. */
  connectivity?: EventTargetLike
  warn: (...args: unknown[]) => void
}


/** Timers work in Node/native hosts; frame and lifecycle hooks belong to each host. */
export function createRuntimeEnvironment (overrides: Partial<LoaderEnv> = {}): LoaderEnv {
  const runtime = globalThis as { queueMicrotask?: (fn: () => void) => void }
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
    hidden: () => overrides.visibility?.hidden === true,
    queueMicrotask: fn => { void (typeof runtime.queueMicrotask === 'function' ? runtime.queueMicrotask(fn) : Promise.resolve().then(fn)) },
    warn: (...args) => { console.warn(...args) },
    ...overrides
  }
}
