// SPDX-License-Identifier: GPL-3.0-or-later
import type { EngineChartType } from '@supersolutions/super-chart-core'

/** The chart types a person can pick, in the order the quick menu lists them (point and figure comes from the price mode, not from here). */
export const CHART_TYPE_GROUPS: ReadonlyArray<ReadonlyArray<Exclude<EngineChartType, 'point-figure'>>> = [
  ['candles', 'hollow-candles', 'outline-candles', 'hollow-down-candles'],
  ['ohlc', 'high-low', 'columns', 'volume-bars'],
  ['line', 'line-markers', 'step-line', 'area', 'hlc-area', 'baseline']
]
