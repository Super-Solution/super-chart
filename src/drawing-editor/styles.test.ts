import { describe, it, expect } from 'vitest'

import {
  profileFor, controlsFor, editorControlsFor, applyStyleChange, buildStylePatch, readStrokeState, readTextColor,
  classifyLineStyle, deepMerge, deepClone, DASH_PATTERNS, LINE_STYLES, StyleRecord
} from './styles'

// klinecharts 9.1.1 getDefaultOverlayStyle(), trimmed to what the editor reads.
const DEFAULTS: StyleRecord = {
  line: { style: 'solid', smooth: false, color: '#1677FF', size: 1, dashedValue: [2, 2] },
  polygon: { style: 'fill', color: '#1677FF', borderColor: '#1677FF', borderSize: 1, borderStyle: 'solid', borderDashedValue: [2, 2] },
  circle: { style: 'fill', color: 'rgba(22, 119, 255, 0.25)', borderColor: '#1677FF', borderSize: 1, borderStyle: 'solid', borderDashedValue: [2, 2] },
  arc: { style: 'solid', color: '#1677FF', size: 1, dashedValue: [2, 2] },
  text: { color: '#1677FF', size: 12, family: 'Helvetica Neue', weight: 'normal' },
  rectText: { color: '#FFFFFF', backgroundColor: '#1677FF' }
}

describe('which controls apply', () => {
  it('offers line colour, width and style on plain lines, and no text colour', () => {
    expect(editorControlsFor('segment')).toEqual({ lineColor: true, textColor: false, lineWidth: true, lineStyle: true })
    // unknown names (klinecharts built-in lines) default to a line
    expect(editorControlsFor('horizontalStraightLine')).toEqual(editorControlsFor('segment'))
  })

  it('offers text colour only where the overlay renders text', () => {
    expect(editorControlsFor('fibonacciLine').textColor).toBe(true)
    expect(editorControlsFor('priceLine').textColor).toBe(true)
    expect(editorControlsFor('rect').textColor).toBe(false)
    expect(editorControlsFor('text')).toEqual({ lineColor: false, textColor: true, lineWidth: false, lineStyle: false })
  })

  it('offers only a colour for filled markers', () => {
    expect(editorControlsFor('arrowUp')).toEqual({ lineColor: true, textColor: false, lineWidth: false, lineStyle: false })
  })

  it('offers no style controls where colours carry meaning', () => {
    for (const name of ['positionLong', 'priceRange', 'forecast', 'fixedRangeVolumeProfile', 'image']) {
      expect(controlsFor(profileFor(name))).toEqual({ lineColor: false, textColor: false, lineWidth: false, lineStyle: false })
    }
  })

  it('does not treat Object.prototype keys as tool names', () => {
    expect(profileFor('toString')).toEqual(profileFor('segment'))
  })
})

