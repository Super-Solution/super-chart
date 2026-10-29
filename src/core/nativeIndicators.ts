/** Native MA20/EMA21 compatibility: preserves the existing first-close EMA seed. */
import type { FinancialCandle } from './financialModel'
export type NativeCandle = FinancialCandle
export function indicatorSeries(candles: readonly NativeCandle[], indicators: string[] = []) {
  const has = (name: string) => indicators.some(value => value.toUpperCase() === name || value.toUpperCase().startsWith(`${name}(`));
  const out: Array<{ values: Array<number | null>; dash?: string; tag: string }> = [];
  if (has('MA')) {
    let sum = 0;
    out.push({
      tag: 'MA20',
      values: candles.map((k, i) => {
        sum += k.c;
        if (i >= 20) sum -= candles[i - 20].c;
        return i >= 19 ? sum / 20 : null;
      })
    });
  }
  if (has('EMA')) {
    let prev: number | null = null;
    out.push({
      tag: 'EMA21',
      dash: '5 3',
      values: candles.map((k, i) => {
        prev = prev == null ? k.c : k.c * (2 / 22) + prev * (1 - 2 / 22);
        return i >= 20 ? prev : null;
      })
    });
  }
  return out;
}
