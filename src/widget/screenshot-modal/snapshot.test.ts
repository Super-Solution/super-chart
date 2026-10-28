import { describe, expect, it, vi } from 'vitest'

import { buildSnapshotResult, resolveScreenshotBackground, resolveSnapshotOptions, screenshotFilename } from './snapshot'
import type { BackgroundNode } from './snapshot'

describe('resolveScreenshotBackground', () => {
  interface ColorNode extends BackgroundNode { color: string }
  const colorOf = (n: BackgroundNode): string => (n as ColorNode).color

  /** `colors` is always non-empty at every call site below; the last colour is the returned (start) node, and each earlier one is its next ancestor. */
  function chain (colors: string[]): BackgroundNode {
    const [outermost, ...ancestors] = [...colors].reverse()
    let node: ColorNode = { parentElement: null, color: outermost }
    for (const c of ancestors) {
      node = { parentElement: node, color: c }
    }
    return node
  }

  it('the nearest opaque ancestor (a host CSS override)', () => {
    const start = chain(['transparent', 'rgba(0, 0, 0, 0)', '#0b0e14', '#ffffff'])
    expect(resolveScreenshotBackground(start, colorOf, 'dark')).toBe('#0b0e14')
  })

  it('falls back to the live theme default when every ancestor is transparent', () => {
    const start = chain(['transparent', ''])
    expect(resolveScreenshotBackground(start, colorOf, 'dark')).toBe('#151517')
    expect(resolveScreenshotBackground(start, colorOf, 'light')).toBe('#ffffff')
  })

  it('reads the theme signal live, not what the chart was constructed with', () => {
    const start = chain(['transparent'])
    // Same node chain, different live theme: the caller passes the current theme(), not props.theme.
    expect(resolveScreenshotBackground(start, colorOf, 'light')).toBe('#ffffff')
  })
})

describe('screenshotFilename', () => {
  it('matches the agreed pattern', () => {
    const name = screenshotFilename('BTC-USDT', '1H', new Date(2026, 8, 27, 14, 30), 'png')
    expect(name).toMatch(/^[A-Za-z0-9._-]+_[^_]+_\d{4}-\d{2}-\d{2}_\d{4}\.png$/)
    expect(name).toBe('BTC-USDT_1H_2026-09-27_1430.png')
  })

  it('sanitises characters illegal in a filename (a ticker like BTC/USDT)', () => {
    const name = screenshotFilename('BTC/USDT', '1H', new Date(2026, 0, 1, 0, 0), 'png')
    expect(name).not.toContain('/')
    expect(name).toMatch(/^[A-Za-z0-9._-]+_[^_]+_\d{4}-\d{2}-\d{2}_\d{4}\.png$/)
  })

  it('pads single-digit months/days/hours/minutes', () => {
    expect(screenshotFilename('BTC', 'D', new Date(2026, 0, 5, 3, 7), 'png')).toBe('BTC_D_2026-01-05_0307.png')
  })
})

describe('buildSnapshotResult', () => {
  it('assembles the result from the chart\'s own getConvertPictureUrl/getVisibleRange', () => {
    const chart = {
      getConvertPictureUrl: vi.fn(() => 'data:image/png;base64,xyz'),
      getVisibleRange: () => ({ from: 1, to: 2, realFrom: 1, realTo: 2 })
    }
    const result = buildSnapshotResult(chart, {
      format: 'png',
      background: '#151517',
      includeOverlay: false,
      width: 800,
      height: 600,
      pixelRatio: 2,
      symbol: { ticker: 'BTC' },
      period: { multiplier: 1, timespan: 'hour', text: '1H' },
      timezone: 'Etc/UTC',
      theme: 'dark'
    })
    expect(chart.getConvertPictureUrl).toHaveBeenCalledWith(false, 'png', '#151517')
    expect(result.dataUrl).toBe('data:image/png;base64,xyz')
    expect(result.mime).toBe('image/png')
    expect(result.symbol.ticker).toBe('BTC')
    expect(result.visibleRange).toEqual({ from: 1, to: 2, realFrom: 1, realTo: 2 })
  })
})

describe('resolveSnapshotOptions', () => {
  it('defaults to png with the crosshair hidden', () => {
    expect(resolveSnapshotOptions(undefined)).toMatchObject({ format: 'png', hideCrosshair: true })
  })
  it('keeps a caller\'s explicit choices', () => {
    expect(resolveSnapshotOptions({ format: 'jpeg', hideCrosshair: false, quality: 0.8 })).toMatchObject({ format: 'jpeg', hideCrosshair: false, quality: 0.8 })
  })
})
