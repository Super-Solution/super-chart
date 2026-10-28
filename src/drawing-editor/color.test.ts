import { describe, it, expect } from 'vitest'

import { parseColor, parseHexInput, formatColor, toHex, withAlpha, alphaOf, sameRgb, buildPalette, PRESET_COLORS } from './color'

describe('parseColor', () => {
  it('parses hex in 3, 4, 6 and 8 digits', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#1677FF')).toEqual({ r: 22, g: 119, b: 255, a: 1 })
    expect(parseColor('#1677ff80')).toEqual({ r: 22, g: 119, b: 255, a: 0.502 })
    expect(parseColor('#0008')?.a).toBeCloseTo(0.533, 3)
  })

  it('parses rgb() and rgba(), with commas or spaces', () => {
    expect(parseColor('rgba(22, 119, 255, 0.15)')).toEqual({ r: 22, g: 119, b: 255, a: 0.15 })
    expect(parseColor('rgb(1 2 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 })
    expect(parseColor('rgba(1, 2, 3, 50%)')?.a).toBe(0.5)
  })

  it('rejects what it cannot read', () => {
    expect(parseColor('red')).toBeNull()
    expect(parseColor('1677FF')).toBeNull() // CSS hex needs '#'
    expect(parseColor('#12')).toBeNull()
    expect(parseColor('rgb(1, 2)')).toBeNull()
    expect(parseColor(undefined)).toBeNull()
    expect(parseColor({})).toBeNull()
  })
})

describe('parseHexInput', () => {
  it('accepts typed hex with or without #', () => {
    expect(parseHexInput(' 1677ff ')).toEqual({ r: 22, g: 119, b: 255, a: 1 })
    expect(parseHexInput('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 })
    expect(parseHexInput('rgb(1,2,3)')).toBeNull()
    expect(parseHexInput('#zzzzzz')).toBeNull()
  })
})

describe('formatColor / withAlpha / alphaOf', () => {
  it('formats opaque as upper-case hex and translucent as rgba', () => {
    expect(formatColor({ r: 22, g: 119, b: 255, a: 1 })).toBe('#1677FF')
    expect(formatColor({ r: 22, g: 119, b: 255, a: 0.456 })).toBe('rgba(22, 119, 255, 0.46)')
    expect(toHex({ r: 0, g: 0, b: 0, a: 0.2 })).toBe('#000000')
  })

  it('replaces only the alpha', () => {
    expect(withAlpha('#F23645', 0.15)).toBe('rgba(242, 54, 69, 0.15)')
    expect(withAlpha('rgba(242, 54, 69, 0.15)', 1)).toBe('#F23645')
    expect(withAlpha('not-a-colour', 0.5)).toBe('not-a-colour')
    expect(alphaOf('rgba(0, 0, 0, 0.25)')).toBe(0.25)
    expect(alphaOf('#000')).toBe(1)
    expect(alphaOf('nope')).toBeNull()
  })

  it('compares rgb ignoring alpha and notation', () => {
    expect(sameRgb('#1677ff', 'rgba(22, 119, 255, 0.3)')).toBe(true)
    expect(sameRgb('#1677ff', '#1677fe')).toBe(false)
    expect(sameRgb('#1677ff', 'blue')).toBe(false)
  })
})

describe('buildPalette', () => {
  it('puts the theme default in the accent slot and removes duplicates', () => {
    // A host accent replaces the preset accent instead of sitting next to it.
    const palette = buildPalette('#1677FF')
    expect(palette[0]).toBe('#1677FF')
    expect(palette).not.toContain(PRESET_COLORS[0].toUpperCase())
    expect(palette.length).toBe(PRESET_COLORS.length)
    expect(new Set(palette).size).toBe(palette.length)
    expect(buildPalette('#1414B0')).toEqual(['#1414B0', ...PRESET_COLORS.slice(1).map(c => c.toUpperCase())])
  })

  it('does not repeat a default that is already a preset', () => {
    const palette = buildPalette('rgba(41, 98, 255, 0.5)')
    expect(palette[0]).toBe('#2962FF')
    expect(palette.length).toBe(PRESET_COLORS.length)
  })

  it('works without a default (or an unreadable one)', () => {
    expect(buildPalette(null)).toEqual(PRESET_COLORS.map(c => c.toUpperCase()))
    expect(buildPalette('not a colour')).toEqual(PRESET_COLORS.map(c => c.toUpperCase()))
  })
})
