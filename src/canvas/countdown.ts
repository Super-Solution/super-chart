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

// A bar-close countdown under the last-price tag (SC-052), the TradingView
// convention super-chart was missing entirely. Drawn as one locked, click-
// through y-axis overlay (`registerOverlay`, global like any other overlay
// name — the drawing rail and editor never touch it: it carries a reserved
// groupId that every overlay listing filters out) whose label is pushed in
// from the outside through `overrideOverlay({ extendData })`, so the overlay
// template itself needs no reference to a specific chart or period.
//
// Part of SUPer-Chart (Apache-2.0).

export interface CountdownPeriod {
  multiplier: number
  timespan: string
}

/** The bar's next close, or null for a timespan with no fixed/calendar duration (an unknown string). */
export function nextBarClose (lastBarTs: number, period: CountdownPeriod): number | null {
  const { multiplier, timespan } = period
  if (!(multiplier > 0) || !Number.isFinite(lastBarTs)) {
    return null
  }
  switch (timespan) {
    case 'second': return lastBarTs + multiplier * 1_000
    case 'minute': return lastBarTs + multiplier * 60_000
    case 'hour': return lastBarTs + multiplier * 3_600_000
    case 'day': return lastBarTs + multiplier * 86_400_000
    case 'week': return lastBarTs + multiplier * 604_800_000
    case 'month': {
      const d = new Date(lastBarTs)
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + multiplier, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())
    }
    case 'year': {
      const d = new Date(lastBarTs)
      return Date.UTC(d.getUTCFullYear() + multiplier, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())
    }
    default: return null
  }
}

/**
 * ms remaining until the bar that opened at `lastBarTs` closes; null when
 * that cannot be shown: an unrecognised timespan, a stale feed or a closed
 * market (the remaining time is <= 0), or a feed that stamps bars with their
 * close time rather than their open time (remaining > one period).
 */
export function barRemaining (lastBarTs: number, period: CountdownPeriod, now: number): number | null {
  const close = nextBarClose(lastBarTs, period)
  if (close === null) {
    return null
  }
  const span = close - lastBarTs
  const remaining = close - now
  if (!(span > 0) || !(remaining > 0) || remaining > span) {
    return null
  }
  return remaining
}

