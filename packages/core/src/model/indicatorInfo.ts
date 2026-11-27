// SPDX-License-Identifier: GPL-3.0-or-later

/** The family an indicator belongs to, for grouping a picker. `levels` are lines at prices (pivots, previous highs). */
export type IndicatorGroup = 'trend' | 'momentum' | 'volatility' | 'volume' | 'levels'
export const INDICATOR_GROUPS: readonly IndicatorGroup[] = Object.freeze(['trend', 'momentum', 'volatility', 'volume', 'levels'] as const)

export interface IndicatorInfo {
  /** The name a person reads; the registry name stays the identifier in documents and APIs. */
  readonly label: string
  readonly group: IndicatorGroup
  /** Extra words that find it: the long name, other spellings, the same thing in Chinese. */
  readonly keywords: string
  /** Same calculation as another registered indicator; a picker may leave it out. */
  readonly duplicateOf?: string
}

const info = (label: string, group: IndicatorGroup, keywords = '', duplicateOf?: string): IndicatorInfo =>
  Object.freeze({ label, group, keywords, ...(duplicateOf === undefined ? {} : { duplicateOf }) })

/** Names, families and search words of every indicator the package ships (the built-ins, the technical pack and the classic pack). */
export const INDICATOR_INFO: Readonly<Record<string, IndicatorInfo>> = Object.freeze({
  MA: info('Moving Average', 'trend', 'sma simple moving average 均線 移動平均'),
  EMA: info('Exponential Moving Average', 'trend', 'ema 指數移動平均'),
  BOLL: info('Bollinger Bands', 'volatility', 'boll bb bands 布林通道'),
  VOL: info('Volume', 'volume', 'volume 成交量'),
  MACD: info('MACD', 'momentum', 'moving average convergence divergence 指數平滑異同'),
  RSI: info('Relative Strength Index', 'momentum', 'rsi 相對強弱'),
  KDJ: info('KDJ', 'momentum', 'stochastic kd 隨機指標'),
  CCI: info('Commodity Channel Index', 'momentum', 'cci 順勢指標'),
  DMI: info('Directional Movement Index', 'trend', 'dmi adx adxr pdi mdi 趨向指標'),
  CR: info('CR Energy', 'momentum', 'cr 能量'),
  PSY: info('Psychological Line', 'momentum', 'psy 心理線'),
  DMA: info('Different of Moving Average', 'trend', 'dma 平行線差'),
  TRIX: info('TRIX', 'momentum', 'trix triple exponential 三重指數'),
  OBV: info('On Balance Volume', 'volume', 'obv 能量潮'),
  VR: info('Volume Ratio', 'volume', 'vr 成交量比率'),
  WR: info('Williams %R', 'momentum', 'wr williams percent r 威廉指標'),
  MTM: info('Momentum', 'momentum', 'mtm 動量'),
  EMV: info('Ease of Movement', 'volume', 'emv 簡易波動'),
  ROC: info('Rate of Change', 'momentum', 'roc 變動率'),
  PVT: info('Price Volume Trend', 'volume', 'pvt 量價趨勢'),
  AO: info('Awesome Oscillator', 'momentum', 'ao 動量震盪'),
  SAR: info('Parabolic SAR', 'trend', 'sar stop and reverse 拋物線'),
  BIAS: info('Bias', 'momentum', 'bias 乖離率'),
  BRAR: info('BRAR', 'momentum', 'brar 人氣意願'),
  SMA: info('Smoothed Moving Average', 'trend', 'sma smoothed 平滑移動平均'),
  BBI: info('Bull and Bear Index', 'trend', 'bbi 多空指標'),
  SC_RSI: info('Relative Strength Index', 'momentum', 'rsi', 'RSI'),
  SC_MACD: info('MACD', 'momentum', 'macd', 'MACD'),
  SC_SMA: info('Moving Average', 'trend', 'sma', 'MA'),
  SC_ATR: info('Average True Range', 'volatility', 'atr 真實波幅'),
  SC_ATR_BANDS: info('ATR Bands', 'volatility', 'atr bands 波幅通道'),
  SC_KELTNER: info('Keltner Channel', 'volatility', 'keltner channels 肯特納通道'),
  SC_DONCHIAN: info('Donchian Channel', 'volatility', 'donchian channels 唐奇安通道'),
  SC_VWAP: info('VWAP', 'volume', 'volume weighted average price anchored 成交量加權平均價'),
  SC_STOCH: info('Stochastic', 'momentum', 'stochastic oscillator kd 隨機震盪'),
  SC_STOCHRSI: info('Stochastic RSI', 'momentum', 'stochrsi stochastic rsi'),
  SC_MFI: info('Money Flow Index', 'volume', 'mfi 資金流量'),
  SC_BBP: info('Bollinger %B', 'volatility', 'bbp percent b %b 布林百分比'),
  SC_SUPERTREND: info('Supertrend', 'trend', 'supertrend 超級趨勢'),
  SC_ICHIMOKU: info('Ichimoku Cloud', 'trend', 'ichimoku kinko hyo cloud 一目均衡表'),
  SC_PDHL: info('Previous Day High / Low', 'levels', 'pdhl previous high low 前日高低 前一日'),
  SC_WMA: info('Weighted Moving Average', 'trend', 'wma 加權移動平均'),
  SC_HMA: info('Hull Moving Average', 'trend', 'hma hull'),
  SC_DEMA: info('Double Exponential Moving Average', 'trend', 'dema'),
  SC_TEMA: info('Triple Exponential Moving Average', 'trend', 'tema'),
  SC_VWMA: info('Volume Weighted Moving Average', 'trend', 'vwma'),
  SC_KAMA: info('Kaufman Adaptive Moving Average', 'trend', 'kama adaptive'),
  SC_CVD: info('Cumulative Volume Delta', 'volume', 'cvd delta 累積成交量差'),
  SC_CVD_EST: info('Cumulative Volume Delta (estimate)', 'volume', 'cvd delta estimate'),
  SC_AROON: info('Aroon', 'trend', 'aroon up down 阿隆'),
  SC_CMF: info('Chaikin Money Flow', 'volume', 'cmf chaikin 蔡金資金流'),
  SC_ADL: info('Accumulation / Distribution', 'volume', 'adl ad accumulation distribution 累積派發'),
  SC_FORCE: info('Force Index', 'volume', 'force index 強力指標'),
  SC_VORTEX: info('Vortex', 'trend', 'vortex vi 渦旋'),
  SC_TSI: info('True Strength Index', 'momentum', 'tsi 真實強度'),
  SC_ULTIMATE: info('Ultimate Oscillator', 'momentum', 'ultimate uo 終極震盪'),
  SC_ZIGZAG: info('ZigZag', 'trend', 'zigzag 轉折'),
  SC_PIVOTS: info('Pivot Points', 'levels', 'pivot points classic fibonacci 樞軸點 支撐壓力'),
  SC_CHANDELIER: info('Chandelier Exit', 'volatility', 'chandelier exit 吊燈停損')
})

