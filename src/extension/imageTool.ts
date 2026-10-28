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

// Image insert. klinecharts figures are vector-only, so we register a custom
// 'imageFig' figure that draws a (cached, async-loaded) image, and an `image`
// overlay whose two points define the image's bounding box. The URL is
// carried on the overlay's extendData.
//
// Per-URL state (SC-184): 'loading' | 'ok' | 'error', so a 404 or a cross-
// origin load with no Access-Control-Allow-Origin header (crossOrigin is kept
// 'anonymous' always — dropping it would taint the canvas and break the
// Screenshot button in every host) shows a distinct error glyph instead of
// looking identical to "still loading" forever. A failed load is retried with
// a growing backoff, capped at a few attempts, so a flaky URL recovers without
// turning every crosshair-move repaint into a network request.
//
// Which chart to redraw once an image loads (SC-008): resolved per call from
// createPointFigures' own params (dataAccess.chartOf), not a module-global
// "the chart" — that broke as soon as a second SuperChart was on the page (an
// image loading for chart B redrew chart A instead) and left every image
// permanently blank once the one chart holding the global ref unmounted. Each
// cache entry instead keeps the set of charts that asked to draw this URL
// while it was still loading, and redraws exactly those once it settles.
//
// Part of SUPer-Chart (Apache-2.0).

import { type OverlayTemplate, registerFigure, type Chart, type Nullable } from 'klinecharts'
import { type AxisParams, chartOf } from './dataAccess'
import { isInRect } from '../drawing-editor/geometry'

export type ImageLoadState = 'loading' | 'ok' | 'error'

/** Backoff before each retry, indexed by (attempts - 1); the last value repeats. */
export const RETRY_BACKOFF_MS: readonly number[] = [5_000, 30_000]
/** No more retries once an entry has failed this many times. */
export const MAX_ATTEMPTS = 3

interface ImgEntry {
  img: HTMLImageElement
  state: ImageLoadState
  attempts: number
  failedAt: number
  waiters: Set<Chart>
}

const imgCache = new Map<string, ImgEntry>()

/** Exposed for tests: never call from production code other than resolveImg. */
export function backoffFor (attempts: number): number {
  const i = Math.max(0, Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1))
  return RETRY_BACKOFF_MS[i]
}

/** Whether a failed entry is due for a retry right now (pure, for tests). */
export function shouldRetry (entry: Pick<ImgEntry, 'state' | 'attempts' | 'failedAt'>, now: number): boolean {
  return entry.state === 'error' && entry.attempts < MAX_ATTEMPTS && now - entry.failedAt >= backoffFor(entry.attempts)
}

function redrawWaiters (entry: ImgEntry): void {
  const waiters = [...entry.waiters]
  entry.waiters.clear()
  waiters.forEach(chart => { try { chart.resize() } catch { /* the chart may already be disposed */ } })
}

function startLoad (url: string, previousAttempts: number): ImgEntry {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  const entry: ImgEntry = { img, state: 'loading', attempts: previousAttempts + 1, failedAt: 0, waiters: new Set() }
  img.onload = () => { entry.state = 'ok'; redrawWaiters(entry) }
  // Fires for a 404, a network failure, AND a cross-origin load with no ACAO
  // header (the browser reports that as a load error too, before any pixel is
  // ever read) — every "broken" case ends up here, not just a 404.
  img.onerror = () => { entry.state = 'error'; entry.failedAt = Date.now(); redrawWaiters(entry) }
  img.src = url
  imgCache.set(url, entry)
  return entry
}

/**
 * Resolve (and, if needed, start or retry loading) the image for `url`.
 * `chart` — when given — is redrawn once this load settles, so a second
 * chart asking for a URL still loading for a first one gets its own redraw.
 */
function resolveImg (url: string, chart: Nullable<Chart>): ImgEntry | null {
  if (url.length === 0) {
    return null
  }
  let entry = imgCache.get(url)
  if (entry === undefined) {
    entry = startLoad(url, 0)
  } else if (shouldRetry(entry, Date.now())) {
    entry = startLoad(url, entry.attempts)
  }
  if (chart !== null && chart !== undefined && entry.state === 'loading') {
    entry.waiters.add(chart)
  }
  return entry
}

/** Register the figure with klinecharts. Called by registerExtensions() (see
 *  ./register), never at import: a second copy of this module registering at
 *  import used to replace the first one's figure, whose image loads then
 *  redrew a chart that was never set. */
export function registerImageFigure (): void {
  registerFigure({
    name: 'imageFig',
    // Clickable inside the image's box, so a placed image can be selected and edited.
    checkEventOn: (coordinate: { x: number; y: number }, attrs: unknown) => {
      const { x, y, width, height } = attrs as { x: number; y: number; width: number; height: number }
      return isInRect(coordinate, { x, y, width, height })
    },
    draw: (ctx: CanvasRenderingContext2D, attrs: unknown) => {
      const { x, y, width, height, state } = attrs as { x: number; y: number; width: number; height: number; state: ImageLoadState, img: HTMLImageElement | null }
      if (width <= 0 || height <= 0) return
      if (state === 'ok') {
        const { img } = attrs as { img: HTMLImageElement | null }
        if (img !== null) {
          try { ctx.drawImage(img, x, y, width, height) } catch { /* ignore */ }
          return
        }
      }
      ctx.save()
      ctx.strokeStyle = state === 'error' ? 'rgba(239, 83, 80, 0.7)' : 'rgba(120, 120, 120, 0.6)'
      ctx.setLineDash([4, 3])
      ctx.strokeRect(x, y, width, height)
      if (state === 'error') {
        // A plain glyph, no text: avoids i18n and still reads at any zoom.
        ctx.beginPath()
        const cx = x + width / 2
        const cy = y + height / 2
        const r = Math.max(6, Math.min(width, height) * 0.18)
        ctx.setLineDash([])
        ctx.lineWidth = 2
        ctx.moveTo(cx - r, cy - r)
        ctx.lineTo(cx + r, cy + r)
        ctx.moveTo(cx + r, cy - r)
        ctx.lineTo(cx - r, cy + r)
        ctx.stroke()
      }
      ctx.restore()
    }
  })
}

export const image: OverlayTemplate = {
  name: 'image',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: (params) => {
    const { overlay, coordinates } = params
    if (coordinates.length < 2) return []
    const c0 = coordinates[0], c1 = coordinates[1]
    const x = Math.min(c0.x, c1.x), y = Math.min(c0.y, c1.y)
    const width = Math.abs(c1.x - c0.x), height = Math.abs(c1.y - c0.y)
    const url = typeof overlay.extendData === 'string' ? overlay.extendData.trim() : ''
    const entry = resolveImg(url, chartOf(params as AxisParams))
    const state: ImageLoadState = entry?.state ?? 'error'
    const img = entry?.state === 'ok' ? entry.img : null
    return [{ type: 'imageFig', attrs: { x, y, width, height, state, img } }] as ReturnType<NonNullable<OverlayTemplate['createPointFigures']>>
  }
}