describe('applyStyleChange', () => {
  it('sets line colour on a line and leaves other keys alone', () => {
    const next = applyStyleChange(null, DEFAULTS, profileFor('segment'), { kind: 'lineColor', color: '#F23645' })
    expect(next).toEqual({ line: { color: '#F23645' } })
  })

  it('never mutates the current (possibly shared template) styles object', () => {
    const template: StyleRecord = { polygon: { color: 'rgba(22, 119, 255, 0.15)' } }
    const snapshot = JSON.stringify(template)
    const next = applyStyleChange(template, DEFAULTS, profileFor('rect'), { kind: 'lineColor', color: '#F23645' })
    expect(JSON.stringify(template)).toBe(snapshot)
    expect(next).not.toBe(template)
    expect(next.polygon).not.toBe(template.polygon)
  })

  it('keeps template defaults and gives the fill the new colour at the fill\'s own opacity', () => {
    const template: StyleRecord = { polygon: { color: 'rgba(22, 119, 255, 0.15)' } }
    const next = applyStyleChange(template, DEFAULTS, profileFor('rect'), { kind: 'lineColor', color: '#F23645' })
    expect(next).toEqual({ polygon: { color: 'rgba(242, 54, 69, 0.15)', borderColor: '#F23645' } })
  })

  it('reads the fill opacity from the chart default when the overlay has none', () => {
    const next = applyStyleChange(null, DEFAULTS, profileFor('circle'), { kind: 'lineColor', color: '#089981' })
    expect(next).toEqual({ circle: { borderColor: '#089981', color: 'rgba(8, 153, 129, 0.25)' } })
  })

  it('paints a fill-only marker with the chosen colour as is', () => {
    const next = applyStyleChange({ polygon: { color: '#26a69a' } }, DEFAULTS, profileFor('arrowUp'), { kind: 'lineColor', color: 'rgba(242, 54, 69, 0.5)' })
    expect(next).toEqual({ polygon: { color: 'rgba(242, 54, 69, 0.5)' } })
  })

  it('maps width to size on lines and borderSize on shapes', () => {
    expect(applyStyleChange(null, DEFAULTS, profileFor('segment'), { kind: 'lineWidth', width: 3 })).toEqual({ line: { size: 3 } })
    expect(applyStyleChange(null, DEFAULTS, profileFor('rect'), { kind: 'lineWidth', width: 2 })).toEqual({ polygon: { borderSize: 2 } })
    expect(applyStyleChange(null, DEFAULTS, profileFor('fibonacciSpiral'), { kind: 'lineWidth', width: 4 })).toEqual({ arc: { size: 4 }, line: { size: 4 } })
  })

  it('maps line style to dash patterns, dotted being a short dash', () => {
    // literal patterns: the expectation must not be built from the constant under test
    expect(DASH_PATTERNS).toEqual({ dashed: [6, 4], dotted: [2, 2] })
    expect(applyStyleChange(null, DEFAULTS, profileFor('segment'), { kind: 'lineStyle', style: 'dashed' }))
      .toEqual({ line: { style: 'dashed', dashedValue: [6, 4] } })
    expect(applyStyleChange(null, DEFAULTS, profileFor('rect'), { kind: 'lineStyle', style: 'dotted' }))
      .toEqual({ polygon: { borderStyle: 'dashed', borderDashedValue: [2, 2] } })
    const back = applyStyleChange({ line: { style: 'dashed', dashedValue: [6, 4], color: '#000000' } }, DEFAULTS, profileFor('segment'), { kind: 'lineStyle', style: 'solid' })
    expect(back.line?.style).toBe('solid')
    expect(back.line?.color).toBe('#000000')
  })

  it('sets text colour only on text keys', () => {
    expect(applyStyleChange({ text: { color: '#ffffff', size: 12 } }, DEFAULTS, profileFor('note'), { kind: 'textColor', color: '#131722' }))
      .toEqual({ text: { color: '#131722', size: 12 } })
    expect(applyStyleChange(null, DEFAULTS, profileFor('segment'), { kind: 'textColor', color: '#131722' })).toEqual({})
  })

  it('ignores invalid input', () => {
    expect(buildStylePatch(profileFor('segment'), { kind: 'lineColor', color: 'red' }, null, DEFAULTS)).toEqual({})
    expect(buildStylePatch(profileFor('segment'), { kind: 'lineWidth', width: 0 }, null, DEFAULTS)).toEqual({})
    expect(buildStylePatch(profileFor('segment'), { kind: 'lineWidth', width: NaN }, null, DEFAULTS)).toEqual({})
  })

  it('applies nothing to overlays without style controls', () => {
    const current = { polygon: { color: 'rgba(38, 166, 154, 0.18)' } }
    expect(applyStyleChange(current, DEFAULTS, profileFor('positionLong'), { kind: 'lineColor', color: '#F23645' })).toEqual(current)
  })
})

