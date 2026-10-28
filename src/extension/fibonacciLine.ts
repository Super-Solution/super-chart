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

// A levels-aware Fibonacci retracement line (SC-179), visually identical to
// klinecharts' own built-in `fibonacciLine` (same 7 dashed lines spanning the
// full pane width, same "value (pct%)" labels) but reading its level set from
// `extendData.levels` via fibLevels.ts, so a host or a future MCP tool can
// draw extension targets (161.8%, -61.8%, ...) that the fixed built-in never
// could.
//
// Registered as `SC_fibonacciLine`, never as `fibonacciLine`: klinecharts'
// overlay registry is one global shared by every chart AND by any host
// driving klinecharts directly (SupWallet's LiveChart/TAChart, the vendored
// older tarball), so overwriting a built-in name here would change what THEY
// draw too, for a feature they never opted into. The drawing bar's rail keeps
// creating the built-in `fibonacciLine` unchanged; a host or the AI/MCP layer
// that wants configurable levels creates `SC_fibonacciLine` instead, through
// the normal `getChart().createOverlay({ name: 'SC_fibonacciLine', ... })`.
//
// Part of SUPer-Chart (Apache-2.0).

import { type OverlayTemplate, type LineAttrs, type TextAttrs, utils } from 'klinecharts'

import { readLevels, RETRACEMENT_LEVELS } from './fibLevels'

const SCFibonacciLine: OverlayTemplate = {
  name: 'SC_fibonacciLine',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, overlay, precision, thousandsSeparator, decimalFoldThreshold, yAxis, bounding }) => {
    const points = overlay.points
    if (coordinates.length === 0) {
      return []
    }
    const currentPrecision = (yAxis?.isInCandle?.() ?? true) ? precision.price : precision.excludePriceVolumeMax
    const lines: LineAttrs[] = []
    const texts: TextAttrs[] = []
    const startX = 0
    const endX = bounding.width
    if (coordinates.length > 1 && typeof points[0]?.value === 'number' && typeof points[1]?.value === 'number') {
      const { levels: percents } = readLevels(overlay, RETRACEMENT_LEVELS)
      const yDif = coordinates[0].y - coordinates[1].y
      const valueDif = points[0].value - points[1].value
      percents.forEach(percent => {
        const y = coordinates[1].y + yDif * percent
        const value = utils.formatFoldDecimal(
          utils.formatThousands(((points[1].value ?? 0) + valueDif * percent).toFixed(currentPrecision), thousandsSeparator),
          decimalFoldThreshold
        )
        lines.push({ coordinates: [{ x: startX, y }, { x: endX, y }] })
        texts.push({ x: startX, y, text: `${value} (${(percent * 100).toFixed(1)}%)`, baseline: 'bottom' })
      })
    }
    return [{ type: 'line', attrs: lines }, { type: 'text', ignoreEvent: true, attrs: texts }]
  }
}

export default SCFibonacciLine