/** 'mm:ss' under an hour, 'HH:MM:SS' under a day, 'Nd HHh' above that. */
export function formatCountdown (ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const pad = (n: number): string => String(n).padStart(2, '0')
  if (totalSeconds >= 86_400) {
    const days = Math.floor(totalSeconds / 86_400)
    const hours = Math.floor((totalSeconds % 86_400) / 3600)
    return `${days}d ${pad(hours)}h`
  }
  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${pad(minutes)}:${pad(seconds)}`
}

export const COUNTDOWN_OVERLAY_NAME = 'scBarCountdown'
/** Reserved groupId: filter this out of any overlay listing exposed to hosts or future tools. */
export const COUNTDOWN_GROUP_ID = '__sc_countdown'

export interface CountdownExtendData {
  text: string
  /** The price the label is drawn at (the last close): positions it via yAxis.convertToPixel. */
  price: number
  color: string
  /** Extra px above the price, clearing the last-price tag. */
  offset: number
}

interface YAxisLike { convertToPixel: (value: number) => number }
interface OverlayFigureLike { type: string, ignoreEvent?: boolean, attrs: unknown, styles?: unknown }
interface CreateYAxisFiguresParams { overlay: { extendData: unknown }, yAxis: YAxisLike | null, bounding: { width: number } }

/** The subset of `registerOverlay`'s parameter this module needs (kept generic so it needs no runtime klinecharts import — see crispLines.ts). */
export type RegisterOverlayFn = (template: {
  name: string
  needDefaultPointFigure: boolean
  needDefaultXAxisFigure: boolean
  needDefaultYAxisFigure: boolean
  createPointFigures: () => OverlayFigureLike[]
  createYAxisFigures: (params: CreateYAxisFiguresParams) => OverlayFigureLike[]
}) => void

/**
 * The overlay template, as a pure factory (no global state): builds the same
 * object `registerCountdownOverlay` registers, for testing the figure logic
 * in isolation from the module's one-time registration guard.
 */
export function buildCountdownOverlayTemplate (): Parameters<RegisterOverlayFn>[0] {
  return {
    name: COUNTDOWN_OVERLAY_NAME,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: () => [],
    createYAxisFigures: ({ overlay, yAxis, bounding }) => {
      const data = overlay.extendData as Partial<CountdownExtendData> | undefined
      if (data === undefined || typeof data.text !== 'string' || data.text.length === 0 || typeof data.price !== 'number' || yAxis === null) {
        return []
      }
      const y = yAxis.convertToPixel(data.price) + (data.offset ?? 0)
      return [{
        type: 'text',
        // Every figure ignores events: the y-axis keeps scaling by drag underneath it.
        ignoreEvent: true,
        attrs: { x: bounding.width / 2, y, text: data.text, align: 'center', baseline: 'middle' },
        styles: {
          color: '#FFFFFF',
          size: 11,
          // No `family` (SC-NEXT incidental fix, found via canvas/highLowTags.ts's
          // own font e2e check): klinecharts' createFont() concatenates it
          // verbatim into the canvas `ctx.font` string with no CSS cascade
          // behind it, so 'inherit' is not a valid font-family token there —
          // the assignment silently no-ops, leaving the canvas at whatever
          // font an earlier draw call left it at. Omitting the key falls
          // through to klinecharts' own default ('Helvetica Neue'), the same
          // font every other unstyled figure in this engine gets. This
          // overlay never actually reaches a real browser in this repo's own
          // e2e fixtures (their bars are timestamped in the past, so
          // barRemaining is always null and the tag never draws) — a host
          // whose feed is live would have been drawing it silently wrong.
          weight: 'normal',
          paddingLeft: 5,
          paddingRight: 5,
          paddingTop: 2,
          paddingBottom: 2,
          borderRadius: 3,
          borderSize: 0,
          backgroundColor: data.color ?? '#666666'
        }
      }]
    }
  }
}

let registered = false

/** Register the countdown's overlay template (idempotent, global like any overlay name). */
export function registerCountdownOverlay (registerOverlay: RegisterOverlayFn): void {
  if (registered) {
    return
  }
  registered = true
  registerOverlay(buildCountdownOverlayTemplate())
}

/** Test-only: lets a spec re-arm registration. Not part of the public API. */
export function _resetCountdownRegistrationForTest (): void {
  registered = false
}

export interface CountdownChart {
  getDataList: () => Array<{ timestamp: number, open: number, close: number }>
  getStyles: () => { candle: { priceMark: { last: { show: boolean, upColor: string, downColor: string, noChangeColor: string, text: { show: boolean, size: number, paddingTop: number, paddingBottom: number } } } } }
  createOverlay: (value: unknown, paneId?: string) => unknown
  overrideOverlay: (override: { id: string, extendData: CountdownExtendData }) => void
  removeOverlay: (remove?: unknown) => void
}

export interface AttachCountdownOptions {
  /** @default true */
  enabled?: () => boolean
  getPeriod: () => CountdownPeriod
  registerOverlay: RegisterOverlayFn
  /** Injectable for tests. */
  now?: () => number
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

/**
 * Mount the countdown on `chart`: creates the overlay lazily (only while
 * there is something to show), refreshes it once a wall-clock second, and
 * re-creates it if a host calls `removeOverlay()` with no arguments while the
 * feature is still active. Returns a dispose function.
 */
export function attachBarCountdown (chart: CountdownChart, options: AttachCountdownOptions): () => void {
  registerCountdownOverlay(options.registerOverlay)
  const now = options.now ?? (() => Date.now())
  const schedule = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const cancel = options.clearTimeout ?? (handle => { clearTimeout(handle as ReturnType<typeof setTimeout>) })

  let id: string | null = null
  let disposed = false
  let removingIntentionally = false
  let timer: unknown

  const removeOverlayById = (): void => {
    if (id === null) {
      return
    }
    removingIntentionally = true
    try {
      chart.removeOverlay({ id })
    } finally {
      removingIntentionally = false
    }
    id = null
  }

  const ensureOverlay = (): string | null => {
    if (id !== null) {
      return id
    }
    const created = chart.createOverlay({
      name: COUNTDOWN_OVERLAY_NAME,
      groupId: COUNTDOWN_GROUP_ID,
      lock: true,
      points: [{ timestamp: 0 }],
      onRemoved: () => {
        if (!removingIntentionally && !disposed) {
          id = null
          // A host removed it out from under us (e.g. removeOverlay() with no
          // args): put it back on the next refresh, while the feature is on.
          queueMicrotask(refresh)
        }
        return true
      }
    }, 'candle_pane')
    id = typeof created === 'string' ? created : (Array.isArray(created) && typeof created[0] === 'string' ? created[0] : null)
    return id
  }

  const refresh = (): void => {
    if (disposed) {
      return
    }
    const list = chart.getDataList()
    const last = list[list.length - 1]
    const styles = chart.getStyles().candle.priceMark.last
    const active = (options.enabled?.() ?? true) && styles.show && styles.text.show && last !== undefined
    const remaining = active && last !== undefined ? barRemaining(last.timestamp, options.getPeriod(), now()) : null
    if (remaining === null || last === undefined) {
      removeOverlayById()
      return
    }
    const oid = ensureOverlay()
    if (oid === null) {
      return
    }
    const dir = last.close > last.open ? 'up' : last.close < last.open ? 'down' : 'flat'
    const color = dir === 'up' ? styles.upColor : dir === 'down' ? styles.downColor : styles.noChangeColor
    const offset = (styles.text.size ?? 12) + (styles.text.paddingTop ?? 0) + (styles.text.paddingBottom ?? 0) + 4
    chart.overrideOverlay({ id: oid, extendData: { text: formatCountdown(remaining), price: last.close, color, offset } })
  }

  const tick = (): void => {
    if (disposed) {
      return
    }
    refresh()
    const delay = 1000 - (now() % 1000)
    timer = schedule(tick, delay)
  }
  tick()

  return () => {
    if (disposed) {
      return
    }
    disposed = true
    if (timer !== undefined) {
      cancel(timer)
    }
    removeOverlayById()
  }
}
