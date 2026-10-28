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

// TradingView "Long/Short Position" tools — three points (entry, target, stop)
// draw a green target zone + red stop zone with the risk/reward and each leg's %.
//
// SC-100 audit: no hitPathWithin needed here. Every 'line' figure below
// (the entry/target/stop guide lines) already sets ignoreEvent: true; what
// is actually clickable is the 'polygon' zones, which use klinecharts'
// normal bounded (point-in-polygon) hit test, not the buggy infinite-line
// one, confirmed by the existing e2e check "position: selectable by its zone".
// Part of SUPer-Chart (Apache-2.0).

import { OverlayTemplate } from 'klinecharts'

import { INK } from '../theme/tokens'

import { drawingLabel } from './labels'

const GREEN = 'rgba(38, 166, 154, 0.18)'
const RED = 'rgba(239, 83, 80, 0.18)'
const GREEN_LINE = '#26a69a'
const RED_LINE = '#ef5350'

const val = (overlay: { points: Array<{ value?: number }> }, i: number): number => overlay.points[i]?.value ?? 0

function makePosition(name: string, side: 'drawing_long' | 'drawing_short'): OverlayTemplate {
  return {
    name,
    totalStep: 4, // entry, target, stop
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ overlay, coordinates, precision }) => {
      if (coordinates.length < 2) return []
      const entryC = coordinates[0]
      const targetC = coordinates[1]
      // While placing the 3rd point, mirror the target distance so the box reads.
      const stopC = coordinates[2] ?? { x: targetC.x, y: 2 * entryC.y - targetC.y }
      const left = Math.min(entryC.x, targetC.x, stopC.x)
      const right = Math.max(entryC.x, targetC.x, stopC.x)
      const midX = (left + right) / 2
      // The zones are clickable, so a finished position can be selected and edited.
      const zone = (yA: number, yB: number, color: string) => ({
        type: 'polygon',
        attrs: { coordinates: [{ x: left, y: yA }, { x: right, y: yA }, { x: right, y: yB }, { x: left, y: yB }] },
        styles: { style: 'fill', color },
      })
      const hline = (y: number, color?: string) => ({
        type: 'line',
        ignoreEvent: true,
        attrs: { coordinates: [{ x: left, y }, { x: right, y }] },
        ...(color ? { styles: { color } } : {}),
      })
      const figures: unknown[] = [
        zone(entryC.y, targetC.y, GREEN),
        zone(entryC.y, stopC.y, RED),
        hline(targetC.y, GREEN_LINE),
        hline(stopC.y, RED_LINE),
        hline(entryC.y),
      ]
      if (coordinates.length >= 3) {
        const entry = val(overlay, 0)
        const target = val(overlay, 1)
        const stop = val(overlay, 2)
        const p = precision.price
        const rr = Math.abs(entry - stop) > 0 ? Math.abs(target - entry) / Math.abs(entry - stop) : 0
        const tgtPct = entry ? ((target - entry) / entry) * 100 : 0
        const stpPct = entry ? ((stop - entry) / entry) * 100 : 0
        const text = (y: number, s: string, color: string, bg: string, baseline: string) => ({
          type: 'text',
          ignoreEvent: true,
          attrs: { x: midX, y, text: s, align: 'center', baseline },
          styles: { color, size: 11, paddingLeft: 5, paddingRight: 5, paddingTop: 3, paddingBottom: 3, borderRadius: 2, backgroundColor: bg },
        })
        figures.push(
          text(entryC.y, drawingLabel('drawing_rr', { side: drawingLabel(side), rr: rr.toFixed(2) }), '#ffffff', 'rgba(20, 24, 34, 0.88)', 'middle'),
          // Dark ink on the green/red badges (white was 2.7-4.0:1).
          text(targetC.y, drawingLabel('drawing_target', { price: target.toFixed(p), pct: `${tgtPct >= 0 ? '+' : ''}${tgtPct.toFixed(2)}%` }), INK, 'rgba(38, 166, 154, 0.92)', 'middle'),
          text(stopC.y, drawingLabel('drawing_stop', { price: stop.toFixed(p), pct: `${stpPct >= 0 ? '+' : ''}${stpPct.toFixed(2)}%` }), INK, 'rgba(239, 83, 80, 0.92)', 'middle'),
        )
      }
      return figures as ReturnType<NonNullable<OverlayTemplate['createPointFigures']>>
    },
  }
}

export const positionLong = makePosition('positionLong', 'drawing_long')
export const positionShort = makePosition('positionShort', 'drawing_short')
