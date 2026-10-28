import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PRESET_COLORS, buildPalette } from '../drawing-editor/color'
import { canvasTheme } from '../chart-theme'
import { ACCENT } from './tokens'

// SC-051: drawings used two blues (klinecharts' #1677FF and a hard-coded
// #2962ff) and a hard-coded 'JetBrains Mono' most hosts never load. The accent
// and the canvas fonts now live in src/theme/tokens.ts only. This is a narrow
// gate: meaning-bearing colours (up/down green and red, fibonacci levels, the
// highlighter yellow) are allowed anywhere.

const SRC = fileURLToPath(new URL('..', import.meta.url))
const FORBIDDEN = [/#2962ff/i, /#1677ff/i, /rgba\(\s*41,\s*98,\s*255/i, /rgba\(\s*22,\s*119,\s*255/i, /JetBrains Mono/i]
// Where the literals belong: the token module, the stylesheet's copy of the
// defaults (tokens.test.ts keeps them equal) and the fake chart that models
// klinecharts' own built-in overlay defaults for the editor tests.
const ALLOWED = ['theme/tokens.ts', 'base.less', 'drawing-editor/fakeChart.ts']

function files (dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__snapshots__' ? [] : files(path)
    return /\.(tsx?|less|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('accent and font literals', () => {
  it('appear only in the token module', () => {
    const hits = files(SRC)
      .filter(f => !ALLOWED.includes(relative(SRC, f).split('\\').join('/')))
      .flatMap(f => readFileSync(f, 'utf8').split('\n').flatMap((line, i) =>
        FORBIDDEN.some(re => re.test(line)) ? [`${relative(SRC, f)}:${i + 1}: ${line.trim().slice(0, 100)}`] : []))
    expect(hits).toEqual([])
  })

  it('the drawing default and the first preset swatch are the accent, and the palette has one blue', () => {
    const overlay = (canvasTheme('dark') as any).overlay
    expect(overlay.line.color).toBe(ACCENT)
    expect(PRESET_COLORS[0]).toBe(ACCENT)
    const palette = buildPalette(overlay.line.color)
    const rgb = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
    const nearAccent = palette.filter(c => Math.max(...rgb(c).map((v, i) => Math.abs(v - rgb(ACCENT)[i]))) < 48)
    expect(nearAccent).toEqual([ACCENT])
  })

  it('with a host accent, the palette starts with it and has no second blue', () => {
    const overlay = (canvasTheme('light', { accent: '#1414B0' }) as any).overlay
    const palette = buildPalette(overlay.line.color)
    expect(palette[0]).toBe('#1414B0')
    expect(palette).not.toContain(ACCENT)
  })
})
