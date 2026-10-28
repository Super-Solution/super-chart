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

/**
 * Per-indicator settings-form schema (SC-163). Bounds now match what the
 * engine actually accepts (SAR, BOLL); MACD's duplicated `params_2` is fixed
 * to `params_3`. `fromStore`/`toStore` convert between calcParams' stored
 * units and what the form shows — only SAR needs this (klinecharts stores it
 * in hundredths; the form shows the TradingView decimal).
 */
export interface SettingParam {
  paramNameKey: string
  precision: number
  min?: number
  max?: number
  default?: number
  styleKey?: string
  /** Value shown in the field, given the stored calcParams value. */
  fromStore?: (v: number) => number
  /** Stored calcParams value, given what the field shows. */
  toStore?: (v: number) => number
}

const hundredths = { fromStore: (v: number) => v / 100, toStore: (v: number) => Math.round(v * 100) }

export default {
  AO: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 5 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 34 }
  ],
  BIAS: [
    { paramNameKey: 'BIAS1', precision: 0, min: 1, styleKey: 'lines[0].color' },
    { paramNameKey: 'BIAS2', precision: 0, min: 1, styleKey: 'lines[1].color' },
    { paramNameKey: 'BIAS3', precision: 0, min: 1, styleKey: 'lines[2].color' },
    { paramNameKey: 'BIAS4', precision: 0, min: 1, styleKey: 'lines[3].color' },
    { paramNameKey: 'BIAS5', precision: 0, min: 1, styleKey: 'lines[4].color' }
  ],
  BOLL: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 20 },
    // TradingView allows a standard deviation as low as 0.001; 0.1 covers real use without inviting a near-zero band.
    { paramNameKey: 'standard_deviation', precision: 1, min: 0.1, default: 2 }
  ],
  BRAR: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 26 }
  ],
  BBI: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 3 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 6 },
    { paramNameKey: 'params_3', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'params_4', precision: 0, min: 1, default: 24 }
  ],
  CCI: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 20 }
  ],
  CR: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 26 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'params_3', precision: 0, min: 1, default: 20 },
    { paramNameKey: 'params_4', precision: 0, min: 1, default: 40 },
    { paramNameKey: 'params_5', precision: 0, min: 1, default: 60 }
  ],
  DMA: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 50 },
    { paramNameKey: 'params_3', precision: 0, min: 1, default: 10 }
  ],
  DMI: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 14 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 6 }
  ],
  EMV: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 14 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 9 }
  ],
  EMA: [
    { paramNameKey: 'EMA1', precision: 0, min: 1, styleKey: 'lines[0].color' },
    { paramNameKey: 'EMA2', precision: 0, min: 1, styleKey: 'lines[1].color' },
    { paramNameKey: 'EMA3', precision: 0, min: 1, styleKey: 'lines[2].color' },
    { paramNameKey: 'EMA4', precision: 0, min: 1, styleKey: 'lines[3].color' },
    { paramNameKey: 'EMA5', precision: 0, min: 1, styleKey: 'lines[4].color' }
  ],
  MTM: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 6 }
  ],
  MA: [
    { paramNameKey: 'MA1', precision: 0, min: 1, styleKey: 'lines[0].color' },
    { paramNameKey: 'MA2', precision: 0, min: 1, styleKey: 'lines[1].color' },
    { paramNameKey: 'MA3', precision: 0, min: 1, styleKey: 'lines[2].color' },
    { paramNameKey: 'MA4', precision: 0, min: 1, styleKey: 'lines[3].color' },
    { paramNameKey: 'MA5', precision: 0, min: 1, styleKey: 'lines[4].color' }
  ],
  // TradingView's names for MACD's three lengths.
  MACD: [
    { paramNameKey: 'fast_length', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'slow_length', precision: 0, min: 1, default: 26 },
    { paramNameKey: 'signal_smoothing', precision: 0, min: 1, default: 9 }
  ],
  OBV: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 30 }
  ],
  PVT: [],
  PSY: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 6 }
  ],
  ROC: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 6 }
  ],
  RSI: [
    { paramNameKey: 'RSI1', precision: 0, min: 1, styleKey: 'lines[0].color' },
    { paramNameKey: 'RSI2', precision: 0, min: 1, styleKey: 'lines[1].color' },
    { paramNameKey: 'RSI3', precision: 0, min: 1, styleKey: 'lines[2].color' },
    { paramNameKey: 'RSI4', precision: 0, min: 1, styleKey: 'lines[3].color' },
    { paramNameKey: 'RSI5', precision: 0, min: 1, styleKey: 'lines[4].color' }
  ],
  SMA: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 2 }
  ],
  KDJ: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 9 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 3 },
    { paramNameKey: 'params_3', precision: 0, min: 1, default: 3 }
  ],
  SAR: [
    // Stored in hundredths (klinecharts SAR); shown in TradingView's own units.
    { paramNameKey: 'params_1', precision: 2, min: 0.01, max: 5, default: 2, ...hundredths },
    { paramNameKey: 'params_2', precision: 2, min: 0.01, max: 5, default: 2, ...hundredths },
    { paramNameKey: 'params_3', precision: 2, min: 0.01, max: 20, default: 20, ...hundredths }
  ],
  TRIX: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 9 }
  ],
  VOL: [
    { paramNameKey: 'MA1', precision: 0, min: 1, styleKey: 'lines[0].color' },
    { paramNameKey: 'MA2', precision: 0, min: 1, styleKey: 'lines[1].color' },
    { paramNameKey: 'MA3', precision: 0, min: 1, styleKey: 'lines[2].color' },
    { paramNameKey: 'MA4', precision: 0, min: 1, styleKey: 'lines[3].color' },
    { paramNameKey: 'MA5', precision: 0, min: 1, styleKey: 'lines[4].color' }
  ],
  VR: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 26 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 6 }
  ],
  WR: [
    { paramNameKey: 'WR1', precision: 0, min: 1, styleKey: 'lines[0].color' },
    { paramNameKey: 'WR2', precision: 0, min: 1, styleKey: 'lines[1].color' },
    { paramNameKey: 'WR3', precision: 0, min: 1, styleKey: 'lines[2].color' },
    { paramNameKey: 'WR4', precision: 0, min: 1, styleKey: 'lines[3].color' },
    { paramNameKey: 'WR5', precision: 0, min: 1, styleKey: 'lines[4].color' }
  ],

  // ---- SC_* pack (SC-155/160/167/168/169/170/171) ----
  SC_RSI: [{ paramNameKey: 'params_1', precision: 0, min: 1, default: 14 }],
  SC_MACD: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 26 },
    { paramNameKey: 'params_3', precision: 0, min: 1, default: 9 }
  ],
  SC_SMA: [{ paramNameKey: 'params_1', precision: 0, min: 1, default: 9 }],
  SC_VWAP: [
    { paramNameKey: 'params_1', precision: 0, min: 0, max: 4, default: 0 },
    { paramNameKey: 'params_2', precision: 0, min: -720, max: 720, default: 0 },
    { paramNameKey: 'params_3', precision: 1, min: 0.1, default: 2 }
  ],
  SC_ATR: [{ paramNameKey: 'params_1', precision: 0, min: 1, default: 14 }],
  SC_STOCH: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 14 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 1 },
    { paramNameKey: 'params_3', precision: 0, min: 1, default: 3 }
  ],
  SC_STOCHRSI: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 14 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 14 },
    { paramNameKey: 'params_3', precision: 0, min: 1, default: 3 },
    { paramNameKey: 'params_4', precision: 0, min: 1, default: 3 }
  ],
  SC_BBP: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 20 },
    { paramNameKey: 'params_2', precision: 1, min: 0.1, default: 2 }
  ],
  SC_MFI: [{ paramNameKey: 'params_1', precision: 0, min: 1, default: 14 }],
  SC_SUPERTREND: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'params_2', precision: 1, min: 0.1, default: 3 }
  ],
  SC_KELTNER: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 20 },
    { paramNameKey: 'params_2', precision: 1, min: 0.1, default: 2 },
    { paramNameKey: 'params_3', precision: 0, min: 1, default: 10 }
  ],
  SC_DONCHIAN: [{ paramNameKey: 'params_1', precision: 0, min: 1, default: 20 }],
  SC_ATR_BANDS: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 14 },
    { paramNameKey: 'params_2', precision: 1, min: 0.1, default: 2 }
  ],
  SC_ICHIMOKU: [
    { paramNameKey: 'params_1', precision: 0, min: 1, default: 9 },
    { paramNameKey: 'params_2', precision: 0, min: 1, default: 26 },
    { paramNameKey: 'params_3', precision: 0, min: 1, default: 52 },
    { paramNameKey: 'params_4', precision: 0, min: 1, default: 26 }
  ],
  SC_VRVP: [{ paramNameKey: 'params_1', precision: 0, min: 2, default: 24 }]
} as Record<string, SettingParam[]>
