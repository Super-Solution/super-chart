import { describe, expect, it } from 'vitest'
import { tailMode, paramsKey, type TailCache } from './tail'

describe('tailMode', () => {
  const ref = [1, 2, 3]

  it('is full with no cache, a different reference, or different params', () => {
    expect(tailMode(null, ref, 'k')).toBe('full')
    const cache: TailCache<null> = { ref: [9], length: 3, paramsKey: 'k', state: null }
    expect(tailMode(cache, ref, 'k')).toBe('full')
    const cache2: TailCache<null> = { ref, length: 3, paramsKey: 'other', state: null }
    expect(tailMode(cache2, ref, 'k')).toBe('full')
  })

  it('is append when the same reference grew by exactly one', () => {
    const cache: TailCache<null> = { ref, length: 2, paramsKey: 'k', state: null }
    expect(tailMode(cache, ref, 'k')).toBe('append')
  })

  it('is replace when the same reference kept its length', () => {
    const cache: TailCache<null> = { ref, length: 3, paramsKey: 'k', state: null }
    expect(tailMode(cache, ref, 'k')).toBe('replace')
  })

  it('is full for anything else (a prepend, a reload, a jump of more than one bar)', () => {
    const cache: TailCache<null> = { ref, length: 10, paramsKey: 'k', state: null }
    expect(tailMode(cache, ref, 'k')).toBe('full')
    const cache2: TailCache<null> = { ref, length: 0, paramsKey: 'k', state: null }
    expect(tailMode(cache2, ref, 'k')).toBe('full')
  })
})

describe('paramsKey', () => {
  it('is stable for equal arrays and distinct for different ones', () => {
    expect(paramsKey([14])).toBe(paramsKey([14]))
    expect(paramsKey([14])).not.toBe(paramsKey([15]))
  })
})