/** What to call an indicator: its known label, or the registry name without a pack prefix. */
export function indicatorInfo (name: string): IndicatorInfo {
  return INDICATOR_INFO[name] ?? info(name.replace(/^SC_/, '').replace(/_/g, ' '), 'trend', name.toLowerCase())
}

/** The short form for a legend row: the registry name without a pack prefix (`SC_ATR` reads `ATR`). */
export function indicatorShortName (name: string): string { return name.replace(/^SC_/, '').replace(/_/g, ' ') }

/** The name a person reads for one indicator. */
export function indicatorLabel (name: string): string { return indicatorInfo(name).label }

/**
 * The registered names that match `query`, best first: an exact name or label, then names or labels that start with it, then
 * names, labels and keywords that contain every word. An empty query returns every name that is not a duplicate of another,
 * in family order.
 */
export function searchIndicators (names: readonly string[], query: string): string[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const order = new Map(names.map((name, index) => [name, index]))
  const shown = names.filter(name => { const twin = INDICATOR_INFO[name]?.duplicateOf; return twin === undefined || !names.includes(twin) })
  if (words.length === 0) {
    return [...shown].sort((a, b) => INDICATOR_GROUPS.indexOf(indicatorInfo(a).group) - INDICATOR_GROUPS.indexOf(indicatorInfo(b).group) || (order.get(a) ?? 0) - (order.get(b) ?? 0))
  }
  const scored: Array<{ name: string, score: number }> = []
  for (const name of shown) {
    const i = indicatorInfo(name), id = name.toLowerCase().replace(/^sc_/, ''), label = i.label.toLowerCase(), haystack = `${id} ${label} ${i.keywords.toLowerCase()} ${i.group}`
    if (!words.every(word => haystack.includes(word))) continue
    const joined = words.join(' ')
    const score = id === joined || label === joined ? 0 : id.startsWith(joined) || label.startsWith(joined) ? 1 : label.split(/[\s/]+/).some(part => part.startsWith(words[0])) ? 2 : 3
    scored.push({ name, score })
  }
  return scored.sort((a, b) => a.score - b.score || (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0)).map(item => item.name)
}
