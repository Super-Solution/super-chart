import { describe, expect, it } from 'vitest'

import {
  ChartError, checkDrawingTool, checkIndicatorName, checkNumber, checkOneOf, checkPeriodObject, checkSymbol,
  checkTimezone, getSupportedTimespans, isChartError, nearest
} from './errors'

describe('SC-134: ChartError', () => {
  it('is a real Error (name, message, instanceof), so existing try/catch keeps working', () => {
    const e = new ChartError({ code: 'UNKNOWN_INDICATOR', field: 'name', received: 'RSII', allowed: ['RSI'], hint: "Did you mean 'RSI'?" })
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(ChartError)
    expect(e.name).toBe('ChartError')
    expect(e.code).toBe('UNKNOWN_INDICATOR')
    expect(e.message).toContain('RSII')
    expect(e.message).toContain("Did you mean 'RSI'?")
  })

  it('toJSON gives a plain, JSON-safe object an MCP tool can return', () => {
    const e = new ChartError({ code: 'INVALID_PERIOD', field: 'period.timespan', received: 'hours', allowed: ['hour', 'day'] })
    const json = JSON.parse(JSON.stringify(e.toJSON()))
    expect(json).toEqual({ name: 'ChartError', message: e.message, code: 'INVALID_PERIOD', field: 'period.timespan', received: 'hours', allowed: ['hour', 'day'] })
  })

  it('received is made JSON-safe even when it is not (a function, a circular object)', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const e = new ChartError({ code: 'INVALID_ARGUMENT', field: 'x', received: circular })
    expect(() => JSON.stringify(e.toJSON())).not.toThrow()
  })

  it('isChartError recognizes a ChartError, and rejects a plain Error', () => {
    expect(isChartError(new ChartError({ code: 'NOT_READY', field: 'x', received: 1 }))).toBe(true)
    expect(isChartError(new Error('boom'))).toBe(false)
    expect(isChartError('ChartError')).toBe(false)
    expect(isChartError(null)).toBe(false)
  })

  it('isChartError recognizes an error with the same name and a code from a different copy of the package', () => {
    class OtherPackageError extends Error {
      code = 'UNKNOWN_INDICATOR'
      constructor () { super('other'); this.name = 'ChartError' }
    }
    expect(isChartError(new OtherPackageError())).toBe(true)
  })
})

describe('SC-134: nearest / didYouMean data', () => {
  it('matches ignoring case first', () => {
    expect(nearest('rsi', ['RSI', 'MACD'])).toBe('RSI')
  })

  it('matches a plural against its singular', () => {
    expect(nearest('hours', ['hour', 'day'])).toBe('hour')
  })

  it('matches a small typo within the edit-distance budget', () => {
    expect(nearest('RSII', ['RSI', 'MACD'])).toBe('RSI')
  })

  it('gives no suggestion when nothing is close', () => {
    expect(nearest('completely-unrelated-name', ['RSI', 'MACD'])).toBeUndefined()
  })

  it('gives no suggestion for a non-string or empty input', () => {
    expect(nearest(42, ['RSI'])).toBeUndefined()
    expect(nearest('', ['RSI'])).toBeUndefined()
  })
})

