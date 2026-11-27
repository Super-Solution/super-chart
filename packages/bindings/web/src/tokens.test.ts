import { describe, expect, it } from 'vitest'
import { SUPER_CHART_COLORS } from './tokens'

const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16)
  const channel = (value: number): number => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
const contrast = (a: string, b: string): number => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

describe('the drawing colour', () => {
  it('holds 3:1 on the chart surface in every theme', () => {
    for (const [name, set] of Object.entries(SUPER_CHART_COLORS)) expect(contrast(set.drawing, set.surface), name).toBeGreaterThanOrEqual(3)
  })
  it('is blue in the plain themes and the ink colour where blue already means up', () => {
    expect(SUPER_CHART_COLORS.dark.drawing).not.toBe(SUPER_CHART_COLORS.dark.ink)
    expect(SUPER_CHART_COLORS['dark-colorblind'].drawing).toBe(SUPER_CHART_COLORS['dark-colorblind'].ink)
  })
})
