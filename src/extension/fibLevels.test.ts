import { describe, expect, it } from 'vitest'

import { EXTENSION_LEVELS, readLevels, RETRACEMENT_LEVELS } from './fibLevels'

describe('readLevels (SC-179)', () => {
  it('falls back to the defaults, in the defaults\' own order, with no extendData', () => {
    expect(readLevels({}, RETRACEMENT_LEVELS)).toEqual({ levels: [...RETRACEMENT_LEVELS] })
    expect(readLevels({ extendData: undefined }, RETRACEMENT_LEVELS)).toEqual({ levels: [...RETRACEMENT_LEVELS] })
  })

  it('falls back to the defaults for the string extendData the text tools use', () => {
    expect(readLevels({ extendData: 'My label' }, EXTENSION_LEVELS)).toEqual({ levels: [...EXTENSION_LEVELS] })
  })

  it('falls back to the defaults for a levels field that is not an array, or an array with no finite numbers', () => {
    expect(readLevels({ extendData: { levels: 'nope' } }, RETRACEMENT_LEVELS)).toEqual({ levels: [...RETRACEMENT_LEVELS] })
    expect(readLevels({ extendData: { levels: ['a', NaN, Infinity, null] } }, RETRACEMENT_LEVELS)).toEqual({ levels: [...RETRACEMENT_LEVELS] })
  })

  it('accepts a custom level set, including negative levels, sorted ascending', () => {
    expect(readLevels({ extendData: { levels: [1, 0, 0.5] } }, RETRACEMENT_LEVELS)).toEqual({ levels: [0, 0.5, 1] })
    expect(readLevels({ extendData: { levels: [1.618, -0.618, 0] } }, RETRACEMENT_LEVELS)).toEqual({ levels: [-0.618, 0, 1.618] })
  })

  it('dedupes and caps at 24 entries', () => {
    expect(readLevels({ extendData: { levels: [0, 0, 0.5, 0.5, 1] } }, RETRACEMENT_LEVELS)).toEqual({ levels: [0, 0.5, 1] })
    const many = Array.from({ length: 40 }, (_, i) => i)
    expect(readLevels({ extendData: { levels: many } }, RETRACEMENT_LEVELS).levels).toHaveLength(24)
  })

  it('drops non-finite entries but keeps the finite ones from a mixed array', () => {
    expect(readLevels({ extendData: { levels: [0, NaN, 1, Infinity, 0.5] } }, RETRACEMENT_LEVELS)).toEqual({ levels: [0, 0.5, 1] })
  })

  it('default sets: retracement is unchanged; extension now reaches 161.8% and beyond', () => {
    expect(RETRACEMENT_LEVELS).toEqual([1, 0.786, 0.618, 0.5, 0.382, 0.236, 0])
    expect(EXTENSION_LEVELS).toContain(1.618)
    expect(EXTENSION_LEVELS).toContain(2.618)
  })
})
