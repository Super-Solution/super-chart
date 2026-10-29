/** React Native lifecycle bridge. Hosts inject AppState; no native module is imported. */
import { DataLoader } from '../core/dataLoader'
import type { LoaderOptions } from '../core/dataLoader'
import { createRuntimeEnvironment } from '../core/loaderEnvironment'
import type { EventTargetLike, LoaderEnv } from '../core/loaderEnvironment'

/** Structural subset of React Native AppState; also usable by a host adapter. */
export interface NativeAppStateSource {
  readonly currentState: string | null
  addEventListener: (type: 'change', listener: (state: string) => void) => { remove: () => void }
}

export interface NativeEnvironmentOptions {
  appState?: NativeAppStateSource
  /** Emit an actual reconnect signal, not every network-status notification. */
  subscribeReconnect?: (listener: () => void) => () => void
  env?: Partial<LoaderEnv>
}

function appVisibility (appState: NativeAppStateSource): EventTargetLike & { readonly hidden: boolean } {
  const listeners = new Set<() => void>()
  let subscription: { remove: () => void } | null = null
  let hidden = appState.currentState !== 'active'
  return {
    get hidden () { return listeners.size === 0 ? appState.currentState !== 'active' : hidden },
    addEventListener (type, listener) {
      if (type !== 'visibilitychange' || listeners.has(listener)) return
      listeners.add(listener)
      if (subscription === null) {
        hidden = appState.currentState !== 'active'
        subscription = appState.addEventListener('change', state => {
          const next = state !== 'active'
          if (next === hidden) return
          hidden = next
          for (const notify of [...listeners]) notify()
        })
      }
      // Record a background attachment so the first resume can catch up.
      if (hidden) listener()
    },
    removeEventListener (type, listener) {
      if (type !== 'visibilitychange') return
      listeners.delete(listener)
      if (listeners.size === 0 && subscription !== null) {
        const previous = subscription
        subscription = null
        previous.remove()
      }
    }
  }
}

function reconnectEvents (subscribe: (listener: () => void) => () => void): EventTargetLike {
  const listeners = new Set<() => void>()
  let unsubscribe: (() => void) | null = null
  return {
    addEventListener (type, listener) {
      if (type !== 'online' || listeners.has(listener)) return
      listeners.add(listener)
      if (unsubscribe === null) {
        unsubscribe = subscribe(() => {
          for (const notify of [...listeners]) notify()
        })
      }
    },
    removeEventListener (type, listener) {
      if (type !== 'online') return
      listeners.delete(listener)
      if (listeners.size === 0 && unsubscribe !== null) {
        const previous = unsubscribe
        unsubscribe = null
        previous()
      }
    }
  }
}

/** Lazy lifecycle subscriptions are released by DataLoader.dispose. */
export function createNativeEnvironment (options: NativeEnvironmentOptions = {}): LoaderEnv {
  const runtime = globalThis as unknown as {
    requestAnimationFrame?: (fn: () => void) => unknown
    cancelAnimationFrame?: (handle: unknown) => void
  }
  const visibility = options.appState === undefined ? options.env?.visibility : appVisibility(options.appState)
  const connectivity = options.subscribeReconnect === undefined ? options.env?.connectivity : reconnectEvents(options.subscribeReconnect)
  return createRuntimeEnvironment({
    requestFrame: runtime.requestAnimationFrame?.bind(runtime),
    cancelFrame: runtime.cancelAnimationFrame?.bind(runtime),
    ...options.env,
    visibility,
    connectivity,
    hidden: options.env?.hidden ?? (() => visibility?.hidden === true)
  })
}

export interface NativeLoaderOptions extends LoaderOptions {
  appState?: NativeAppStateSource
  subscribeReconnect?: (listener: () => void) => () => void
}

/** Keeps the core DataLoader API and leaves the native view/gesture adapter with the host. */
export function createNativeDataLoader (options: NativeLoaderOptions): DataLoader {
  const { appState, subscribeReconnect, ...loader } = options
  return new DataLoader({ ...loader, env: createNativeEnvironment({ appState, subscribeReconnect, env: loader.env }) })
}
