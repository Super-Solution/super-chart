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

// The chart renders into its own root element inside the host's container
// (SC-075). The container keeps the `klinecharts-pro` class and `data-theme`,
// which now carry only the theme tokens and the inherited text colour and
// size (custom properties inherit and never size or place an element), so
// the host's height, display and position utilities win, layered or not, and
// tokens a host sets on its container (inline or by class) keep working. All
// layout is on the root: a flex column filling the container, size-contained
// (SC-076: its size never comes from its content), clipping across (SC-086).
//
// A container that gives the root no height (none of its own, or only a
// min-height, which a percentage height cannot resolve against) used to get
// 80vh from the engine. Now the root takes a definite fallback height
// (data-autosize, 480px) and the integrator gets a console warning. Decided
// once the container is rendered and the engine's stylesheet applies, and
// again whenever the container's size changes, so a host that sizes the
// container later gets its own size back.
//
// Part of SUPer-Chart (Apache-2.0).

export const HOST_CLASS = 'klinecharts-pro'
export const ROOT_CLASS = 'klinecharts-pro-root'

export const WARN_NO_HEIGHT = '[super-chart] the chart container gives the chart no height (it has none of its own, or only a min-height), so the chart uses a fallback height of 480px. Give the container a height (for example height: 480px, or flex: 1 with min-height: 0 in a column flex layout).'
export const WARN_NO_WIDTH = '[super-chart] the chart container has no width, so the chart is not visible. Give the container a width (for example width: 100%); an inline-block, a flex or grid item sized by its content, or an absolutely positioned box without left and right has none.'

export interface RootBox {
  /** The container has a layout box (attached, not display:none). */
  rendered: boolean
  /** The engine's stylesheet applies to the root (it may load after the chart mounts). */
  styled: boolean
  /** The root's own size without the fallback height. */
  width: number
  height: number
}

export interface RootDecision {
  autosize: boolean
  noWidth: boolean
}

/** What the root's box asks for; null while it cannot be told yet. Pure, for tests. */
export function decideRoot (box: RootBox): RootDecision | null {
  if (!box.rendered || !box.styled) {
    return null
  }
  return { autosize: box.height < 1, noWidth: box.width < 1 }
}

export interface MountedRoot {
  root: HTMLElement
  setTheme: (theme: string) => void
  setHeadless: (headless: boolean) => void
  dispose: () => void
}

export function mountRoot (container: HTMLElement, attrs: { theme: string, headless: boolean }): MountedRoot {
  const doc = container.ownerDocument
  const win = doc.defaultView ?? window
  const root = doc.createElement('div')
  root.className = ROOT_CLASS
  container.classList.add(HOST_CLASS)
  for (const el of [container, root]) {
    el.setAttribute('data-theme', attrs.theme)
    el.setAttribute('data-headless', String(attrs.headless))
  }
  container.appendChild(root)

  const warned = { height: false, width: false }
  const check = (): void => {
    const had = root.hasAttribute('data-autosize')
    if (had) {
      root.removeAttribute('data-autosize')
    }
    const box = root.getBoundingClientRect()
    const decision = decideRoot({
      rendered: container.getClientRects().length > 0,
      styled: win.getComputedStyle(root).display === 'flex',
      width: box.width,
      height: box.height
    })
    if (decision === null) {
      if (had) {
        root.setAttribute('data-autosize', '')
      }
      return
    }
    if (decision.autosize) {
      root.setAttribute('data-autosize', '')
      if (!warned.height) {
        warned.height = true
        console.warn(WARN_NO_HEIGHT)
      }
    }
    if (decision.noWidth && !warned.width) {
      warned.width = true
      console.warn(WARN_NO_WIDTH)
    }
  }

  check()
  // The container (a host sizing it later, a hidden tab shown) and the root
  // (the stylesheet arriving after the chart mounted). Checked in the next
  // frame, not inside the observer's callback: changing the root's height
  // there would be a resize the observer cannot deliver in the same loop.
  let observer: ResizeObserver | undefined
  let frame = 0
  if (typeof win.ResizeObserver !== 'undefined') {
    observer = new win.ResizeObserver(() => {
      if (frame === 0) {
        frame = win.requestAnimationFrame(() => { frame = 0; check() })
      }
    })
    observer.observe(container)
    observer.observe(root)
  }

  return {
    root,
    setTheme (theme) {
      container.setAttribute('data-theme', theme)
      root.setAttribute('data-theme', theme)
    },
    setHeadless (headless) {
      container.setAttribute('data-headless', String(headless))
      root.setAttribute('data-headless', String(headless))
    },
    dispose () {
      observer?.disconnect()
      observer = undefined
      if (frame !== 0) {
        win.cancelAnimationFrame(frame)
        frame = 0
      }
      root.remove()
      container.classList.remove(HOST_CLASS)
      container.removeAttribute('data-theme')
      container.removeAttribute('data-headless')
    }
  }
}