describe('SC-134: checkPeriodObject', () => {
  it('accepts a well-formed period and fills in a default text', () => {
    expect(checkPeriodObject({ multiplier: 4, timespan: 'hour' })).toEqual({ multiplier: 4, timespan: 'hour', text: '4hour' })
  })

  it('keeps a given text', () => {
    expect(checkPeriodObject({ multiplier: 4, timespan: 'hour', text: '4H' })).toEqual({ multiplier: 4, timespan: 'hour', text: '4H' })
  })

  it('rejects a bad timespan with a near-match hint', () => {
    expect(() => checkPeriodObject({ multiplier: 1, timespan: 'hours' })).toThrow(ChartError)
    try {
      checkPeriodObject({ multiplier: 1, timespan: 'hours' })
      expect.fail('expected to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(ChartError)
      expect((e as ChartError).code).toBe('INVALID_PERIOD')
      expect((e as ChartError).hint).toContain('hour')
    }
  })

  it('rejects a non-positive or non-integer multiplier', () => {
    expect(() => checkPeriodObject({ multiplier: 0, timespan: 'hour' })).toThrow(ChartError)
    expect(() => checkPeriodObject({ multiplier: -5, timespan: 'hour' })).toThrow(ChartError)
    expect(() => checkPeriodObject({ multiplier: 1.5, timespan: 'hour' })).toThrow(ChartError)
  })

  it('rejects a non-object', () => {
    expect(() => checkPeriodObject('4H')).toThrow(ChartError)
    expect(() => checkPeriodObject(null)).toThrow(ChartError)
  })
})

describe('SC-134: checkSymbol', () => {
  it('accepts a SymbolInfo with a non-empty ticker', () => {
    expect(() => checkSymbol({ ticker: 'BTC-USDT' })).not.toThrow()
  })

  it('rejects a missing, empty or blank ticker', () => {
    expect(() => checkSymbol({})).toThrow(ChartError)
    expect(() => checkSymbol({ ticker: '' })).toThrow(ChartError)
    expect(() => checkSymbol({ ticker: '   ' })).toThrow(ChartError)
  })

  it('rejects a non-object', () => {
    expect(() => checkSymbol('BTC')).toThrow(ChartError)
    expect(() => checkSymbol(null)).toThrow(ChartError)
  })
})

describe('SC-134: checkOneOf / checkIndicatorName / checkDrawingTool', () => {
  it('returns the value when it is exactly one of the allowed set', () => {
    expect(checkOneOf('UNKNOWN_INDICATOR', 'name', 'RSI', ['RSI', 'MACD'])).toBe('RSI')
  })

  it('throws with the code, field and a hint when it is not', () => {
    expect(() => checkIndicatorName('RSII', ['RSI', 'MACD'])).toThrow(ChartError)
    try {
      checkIndicatorName('RSII', ['RSI', 'MACD'])
      expect.fail('expected to throw')
    } catch (e) {
      expect((e as ChartError).code).toBe('UNKNOWN_INDICATOR')
      expect((e as ChartError).allowed).toEqual(['RSI', 'MACD'])
      expect((e as ChartError).hint).toContain('RSI')
    }
  })

  it('checkDrawingTool uses its own code', () => {
    try {
      checkDrawingTool('fibonacciLinee', ['fibonacciLine'])
      expect.fail('expected to throw')
    } catch (e) {
      expect((e as ChartError).code).toBe('UNKNOWN_DRAWING_TOOL')
    }
  })
})

describe('SC-134: checkNumber', () => {
  it('accepts a finite number', () => {
    expect(checkNumber(42, 'x')).toBe(42)
    expect(checkNumber(0, 'x')).toBe(0)
  })

  it('rejects NaN, Infinity and non-numbers', () => {
    expect(() => checkNumber(NaN, 'x')).toThrow(ChartError)
    expect(() => checkNumber(Infinity, 'x')).toThrow(ChartError)
    expect(() => checkNumber('42', 'x')).toThrow(ChartError)
    expect(() => checkNumber(undefined, 'x')).toThrow(ChartError)
  })
})

describe('SC-134: checkTimezone', () => {
  it('accepts any zone Intl accepts, or "local"', () => {
    expect(checkTimezone('Asia/Tokyo')).toBe('Asia/Tokyo')
    expect(checkTimezone('local')).toBeTypeOf('string')
  })

  it('rejects a fixed-offset string with a hint', () => {
    try {
      checkTimezone('UTC+8')
      expect.fail('expected to throw')
    } catch (e) {
      expect((e as ChartError).code).toBe('INVALID_TIMEZONE')
      expect((e as ChartError).hint).toContain('Etc/GMT-8')
    }
  })
})

describe('SC-134: getSupportedTimespans', () => {
  it('lists the timespans the loader accepts, and is a fresh copy each call', () => {
    const a = getSupportedTimespans()
    const b = getSupportedTimespans()
    expect(a).toEqual(['second', 'minute', 'hour', 'day', 'week', 'month', 'year'])
    expect(a).not.toBe(b)
  })
})
