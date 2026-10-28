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

// The rail's per-group option lists: pure data (name + i18n label), split out
// of ./index.ts so it can be imported from a plain *.test.ts (or from
// widget/drawing-bar/state.ts) without pulling in the ~70 icon components'
// .tsx files. Vitest's config for this project has no Solid/JSX plugin (by
// design, so unit tests stay framework-free): a .test.ts that transitively
// imports a .tsx file fails to even parse ("Failed to parse source for
// import analysis"), because this project's tsconfig sets `jsx: "preserve"`
// for vite-plugin-solid's own Babel pass, and nothing undoes that under
// vitest. ./index.ts re-exports everything here, so drawing-bar/index.tsx's
// existing `from './icons'` import keeps working unchanged.
//
// Part of SUPer-Chart (Apache-2.0).

import type { SelectDataSourceItem } from '../../../component'

import i18n from '../../../i18n'

// TradingView conventions, adopted for this group (SC-118): 'segment' is a
// two-point Trend Line and comes first; 'straightLine' extends across the
// whole pane and is relabelled "Extended Line" so it is not confused with it.
export function createSingleLineOptions (locale: string): SelectDataSourceItem[] {
  return  [
    { key: 'segment', text: i18n('segment', locale) },
    { key: 'rayLine', text: i18n('ray_line', locale) },
    { key: 'straightLine', text: i18n('straight_line', locale) },
    { key: 'horizontalStraightLine', text: i18n('horizontal_straight_line', locale) },
    { key: 'horizontalRayLine', text: i18n('horizontal_ray_line', locale) },
    { key: 'horizontalSegment', text: i18n('horizontal_segment', locale) },
    { key: 'verticalStraightLine', text: i18n('vertical_straight_line', locale) },
    { key: 'verticalRayLine', text: i18n('vertical_ray_line', locale) },
    { key: 'verticalSegment', text: i18n('vertical_segment', locale) },
    { key: 'arrow', text: i18n('arrow', locale) },
    { key: 'arrowUp', text: 'Arrow Up' },
    { key: 'arrowDown', text: 'Arrow Down' },
    { key: 'priceLine', text: i18n('price_line', locale) },
    { key: 'curve', text: 'Curve' },
    { key: 'arc', text: 'Arc' },
    { key: 'doubleCurve', text: 'Double Curve' },
    { key: 'flag', text: 'Flag' }
  ]
}

export function createMoreLineOptions (locale: string): SelectDataSourceItem[] {
  return [
    { key: 'priceChannelLine', text: i18n('price_channel_line', locale) },
    { key: 'parallelStraightLine', text: i18n('parallel_straight_line', locale) },
    { key: 'pitchfork', text: 'Pitchfork' },
    { key: 'schiff', text: 'Schiff Pitchfork' },
    { key: 'modifiedSchiff', text: 'Modified Schiff' },
    { key: 'regressionTrend', text: 'Regression Trend' },
    { key: 'disjointChannel', text: 'Disjoint Channel' }
  ]
}

export function createPolygonOptions (locale: string): SelectDataSourceItem[] {
  return [
    { key: 'circle', text: i18n('circle', locale) },
    { key: 'ellipse', text: 'Ellipse' },
    { key: 'rect', text: i18n('rect', locale) },
    { key: 'rotatedRect', text: 'Rotated Rectangle' },
    { key: 'parallelogram', text: i18n('parallelogram', locale) },
    { key: 'triangle', text: i18n('triangle', locale) }
  ]
}

export function createFibonacciOptions (locale: string): SelectDataSourceItem[] {
  return [
    { key: 'fibonacciLine', text: i18n('fibonacci_line', locale) },
    { key: 'fibonacciSegment', text: i18n('fibonacci_segment', locale) },
    { key: 'fibonacciCircle', text: i18n('fibonacci_circle', locale) },
    { key: 'fibonacciSpiral', text: i18n('fibonacci_spiral', locale) },
    { key: 'fibonacciSpeedResistanceFan', text: i18n('fibonacci_speed_resistance_fan', locale) },
    { key: 'fibonacciExtension', text: i18n('fibonacci_extension', locale) },
    { key: 'fibonacciTimeZone', text: 'Fib Time Zone' },
    { key: 'gannBox', text: i18n('gann_box', locale) },
    { key: 'gannFan', text: 'Gann Fan' },
    { key: 'gannSquare', text: 'Gann Square' },
    { key: 'fibonacciSpeedResistanceArc', text: 'Fib Speed/Resistance Arc' }
  ]
}

export function createWaveOptions (locale: string): SelectDataSourceItem[] {
  return [
    { key: 'xabcd', text: i18n('xabcd', locale) },
    { key: 'abcd', text: i18n('abcd', locale) },
    { key: 'threeWaves', text: i18n('three_waves', locale) },
    { key: 'fiveWaves', text: i18n('five_waves', locale) },
    { key: 'eightWaves', text: i18n('eight_waves', locale) },
    { key: 'anyWaves', text: i18n('any_waves', locale) },
  ]
}

export function createPositionOptions (_locale: string): SelectDataSourceItem[] {
  return [
    { key: 'positionLong', text: 'Long Position' },
    { key: 'positionShort', text: 'Short Position' }
  ]
}

export function createMeasureOptions (_locale: string): SelectDataSourceItem[] {
  return [
    { key: 'priceRange', text: 'Price Range' },
    { key: 'dateRange', text: 'Date Range' },
    { key: 'priceDateRange', text: 'Date & Price Range' },
    { key: 'forecast', text: 'Forecast' }
  ]
}

export function createTextOptions (_locale: string): SelectDataSourceItem[] {
  return [
    { key: 'text', text: 'Text' },
    { key: 'note', text: 'Note' },
    { key: 'callout', text: 'Callout' },
    { key: 'priceLabel', text: 'Price Label' },
    { key: 'signpost', text: 'Signpost' },
    { key: 'pin', text: 'Pin' },
    { key: 'image', text: 'Image' }
  ]
}

export function createVolumeOptions (_locale: string): SelectDataSourceItem[] {
  return [
    { key: 'anchoredVWAP', text: 'Anchored VWAP' },
    { key: 'fixedRangeVolumeProfile', text: 'Volume Profile' },
    { key: 'anchoredVolumeProfile', text: 'Anchored Volume Profile' }
  ]
}

export function createBrushOptions (_locale: string): SelectDataSourceItem[] {
  return [
    { key: 'brush', text: 'Brush' },
    { key: 'highlighter', text: 'Highlighter' }
  ]
}

export function createMagnetOptions (locale: string): SelectDataSourceItem[] {
  return [
    { key: 'weak_magnet', text: i18n('weak_magnet', locale) },
    { key: 'strong_magnet', text: i18n('strong_magnet', locale) }
  ]
}
