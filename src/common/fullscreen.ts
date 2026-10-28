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

// Full screen for one chart (SC-081). The state is read from the page, never
// toggled: native when document.fullscreenElement is this chart's root,
// pseudo when the chart maximised itself inside the page. So another chart,
// a video or the host's own full screen never flips this chart's button, and
// a chart mounted during someone else's full screen starts in the right state.
//
// Entering asks the browser first; where there is no element Fullscreen API
// (iPhone Safari), the request is refused (an iframe without
// allow="fullscreen", a call without a user gesture from the API or an
// agent), 'auto' maximises the chart inside the page instead. Nothing throws
// and no promise is left rejected.
//
// Part of SUPer-Chart (Apache-2.0).

import { createSignal, Accessor } from 'solid-js'

import { isEscape, KEY_PRIORITY } from './keyDispatcher'
import type { FullscreenMode, FullscreenOption, FullscreenChange } from '../types'
import type { KeyDispatcher } from './keyDispatcher'

export type { FullscreenMode, FullscreenOption, FullscreenChange }

export const PSEUDO_FULLSCREEN_CLASS = 'klinecharts-pro-pseudo-fullscreen'

interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null
  webkitFullscreenEnabled?: boolean
  webkitExitFullscreen?: () => void
}

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => void
}

export function fullscreenElementOf (doc: Document): Element | null {
  const d = doc as FullscreenDocument
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null
}

/** The element's request function, or null when the browser has none or disallows it. */
export function nativeRequestOf (el: HTMLElement): (() => unknown) | null {
  const doc = el.ownerDocument as FullscreenDocument
  const enabled = doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? false
  const e = el as FullscreenElement
  if (!enabled) {
    return null
  }
  if (typeof e.requestFullscreen === 'function') {
    return async () => { await e.requestFullscreen() }
  }
  // The webkit variant returns undefined, not a promise.
  return typeof e.webkitRequestFullscreen === 'function' ? () => e.webkitRequestFullscreen?.() : null
}

/** The mode from what the page says. Pure, for tests. */
export function readMode (fullscreenElement: Element | null, root: Element, pseudo: boolean): FullscreenMode | null {
  if (fullscreenElement === root) {
    return 'native'
  }
  return pseudo ? 'pseudo' : null
}

export interface FullscreenController {
  mode: Accessor<FullscreenMode | null>
  isFullscreen: () => boolean
  /** Resolves with the mode it ended in (null when it could not enter). Never rejects. */
  enter: () => Promise<FullscreenMode | null>
  /** Leaves only this chart's own full screen, never the host's. Never rejects. */
  exit: () => Promise<void>
  toggle: () => Promise<FullscreenMode | null>
  dispose: () => void
}

export interface FullscreenOptions {
  option: () => FullscreenOption
  keys?: KeyDispatcher
  onChange?: (change: FullscreenChange) => void
}

export function createFullscreen (root: HTMLElement, options: FullscreenOptions): FullscreenController {
  const doc = root.ownerDocument
  const [pseudo, setPseudo] = createSignal(false)
  const [nativeOn, setNativeOn] = createSignal(fullscreenElementOf(doc) === root)
  const mode = (): FullscreenMode | null => readMode(nativeOn() ? root : null, root, pseudo())

  let lastReported: FullscreenMode | null = mode()
  const report = (): void => {
    const now = mode()
    if (now !== lastReported) {
      lastReported = now
      options.onChange?.({ mode: now })
    }
  }

  const reread = (): void => {
    setNativeOn(fullscreenElementOf(doc) === root)
    report()
  }
  doc.addEventListener('fullscreenchange', reread)
  doc.addEventListener('webkitfullscreenchange', reread)
  doc.addEventListener('fullscreenerror', reread)

  let savedOverflow: [string, string] | null = null
  let unregisterEscape: (() => void) | null = null

  const enterPseudo = (): FullscreenMode => {
    if (!pseudo()) {
      root.classList.add(PSEUDO_FULLSCREEN_CLASS)
      savedOverflow = [doc.documentElement.style.overflow, doc.body?.style.overflow ?? '']
      doc.documentElement.style.overflow = 'hidden'
      if (doc.body !== null) {
        doc.body.style.overflow = 'hidden'
      }
      // Escape leaves it, unless something else used that key: a modal or a
      // menu (they stop it before this handler), the drawing editor
      // deselecting or freehand ending (they cancel it, and run after this
      // handler: so decide once the event has finished).
      unregisterEscape = options.keys?.register(e => {
        if (isEscape(e) && pseudo()) {
          setTimeout(() => {
            if (!e.defaultPrevented && pseudo()) {
              exitPseudo()
            }
          }, 0)
        }
        return false
      }, { priority: KEY_PRIORITY.FALLBACK }) ?? null
      setPseudo(true)
      report()
    }
    return 'pseudo'
  }

  const exitPseudo = (): void => {
    if (!pseudo()) {
      return
    }
    root.classList.remove(PSEUDO_FULLSCREEN_CLASS)
    if (savedOverflow !== null) {
      doc.documentElement.style.overflow = savedOverflow[0]
      if (doc.body !== null) {
        doc.body.style.overflow = savedOverflow[1]
      }
      savedOverflow = null
    }
    unregisterEscape?.()
    unregisterEscape = null
    setPseudo(false)
    report()
  }

  const enter = async (): Promise<FullscreenMode | null> => {
    const option = options.option()
    if (option === false || mode() !== null) {
      return mode()
    }
    if (option === 'pseudo') {
      return enterPseudo()
    }
    const request = nativeRequestOf(root)
    if (request === null) {
      return option === 'auto' ? enterPseudo() : null
    }
    try {
      // The webkit variant returns undefined, not a promise.
      await Promise.resolve(request())
      reread()
      return mode()
    } catch (e) {
      return option === 'auto' ? enterPseudo() : null
    }
  }

  const exit = async (): Promise<void> => {
    if (fullscreenElementOf(doc) === root) {
      const d = doc as FullscreenDocument
      const leave = typeof d.exitFullscreen === 'function' ? d.exitFullscreen : d.webkitExitFullscreen
      try {
        await Promise.resolve(leave?.call(d))
      } catch (e) { /* already left, or the document is inactive */ }
      reread()
      return
    }
    exitPseudo()
  }

  return {
    mode,
    isFullscreen: () => mode() !== null,
    enter,
    exit,
    toggle: async () => {
      if (mode() !== null) {
        await exit()
        return mode()
      }
      return await enter()
    },
    dispose () {
      exitPseudo()
      doc.removeEventListener('fullscreenchange', reread)
      doc.removeEventListener('webkitfullscreenchange', reread)
      doc.removeEventListener('fullscreenerror', reread)
    }
  }
}
