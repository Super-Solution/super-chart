import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

import type { CandleStyle, KLineData } from 'klinecharts'

import { candleChange, createCandleLegend, formatLegendNumber } from './legend'
import type { LegendContext, LegendUtils } from './legend'

const STYLES = {
  bar: { upColor: '#0f0', downColor: '#f00', noChangeColor: '#888' },
  tooltip: { text: { color: '#999' } }
} as unknown as CandleStyle

function bar (partial: Partial<KLineData>): KLineData {
  return { timestamp: 0, open: 100, high: 110, low: 90, close: 100, volume: 1000, ...partial }
}

// Faithful ports of klinecharts' own `formatThousands`/`formatFoldDecimal`
// (verified byte-for-byte against `node_modules/klinecharts/dist/index.esm.js`
// for 9.8.12, and identical in 9.7.2's `formatThousands` — 9.7.2 has no
// `formatFoldDecimal` at all, see the real-import tests below). The previous
// mock here used ad hoc approximations (a naive thousands regex that did not
// split on '.', and a no-op `formatFoldDecimal` that ignored its `threshold`
// argument entirely) — which is exactly how the SC-legend-fmt bug shipped
// unnoticed: a mock that ignores the threshold can never fail regardless of
// what `formatLegendNumber` defaults it to. Ported for real so this suite
// actually exercises the behaviour it claims to.
const realFormatThousands: LegendUtils['formatThousands'] = (value, sign) => {
  const vl = `${value}`
  if (sign.length === 0) return vl
  if (vl.includes('.')) {
    const [int, frac] = vl.split('.')
    return `${(int ?? '').replace(/(\d)(?=(\d{3})+$)/g, `$1${sign}`)}.${frac}`
  }
  return vl.replace(/(\d)(?=(\d{3})+$)/g, `$1${sign}`)
}
const realFormatFoldDecimal: NonNullable<LegendUtils['formatFoldDecimal']> = (value, threshold) => {
  const vl = `${value}`
  const reg = new RegExp(`\\.0{${threshold},}[1-9][0-9]*$`)
  if (reg.test(vl)) {
    const result = vl.split('.')
    const last = result[result.length - 1] ?? ''
    const match = last.match(/0*/)
    if (match !== null) {
      const count = match[0].length
      result[result.length - 1] = last.replace(/0*/, `0{${count}}`)
      return result.join('.')
    }
  }
  return vl
}

function ctx (overrides: Partial<LegendContext> = {}): LegendContext {
  return {
    utils: {
      formatPrecision: (v, p = 2) => Number(v).toFixed(p),
      formatThousands: realFormatThousands,
      formatFoldDecimal: realFormatFoldDecimal
    },
    labels: { open: 'O', high: 'H', low: 'L', close: 'C', volume: 'Vol' },
    getPrecision: () => ({ price: 2, volume: 0 }),
    showVolume: () => true,
    ...overrides
  }
}

/**
 * Loads the REAL klinecharts `utils` for a pinned version by importing its
 * ESM dist file directly by path, bypassing the package's own `main`/`module`
 * resolution. Required under vitest's node environment: a bare
 * `import 'klinecharts'` resolves through the UMD/CJS interop shim, which
 * yields a namespace where `utils` is an enumerable key but reads back as
 * `undefined` (see fibonacciLine.test.ts and accent.test.ts for the same
 * wall) — confirmed live: `Object.keys(await import('klinecharts'))`
 * includes `'utils'`, but `(await import('klinecharts')).utils` is
 * `undefined`. Importing `dist/index.esm.js` by an absolute `file://` URL
 * sidesteps that resolution entirely and gets the real module.
 */
async function realKlinechartsUtils (distEsmPath: string): Promise<LegendUtils> {
  const mod: { utils: LegendUtils } = await import(/* @vite-ignore */ pathToFileURL(path.resolve(__dirname, distEsmPath)).href)
  return mod.utils
}
const KC_9_8_12_ESM = '../../node_modules/klinecharts/dist/index.esm.js' // direct dependency, package.json "klinecharts": "9.8.12"
const KC_9_7_2_ESM = '../../e2e/node_modules/kc-9-7-2/dist/index.esm.js' // e2e devDependency "kc-9-7-2": "npm:klinecharts@9.7.2"

