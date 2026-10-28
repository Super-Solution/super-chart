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

// TradingView "Text & Notes" tools — text, note, callout, price label, signpost.
// The text-typed tools read their string from the overlay's extendData (the host
// prompts for it on placement); price label auto-renders the anchored price.
// Part of SUPer-Chart (Apache-2.0).

import { OverlayTemplate } from 'klinecharts'

import { drawingLabel } from './labels'

// Text styles sit on each template's `styles.text` (not on the figure) so the
// drawing editor's text-colour control can override them per overlay. No
// family: labels use the theme's overlay text font, like every other tool.
// No colours either: the box is the chart's accent and its text white or dark
// ink, whichever reads better on it, and plain text is the accent; both are
// resolved when the tool draws (src/extension/accent.ts).
const boxStyles = {
  size: 12,
  paddingLeft: 8,
  paddingRight: 8,
  paddingTop: 6,
  paddingBottom: 6,
  borderRadius: 4,
}
const smallBoxStyles = { ...boxStyles, paddingTop: 3, paddingBottom: 3, borderRadius: 3 }
const str = (overlay: { extendData?: unknown }, fallback: string): string => {
  const s = overlay.extendData
  return typeof s === 'string' && s.length > 0 ? s : fallback
}

// Plain text label.
export const text: OverlayTemplate = {
  name: 'text',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  // Plain text: no box (klinecharts 9.8 draws text on a filled box by default).
  styles: { text: { size: 14, backgroundColor: 'transparent', borderColor: 'transparent' } },
  createPointFigures: ({ overlay, coordinates }) => {
    if (coordinates.length < 1) return []
    return [{ type: 'text', attrs: { x: coordinates[0].x, y: coordinates[0].y, text: str(overlay, drawingLabel('drawing_text')), align: 'left', baseline: 'middle' } }]
  },
}

// Text inside a filled note box.
export const note: OverlayTemplate = {
  name: 'note',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  styles: { text: boxStyles },
  createPointFigures: ({ overlay, coordinates }) => {
    if (coordinates.length < 1) return []
    return [{ type: 'text', attrs: { x: coordinates[0].x, y: coordinates[0].y, text: str(overlay, drawingLabel('drawing_note')), align: 'left', baseline: 'middle' } }]
  },
}

// Callout — a note box (2nd point) with a leader line to the anchor (1st point).
export const callout: OverlayTemplate = {
  name: 'callout',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  styles: { text: boxStyles },
  createPointFigures: ({ overlay, coordinates }) => {
    if (coordinates.length < 1) return []
    const anchor = coordinates[0]
    const labelPos = coordinates[1] ?? { x: anchor.x + 44, y: anchor.y - 44 }
    return [
      { type: 'line', ignoreEvent: true, attrs: { coordinates: [anchor, labelPos] } },
      { type: 'text', attrs: { x: labelPos.x, y: labelPos.y, text: str(overlay, drawingLabel('drawing_callout')), align: 'left', baseline: 'middle' } },
    ]
  },
}

// Price label — auto-renders the anchored price (no text input needed).
export const priceLabel: OverlayTemplate = {
  name: 'priceLabel',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  styles: { text: smallBoxStyles },
  createPointFigures: ({ overlay, coordinates, precision }) => {
    if (coordinates.length < 1) return []
    const v = overlay.points[0]?.value ?? 0
    return [{ type: 'text', attrs: { x: coordinates[0].x, y: coordinates[0].y, text: v.toFixed(precision.price), align: 'left', baseline: 'middle' } }]
  },
}

// Signpost — text on a short post planted at the bar.
export const signpost: OverlayTemplate = {
  name: 'signpost',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  styles: { text: smallBoxStyles },
  createPointFigures: ({ overlay, coordinates }) => {
    if (coordinates.length < 1) return []
    const { x, y } = coordinates[0]
    return [
      { type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x, y }, { x, y: y - 26 }] } },
      { type: 'text', attrs: { x, y: y - 26, text: str(overlay, drawingLabel('drawing_sign')), align: 'center', baseline: 'bottom' } },
    ]
  },
}
