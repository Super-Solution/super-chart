// Compatibility facade: one renderer-free transform for Web and native hosts.
import type { KLineData } from 'klinecharts'
import { toHeikinAshi } from '../core/heikinAshi'
export { toHeikinAshi, isHeikinAshiUp } from '../core/heikinAshi'
export type { OhlcBar } from '../core/heikinAshi'

/** Retained Web compatibility helper; the core has no KLineChart dependency. */
export function assertKLineDataCompatible (bars: readonly KLineData[]): KLineData[] {
  return toHeikinAshi(bars)
}