describe('candleChange', () => {
  it('close vs the previous close, signed, with a percent', () => {
    expect(candleChange(110, 100, 100)).toEqual({ text: '+10.00 (+10.00%)', direction: 'up' })
    expect(candleChange(90, 100, 100)).toEqual({ text: '-10.00 (-10.00%)', direction: 'down' })
    expect(candleChange(100, 100, 100)).toEqual({ text: '0.00 (0.00%)', direction: 'flat' })
  })

  it('falls back to open when there is no previous candle (the first bar)', () => {
    expect(candleChange(105, 100, null)).toEqual({ text: '+5.00 (+5.00%)', direction: 'up' })
  })

  it('gives no text when the base is zero (never Infinity/NaN)', () => {
    expect(candleChange(5, 0, null)).toEqual({ text: '', direction: 'flat' })
    expect(candleChange(5, 100, 0)).toEqual({ text: '', direction: 'flat' })
  })
})

describe('formatLegendNumber', () => {
  it('applies precision, then thousands, then fold-decimal, in that order', () => {
    expect(formatLegendNumber(64438.271, 2, ctx({ getThousandsSeparator: () => ',' }))).toBe('64,438.27')
  })

  it('skips thousands/fold-decimal when the utils do not have them (klinecharts 9.1.1)', () => {
    expect(formatLegendNumber(64438.271, 2, ctx({ utils: { formatPrecision: (v, p = 2) => Number(v).toFixed(p) } }))).toBe('64438.27')
  })

  // SC-legend-fmt regression. Reported: a price of 90,620.30 rendered in the
  // ProjectX side-panel legend as "O90620.0n/a30" on both Super Chart 0.0.33
  // and 0.0.34. Root cause: `ChartProComponent.tsx` tried to read
  // `widget.getThousandsSeparator()`/`widget.getDecimalFoldThreshold()`, but
  // the public klinecharts `Chart` type never has either method (only the
  // internal, non-exported `ChartStore` does, on every version checked —
  // confirmed against `klinecharts/dist/index.d.ts` for 9.7.2 and 9.8.12), so
  // both always evaluated to `undefined`. `formatLegendNumber` then fell back
  // to `''`/`0` for the separator/threshold — and `0` is actively dangerous:
  // `formatFoldDecimal`'s regex `\.0{threshold,}[1-9][0-9]*$` matches almost
  // any decimal when threshold is 0 (zero required leading zeros), so it
  // "folds" an ordinary price and splices in a literal `0{n}` marker.
  // klinecharts itself refuses to ever run with threshold 0 (an init
  // `decimalFoldThreshold` is only honoured `if (isNumber(v) && v > 0)`), so
  // there was never a real code path elsewhere in klinecharts that this
  // default could have matched.
  describe('the ctx.getThousandsSeparator/getDecimalFoldThreshold-unavailable case (SC-legend-fmt)', () => {
    it('does NOT corrupt an ordinary price when neither getter is supplied (the fix)', () => {
      // No getThousandsSeparator/getDecimalFoldThreshold on this ctx at all —
      // exactly what ChartProComponent.tsx always produced in practice.
      expect(formatLegendNumber(90620.30, 2, ctx())).toBe('90,620.30')
    })

    it('characterises the bug mechanism directly: threshold 0 corrupts a plain price via the real formatFoldDecimal', () => {
      // Not what formatLegendNumber does any more (the fix changed the
      // default) — this pins the mechanism so a future refactor cannot
      // silently reintroduce `?? 0`/`?? ''` without a test noticing why that
      // is unsafe, independent of formatLegendNumber's own wiring.
      const text = realFormatThousands('90620.30', '') // getThousandsSeparator absent -> '' (old default)
      expect(realFormatFoldDecimal(text, 0)).toBe('90620.0{0}30') // getDecimalFoldThreshold absent -> 0 (old default)
    })

    it('folds a genuinely tiny price correctly with the real default threshold (3), so the fix does not just disable folding', () => {
      // 0.0000001234 has 6 leading zeros after the point, at/above the
      // default threshold of 3 - klinecharts' own fold notation is meant to
      // trigger here (a real use case: sub-cent token prices).
      expect(formatLegendNumber(0.0000001234, 10, ctx())).toBe('0.0{6}1234')
    })
  })

  describe('against the real, installed klinecharts utils (not a mock) — 9.7.2 and 9.8.12', () => {
    it('9.8.12: formats 90620.30 as 90,620.30 when the host cannot supply a separator/threshold', async () => {
      const utils = await realKlinechartsUtils(KC_9_8_12_ESM)
      expect(utils.formatFoldDecimal).toBeDefined() // 9.8+ has it; this is the version that can corrupt the string
      expect(formatLegendNumber(90620.30, 2, ctx({ utils }))).toBe('90,620.30')
    })

    it('9.7.2: formats 90620.30 as 90,620.30 (no formatFoldDecimal on this version, so only the separator default matters)', async () => {
      const utils = await realKlinechartsUtils(KC_9_7_2_ESM)
      expect(utils.formatFoldDecimal).toBeUndefined() // confirms the feature-detection in formatLegendNumber is still needed
      expect(formatLegendNumber(90620.30, 2, ctx({ utils }))).toBe('90,620.30')
    })

    it('9.8.12: the pre-fix defaults (\'\', 0) reproduce the exact reported corruption', async () => {
      const utils = await realKlinechartsUtils(KC_9_8_12_ESM)
      const { formatThousands, formatFoldDecimal } = utils
      if (formatThousands === undefined || formatFoldDecimal === undefined) {
        throw new Error('klinecharts 9.8.12 is expected to have both formatThousands and formatFoldDecimal')
      }
      const preFixText = formatThousands(utils.formatPrecision(90620.30, 2), '')
      expect(formatFoldDecimal(preFixText, 0)).toBe('90620.0{0}30')
    })
  })
})

