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

// Screenshot / snapshot (SC-015): the theme-correct background, a real
// filename, and the metadata `ChartPro.snapshot()` returns. Pure and DOM-
// free — ChartProComponent supplies the resolved background (from
// `getComputedStyle`, which this module does not import) and the chart's
// `getConvertPictureUrl`/`getVisibleRange`.
//
// Part of SUPer-Chart (Apache-2.0).

import type { Period, SnapshotOptions, SnapshotResult, SymbolInfo, Theme } from '../../types'

export interface BackgroundNode { parentElement: BackgroundNode | null }

/**
 * The nearest ancestor's resolved (already-computed, never `var()` or
 * `color-mix()`) background colour, honouring a host's CSS override. Falls
 * back to the live theme's default once every ancestor is transparent —
 * never the theme the chart was *constructed* with, which is what the old
 * `props.theme === 'dark' ? ...` bug froze in place.
 */
export function resolveScreenshotBackground (start: BackgroundNode, getBackgroundColor: (node: BackgroundNode) => string, theme: Theme): string {
  let el: BackgroundNode | null = start
  while (el !== null) {
    const bg = getBackgroundColor(el)
    if (bg !== '' && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      return bg
    }
    el = el.parentElement
  }
  return theme === 'dark' ? '#151517' : '#ffffff'
}

/** Strips characters illegal in a filename on Windows/macOS/Linux, replacing each with '-'. */
function sanitizeFilenamePart (s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '-').trim()
}

/** `${ticker}_${period}_${YYYY-MM-DD_HHmm}.${ext}`, e.g. `BTC-USDT_1H_2026-09-27_1430.png`. */
export function screenshotFilename (ticker: string, periodText: string, date: Date, ext: string): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`
  return `${sanitizeFilenamePart(ticker)}_${sanitizeFilenamePart(periodText)}_${stamp}.${ext}`
}

export interface SnapshotChart {
  getConvertPictureUrl: (includeOverlay: boolean, type: string, backgroundColor: string) => string
  getVisibleRange: () => { from: number, to: number, realFrom: number, realTo: number }
}

export interface BuildSnapshotParams {
  format: 'png' | 'jpeg' | 'webp'
  background: string
  includeOverlay: boolean
  width: number
  height: number
  pixelRatio: number
  symbol: SymbolInfo
  period: Period
  timezone: string
  theme: Theme
}

/** Builds the `snapshot()` return value (and what backs the screenshot button's preview/download/copy). */
export function buildSnapshotResult (chart: SnapshotChart, params: BuildSnapshotParams): SnapshotResult {
  const dataUrl = chart.getConvertPictureUrl(params.includeOverlay, params.format, params.background)
  return {
    dataUrl,
    mime: `image/${params.format}`,
    width: params.width,
    height: params.height,
    pixelRatio: params.pixelRatio,
    symbol: params.symbol,
    period: params.period,
    timezone: params.timezone,
    theme: params.theme,
    visibleRange: chart.getVisibleRange()
  }
}

/** Resolves `snapshot()`'s defaults over whatever the caller passed. */
export function resolveSnapshotOptions (options: SnapshotOptions | undefined): Required<Pick<SnapshotOptions, 'format' | 'hideCrosshair'>> & SnapshotOptions {
  return {
    format: options?.format ?? 'png',
    hideCrosshair: options?.hideCrosshair ?? true,
    ...options
  }
}