describe('reading the current state', () => {
  it('reads colour, width and style from the first stroke key, falling back to chart defaults', () => {
    expect(readStrokeState(null, DEFAULTS, profileFor('segment'))).toEqual({ color: '#1677FF', width: 1, style: 'solid' })
    expect(readStrokeState({ line: { color: '#F23645', size: 3, style: 'dashed', dashedValue: [6, 4] } }, DEFAULTS, profileFor('segment')))
      .toEqual({ color: '#F23645', width: 3, style: 'dashed' })
    expect(readStrokeState({ polygon: { borderSize: 2, borderStyle: 'dashed', borderDashedValue: [2, 2] } }, DEFAULTS, profileFor('rect')))
      .toEqual({ color: '#1677FF', width: 2, style: 'dotted' })
  })

  it('reads a fill-only marker\'s colour from its fill', () => {
    expect(readStrokeState({ polygon: { color: '#26a69a' } }, DEFAULTS, profileFor('arrowUp')).color).toBe('#26a69a')
  })

  it('reads text colour', () => {
    expect(readTextColor({ text: { color: '#ffffff' } }, DEFAULTS, profileFor('note'))).toBe('#ffffff')
    expect(readTextColor(null, DEFAULTS, profileFor('fibonacciLine'))).toBe('#1677FF')
  })

  it('classifies dash patterns', () => {
    expect(classifyLineStyle('solid', [6, 4])).toBe('solid')
    expect(classifyLineStyle('dashed', [6, 4])).toBe('dashed')
    expect(classifyLineStyle('dashed', [2, 2])).toBe('dotted')
    // klinecharts' default dashedValue is [2, 2]
    expect(classifyLineStyle('dashed', undefined)).toBe('dotted')
  })

  it('reads back every line style the toolbar writes, on lines and on shape borders', () => {
    for (const name of ['segment', 'rect', 'circle', 'fibonacciSpiral']) {
      const profile = profileFor(name)
      for (const style of LINE_STYLES) {
        const styles = applyStyleChange(null, DEFAULTS, profile, { kind: 'lineStyle', style })
        expect({ name, style: readStrokeState(styles, DEFAULTS, profile).style }).toEqual({ name, style })
      }
    }
  })
})

describe('highlighter', () => {
  it('offers only its colour: its 12 px band is not a 1-4 px line and has no dash', () => {
    expect(editorControlsFor('highlighter')).toEqual({ lineColor: true, textColor: false, lineWidth: false, lineStyle: false })
    expect(editorControlsFor('brush')).toEqual({ lineColor: true, textColor: false, lineWidth: true, lineStyle: true })
  })

  it('ignores width and style changes but takes a colour', () => {
    const band: StyleRecord = { line: { color: 'rgba(255, 202, 40, 0.35)', size: 12 } }
    const profile = profileFor('highlighter')
    expect(applyStyleChange(band, DEFAULTS, profile, { kind: 'lineWidth', width: 2 })).toEqual(band)
    expect(applyStyleChange(band, DEFAULTS, profile, { kind: 'lineStyle', style: 'dotted' })).toEqual(band)
    expect(applyStyleChange(band, DEFAULTS, profile, { kind: 'lineColor', color: 'rgba(8, 153, 129, 0.35)' }))
      .toEqual({ line: { color: 'rgba(8, 153, 129, 0.35)', size: 12 } })
  })
})

describe('deepMerge / deepClone', () => {
  it('merges nested objects, replaces arrays, skips undefined, and copies', () => {
    const target = { line: { color: 'a', dashedValue: [1, 1] }, keep: { x: 1 } }
    const merged = deepMerge(target, { line: { dashedValue: [6, 4], size: undefined } })
    expect(merged).toEqual({ line: { color: 'a', dashedValue: [6, 4] }, keep: { x: 1 } })
    expect(merged.keep).not.toBe(target.keep)
    expect(target.line.dashedValue).toEqual([1, 1])
  })

  it('keeps non-plain values by reference', () => {
    class Gradient {}
    const g = new Gradient()
    const copy = deepClone({ polygon: { color: g } })
    expect(copy.polygon.color).toBe(g)
  })
})
