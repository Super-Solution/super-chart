import { describe, expect, it } from 'vitest'

import type { OverlayFigure, OverlayTemplate } from 'klinecharts'

import overlays from './index'
import { accentStyles, drawingAccent, withAccent } from './accent'
import { sameRgb } from '../drawing-editor/color'
import { ACCENT } from '../theme/tokens'

// SC-051 with a host accent: every tool on a chart draws in that chart's
// accent (its overlay line default), not in a colour fixed at registration.

const KLINECHARTS_BLUE = '#1677FF'
const HOST = '#FF00FF'

/** Every string in a styles object, with its path. */
function strings (value: unknown, path: string): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]]
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([k, v]) => strings(v, `${path}.${k}`))
}

const isBlue = (c: string): boolean => sameRgb(c, ACCENT) || sameRgb(c, KLINECHARTS_BLUE)

function draw (template: OverlayTemplate, overlayStyles: unknown = template.styles ?? {}, accent: string = HOST): OverlayFigure[] {
  // As many points as a finished drawing of the tool has.
  const total = template.totalStep ?? 2
  const count = total > 2 && total < 10 ? total - 1 : 6
  const coordinates = Array.from({ length: count }, (_, i) => ({ x: 100 + i * 40, y: 200 - (i % 2) * 60 }))
  const params = {
    overlay: { name: template.name, points: coordinates.map((_, i) => ({ value: 100 + i * 5, dataIndex: 10 + i * 5, timestamp: i })), styles: overlayStyles, extendData: undefined },
    coordinates,
    bounding: { width: 800, height: 400, left: 0, top: 0, right: 0, bottom: 0 },
    barSpace: { bar: 6, halfBar: 3, gapBar: 4, halfGapBar: 2 },
    precision: { price: 2, volume: 0 },
    thousandsSeparator: ',',
    decimalFoldThreshold: 3,
    dateTimeFormat: new Intl.DateTimeFormat('en-US'),
    defaultStyles: { line: { color: accent } },
    xAxis: null,
    yAxis: null
  }
  return ([] as OverlayFigure[]).concat(withAccent(template).createPointFigures?.(params as never) ?? [])
}

describe('drawing accent', () => {
  it('no template fixes an accent colour at registration (it could not follow the chart)', () => {
    const hits = overlays.flatMap(t => strings(t.styles, t.name).filter(([, v]) => isBlue(v)))
    expect(hits).toEqual([])
  })

  it('comes from the chart\'s overlay line default, else ACCENT', () => {
    expect(drawingAccent({ line: { color: '#1414B0' } })).toBe('#1414B0')
    expect(drawingAccent({ line: { color: 'not a colour' } })).toBe(ACCENT)
    expect(drawingAccent(undefined)).toBe(ACCENT)
  })

  it('no tool draws a fixed blue when the chart has another accent', () => {
    // Under node, klinecharts resolves to its UMD file without its functions,
    // so the few tools that call klinecharts' utils cannot draw here; the
    // browser suite (e2e style-stack.spec.ts) draws those on a real chart.
    const drawn: Array<readonly [string, OverlayFigure[]]> = []
    for (const t of overlays) {
      try {
        drawn.push([t.name, draw(t)])
      } catch (e) {
        expect(String(e)).toMatch(/Cannot read properties of undefined/)
      }
    }
    const withFigures = drawn.filter(([, figs]) => figs.length > 0).map(([name]) => name)
    expect(withFigures.length).toBeGreaterThan(30)
    expect(['circle', 'rect', 'triangle', 'parallelogram', 'gannBox', 'xabcd', 'ellipse', 'rotatedRect', 'gannSquare', 'disjointChannel', 'text', 'note', 'callout', 'priceLabel', 'signpost', 'brush', 'priceRange', 'dateRange'].filter(name => !withFigures.includes(name))).toEqual([])
    const hits = drawn.flatMap(([name, figs]) => figs.flatMap((f, i) => strings(f.styles, `${name}[${i}]`).filter(([, v]) => isBlue(v))))
    expect(hits).toEqual([])
  })

  it('fills and label boxes take the accent: fills keep their opacity, boxes are opaque with readable ink', () => {
    const byName = (name: string): OverlayTemplate => overlays.find(t => t.name === name) as OverlayTemplate
    const polygon = (name: string): unknown => draw(byName(name)).find(f => f.type === 'polygon')?.styles?.color
    expect(polygon('rect')).toBe('rgba(255, 0, 255, 0.15)')
    expect(polygon('gannSquare')).toBe('rgba(255, 0, 255, 0.1)')
    expect(draw(byName('circle')).find(f => f.type === 'circle')?.styles).toEqual({ color: 'rgba(255, 0, 255, 0.15)', style: 'stroke_fill' })
    const text = (name: string, accent: string): unknown => draw(byName(name), undefined, accent).find(f => f.type === 'text')?.styles
    expect(text('text', HOST)).toMatchObject({ color: HOST, backgroundColor: 'transparent' })
    expect(text('note', '#1414B0')).toMatchObject({ color: '#FFFFFF', backgroundColor: '#1414B0' })
    expect(text('callout', '#A0A8FF')).toMatchObject({ color: '#131722', backgroundColor: '#A0A8FF' })
    // The measure tools read the accent the same way.
    const dateRange = draw(byName('dateRange'), undefined, '#A0A8FF')
    expect(dateRange.find(f => f.type === 'polygon')?.styles?.color).toBe('rgba(160, 168, 255, 0.14)')
    expect(dateRange.find(f => f.type === 'text')?.styles).toMatchObject({ color: '#131722', backgroundColor: '#A0A8FF' })
  })

  it('the overlay\'s own styles (an editor colour, a host\'s createOverlay styles) win over the accent', () => {
    const rect = overlays.find(t => t.name === 'rect') as OverlayTemplate
    const [fig] = draw(rect, { polygon: { color: 'rgba(1, 2, 3, 0.5)' } })
    expect(fig.styles).toEqual({ color: 'rgba(1, 2, 3, 0.5)', style: 'stroke_fill' })
  })

  it('every name in the accent table is a registered tool; tools without accent styles are left as they are', () => {
    const names = overlays.map(t => t.name)
    for (const name of ['circle', 'rect', 'triangle', 'parallelogram', 'gannBox', 'xabcd', 'ellipse', 'rotatedRect', 'gannSquare', 'disjointChannel', 'text', 'note', 'callout', 'priceLabel', 'signpost']) {
      expect(names).toContain(name)
      expect(Object.keys(accentStyles(name, HOST)).length).toBeGreaterThan(0)
    }
    const arrow = overlays.find(t => t.name === 'arrow') as OverlayTemplate
    expect(withAccent(arrow)).toBe(arrow)
    expect(accentStyles('segment', HOST)).toEqual({})
  })
})