describe('createCandleLegend', () => {
  it('colours O/H/L/C by close vs open, drops Time, and includes a change row', () => {
    const legend = createCandleLegend(ctx({ showVolume: () => false }))
    const rows = legend({ prev: bar({ close: 90 }), current: bar({ open: 95, close: 110 }), next: null }, STYLES)
    expect(rows.map(r => (r.title as { text: string }).text)).toEqual(['O', 'H', 'L', 'C', ''])
    expect(rows.some(r => (r.title as { text: string }).text.toLowerCase().includes('time'))).toBe(false)
    const openRow = rows[0]
    expect((openRow.value as { color: string }).color).toBe('#0f0') // close(110) > open(95): up
    const changeRow = rows[4]
    expect((changeRow.value as { text: string }).text).toBe('+20.00 (+22.22%)')
    expect((changeRow.value as { color: string }).color).toBe('#0f0')
  })

  it('shows volume only when showVolume() is true (no separate VOL pane)', () => {
    const withVol = createCandleLegend(ctx({ showVolume: () => true }))([{ prev: null, current: bar({ volume: 4242 }), next: null }][0], STYLES)
    expect(withVol.some(r => (r.title as { text: string }).text === 'Vol')).toBe(true)

    const withoutVol = createCandleLegend(ctx({ showVolume: () => false }))({ prev: null, current: bar({ volume: 4242 }), next: null }, STYLES)
    expect(withoutVol.some(r => (r.title as { text: string }).text === 'Vol')).toBe(false)
  })

  it('reads precision at call time, so a symbol switch changes the formatting', () => {
    let precision = { price: 2, volume: 0 }
    const legend = createCandleLegend(ctx({ getPrecision: () => precision }))
    const first = legend({ prev: null, current: bar({ open: 1.23456 }), next: null }, STYLES)
    expect((first[0].value as { text: string }).text).toBe('1.23')
    precision = { price: 5, volume: 0 }
    const second = legend({ prev: null, current: bar({ open: 1.23456 }), next: null }, STYLES)
    expect((second[0].value as { text: string }).text).toBe('1.23456')
  })

  it('a flat candle (close === open) uses the no-change colour', () => {
    const legend = createCandleLegend(ctx())
    const rows = legend({ prev: null, current: bar({ open: 100, close: 100 }), next: null }, STYLES)
    expect((rows[0].value as { color: string }).color).toBe('#888')
  })
})
