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

// A bottom-right UTC/local clock toggle (SC-NEXT #3, tread.fi's 9.png: "UTC
// 20:33:25" bottom right). A real DOM element appended into the candle pane,
// the same technique as the existing "scroll to latest" button
// (ChartProComponent's `goToLatestButton`) — cheap, and it never repaints on
// every chart frame the way a canvas overlay would need to for a
// once-a-second clock. `formatClock` is the pure, tested part; `attachClockWidget`
// is the DOM wiring (a real setInterval by default, injectable for tests).
//
// Part of SUPer-Chart (Apache-2.0).

export type ClockMode = 'utc' | 'local'

function pad (n: number): string {
  return String(n).padStart(2, '0')
}

/** 'HH:MM:SS' in UTC or the viewer's local zone, from an epoch ms timestamp. */
export function formatClock (nowMs: number, mode: ClockMode): string {
  const d = new Date(nowMs)
  const h = mode === 'utc' ? d.getUTCHours() : d.getHours()
  const m = mode === 'utc' ? d.getUTCMinutes() : d.getMinutes()
  const s = mode === 'utc' ? d.getUTCSeconds() : d.getSeconds()
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export function otherMode (mode: ClockMode): ClockMode {
  return mode === 'utc' ? 'local' : 'utc'
}

export interface AttachClockWidgetOptions {
  initialMode: ClockMode
  onModeChange: (mode: ClockMode) => void
  labelFor: (mode: ClockMode) => string
  ariaLabel: string
  /** Injectable for tests. @default Date.now */
  now?: () => number
  /** Injectable for tests. @default setInterval */
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

/**
 * Appends one `<button>` (class `klinecharts-pro-clock`) into `container`,
 * showing `HH:MM:SS <mode label>`, ticking once a second and toggling
 * UTC/local on click. Returns a dispose function that removes the element and
 * stops the interval.
 */
export function attachClockWidget (container: HTMLElement, options: AttachClockWidgetOptions): () => void {
  const now = options.now ?? (() => Date.now())
  const schedule = options.setInterval ?? ((fn, ms) => setInterval(fn, ms))
  const cancel = options.clearInterval ?? (handle => { clearInterval(handle as ReturnType<typeof setInterval>) })

  let mode = options.initialMode
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'klinecharts-pro-clock'
  button.setAttribute('aria-label', options.ariaLabel)
  button.title = options.ariaLabel

  const render = (): void => {
    button.textContent = `${formatClock(now(), mode)} ${options.labelFor(mode)}`
  }
  render()

  const onClick = (): void => {
    mode = otherMode(mode)
    options.onModeChange(mode)
    render()
  }
  button.addEventListener('click', onClick)
  container.appendChild(button)

  const handle = schedule(render, 1000)

  return () => {
    button.removeEventListener('click', onClick)
    cancel(handle)
    button.remove()
  }
}
