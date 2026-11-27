import { describe, expect, it } from 'vitest'
import { resolveIntervalControl, resolveLayout } from './layout'

describe('workspace layout', () => {
  it('shows the interval bar only where it fits and is not a phone', () => {
    expect(resolveIntervalControl('auto', 'regular')).toBe('bar')
    expect(resolveIntervalControl('auto', 'compact', true)).toBe('bar')
    expect(resolveIntervalControl('auto', 'compact', false)).toBe('select')
    expect(resolveIntervalControl('auto', 'narrow', true)).toBe('select')
  })

  it('leaves an explicit choice alone, fit or not', () => {
    expect(resolveIntervalControl('bar', 'narrow', false)).toBe('bar')
    expect(resolveIntervalControl('select', 'regular', true)).toBe('select')
  })

  it('keeps the size-class thresholds', () => {
    expect(resolveLayout('auto', 559)).toBe('narrow')
    expect(resolveLayout('auto', 560)).toBe('compact')
    expect(resolveLayout('auto', 1039)).toBe('compact')
    expect(resolveLayout('auto', 1040)).toBe('regular')
    expect(resolveLayout('auto', 0)).toBe('regular')
  })
})
