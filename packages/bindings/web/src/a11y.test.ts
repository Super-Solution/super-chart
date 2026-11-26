import { compileSession } from '@supersolutions/super-chart-core'
import { describe, expect, it } from 'vitest'

import { barReadoutText, defaultBar } from './a11y'

const session = compileSession({ timezone: 'America/New_York', regular: '0930-1600', pre: '0400-0930', post: '1600-2000' }).session
const bar = (hour: number, minute: number): { timestamp: number, open: number, high: number, low: number, close: number } =>
  ({ timestamp: Date.UTC(2026, 10, 25, hour, minute), open: 10, high: 11, low: 9, close: 10.5 }) // New York is UTC-5 in late November

describe('barReadoutText with a trading session', () => {
  const options = { session, timespan: 'minute', timeZone: 'UTC' }
  it('names pre-market and after hours, and nothing for regular or closed hours', () => {
    expect(barReadoutText(bar(14, 15), undefined, 2, options).session).toBe('pre')
    expect(barReadoutText(bar(14, 30), undefined, 2, options).session).toBe('')
    expect(barReadoutText(bar(21, 0), undefined, 2, options).session).toBe('post')
    expect(barReadoutText(bar(2, 0), undefined, 2, options).session).toBe('')
    expect(defaultBar(barReadoutText(bar(14, 15), undefined, 2, options))).toMatch(/, pre-market$/)
    expect(defaultBar(barReadoutText(bar(21, 0), undefined, 2, options))).toMatch(/, after hours$/)
  })

  it('has no session wording without a schedule or on a day-or-longer bar', () => {
    expect(barReadoutText(bar(14, 15), undefined, 2, { timespan: 'minute' }).session).toBe('')
    expect(barReadoutText(bar(14, 15), undefined, 2, { ...options, timespan: 'day' }).session).toBe('')
  })
})
