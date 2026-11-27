import { describe, expect, it } from 'vitest'
import type { EngineFrame } from '@supersolutions/super-chart-core'
import { EngineAnnotations, type AnnotationTemplate, type EngineAnnotationSpec } from './annotations'

// A flat, linear projection: x is the time, y falls as price rises. Enough to check geometry without a canvas.
function frameOf (): EngineFrame {
  const bars = Array.from({ length: 10 }, (_, i) => ({ timestamp: i * 100, open: 100, high: 110, low: 90, close: 100, volume: 1 }))
  return {
    snapshot: { bars, length: bars.length },
    model: { geometry: { left: 40, right: 640, top: 10, bottom: 390 } },
    project: (time: number, price: number) => ({ x: 40 + time / 2, y: 400 - price * 2 }),
    unproject: (x: number, y: number) => ({ timestamp: (x - 40) * 2, price: (400 - y) / 2 })
  } as unknown as EngineFrame
}
function layer (): EngineAnnotations {
  const annotations = new EngineAnnotations({ symbol: 'TEST' })
  annotations.update(frameOf())
  return annotations
}
const spec = (over: Partial<EngineAnnotationSpec> & Pick<EngineAnnotationSpec, 'key' | 'kind' | 'anchors'>): EngineAnnotationSpec => over
const find = (annotations: EngineAnnotations, key: string): ReturnType<EngineAnnotations['getSnapshot']>['annotations'][number] => {
  const item = annotations.getSnapshot().annotations.find(entry => entry.spec.key === key)
  if (item === undefined) throw new Error(`no annotation ${key}`)
  return item
}

describe('built-in annotation templates', () => {
  it('lists the built-in kinds next to the layer\'s own', () => {
    expect(layer().listKinds()).toEqual(['level', 'zone', 'marker', 'trend', 'ray', 'fibonacci', 'plan'])
  })

  it('draws a trend line and honours extend', () => {
    const annotations = layer()
    const result = annotations.setAnnotations('mine', [
      spec({ key: 'a', kind: 'trend', anchors: [{ time: 100, price: 90 }, { time: 400, price: 120 }] }),
      spec({ key: 'b', kind: 'ray', anchors: [{ time: 100, price: 90 }, { time: 400, price: 120 }] }),
      spec({ key: 'c', kind: 'trend', anchors: [{ time: 100, price: 90 }, { time: 400, price: 120 }], params: { extend: 'both' } })
    ])
    expect(result.rejected).toEqual([])
    const lines = (key: string): unknown => find(annotations, key).figures?.find(figure => figure.type === 'line')
    expect(lines('a')).toMatchObject({ type: 'line', from: { x: 90, y: 220 }, to: { x: 240, y: 160 } })
    expect((lines('a') as { extend?: string }).extend).toBeUndefined()
    expect(lines('b')).toMatchObject({ extend: 'right' })
    expect(lines('c')).toMatchObject({ extend: 'both' })
  })

  it('places each Fibonacci level at its own price, and takes custom levels', () => {
    const annotations = layer()
    annotations.setAnnotations('mine', [
      spec({ key: 'f', kind: 'fibonacci', anchors: [{ time: 0, price: 100 }, { time: 400, price: 200 }] }),
      spec({ key: 'g', kind: 'fibonacci', anchors: [{ time: 0, price: 100 }, { time: 400, price: 200 }], params: { levels: '0, 0.5, 2' } })
    ])
    const horizontal = (key: string): number[] => (find(annotations, key).figures ?? []).flatMap(figure => figure.type === 'line' && figure.from.y === figure.to.y ? [figure.from.y] : [])
    // y = 400 - 2 * price; level 0.5 of 100..200 is 150, so y = 100.
    expect(horizontal('f')).toHaveLength(7)
    expect(horizontal('f')).toContain(100)
    // Level 0 is the second anchor (200), level 1 the first (100): levels 0, 0.5 and 2 are the prices 200, 150 and 0.
    expect(horizontal('g')).toEqual([0, 100, 400])
  })

  it('draws a long plan with reward and risk, and refuses a stop on the wrong side', () => {
    const annotations = layer()
    annotations.setAnnotations('mine', [
      spec({ key: 'ok', kind: 'plan', anchors: [{ time: 100, price: 100 }, { time: 500, price: 120 }, { time: 500, price: 90 }] }),
      spec({ key: 'bad', kind: 'plan', anchors: [{ time: 100, price: 100 }, { time: 500, price: 120 }, { time: 500, price: 110 }] })
    ])
    const texts = (key: string): string[] => (find(annotations, key).figures ?? []).flatMap(figure => figure.type === 'text' ? [figure.text] : [])
    expect(texts('ok').some(text => text.includes('R:R 2.00'))).toBe(true)
    expect(texts('ok').some(text => text.includes('Target 120') && text.includes('+20.00%'))).toBe(true)
    expect(texts('ok').some(text => text.includes('Stop 90') && text.includes('-10.00%'))).toBe(true)
    expect(texts('bad')).toEqual(['Invalid plan: the stop must sit opposite the target'])
  })
})

describe('annotation validation', () => {
  it('rejects unknown kinds and malformed params, keeping the rest', () => {
    const annotations = layer()
    const anchors = [{ time: 100, price: 90 }, { time: 400, price: 120 }]
    const result = annotations.setAnnotations('mine', [
      spec({ key: 'nope', kind: 'nope', anchors }),
      spec({ key: 'deep', kind: 'trend', anchors, params: { extend: { nested: true } } as never }),
      spec({ key: 'short', kind: 'trend', anchors: [anchors[0]] }),
      spec({ key: 'ok', kind: 'trend', anchors })
    ])
    expect(result.rejected).toEqual([{ key: 'nope', code: 'unknown_kind' }, { key: 'deep', code: 'bad_style' }, { key: 'short', code: 'bad_anchor' }])
    expect(result.applied).toHaveLength(1)
  })

  it('treats a spec with unchanged params as unchanged', () => {
    const annotations = layer()
    const make = (): EngineAnnotationSpec => spec({ key: 't', kind: 'trend', anchors: [{ time: 100, price: 90 }, { time: 400, price: 120 }], params: { extend: 'right' } })
    annotations.setAnnotations('mine', [make()])
    const version = annotations.getSnapshot().version
    annotations.setAnnotations('mine', [make()])
    expect(annotations.getSnapshot().version).toBe(version)
  })
})

describe('registering a template', () => {
  const cross: AnnotationTemplate = {
    name: 'cross', anchors: 1, axisTags: [0],
    create: ({ anchors: [a], params }) => [
      { type: 'line', from: { x: a.x - 5, y: a.y }, to: { x: a.x + 5, y: a.y } },
      { type: 'line', from: { x: a.x, y: a.y - 5 }, to: { x: a.x, y: a.y + 5 } },
      { type: 'text', x: a.x, y: a.y, text: String(params.label ?? '') || 'x' }
    ]
  }

  it('accepts a host kind, projects it, and lets it be removed and restored', () => {
    const annotations = layer()
    const remove = annotations.registerTemplate(cross)
    expect(annotations.listKinds()).toContain('cross')
    expect(annotations.setAnnotations('mine', [spec({ key: 'c', kind: 'cross', anchors: [{ time: 200, price: 100 }], params: { label: 'hi' } })]).rejected).toEqual([])
    expect(find(annotations, 'c')).toMatchObject({ status: 'visible' })
    expect(find(annotations, 'c').figures).toHaveLength(3)
    remove()
    expect(find(annotations, 'c').status).toBe('unprojectable')
    expect(annotations.getAnnotations('mine')).toHaveLength(1)
    annotations.registerTemplate(cross)
    expect(find(annotations, 'c').status).toBe('visible')
  })

  it('refuses names that are taken, built in or malformed, and bad shapes', () => {
    const annotations = layer()
    annotations.registerTemplate(cross)
    expect(() => annotations.registerTemplate(cross)).toThrow(/already registered/)
    expect(() => annotations.registerTemplate({ ...cross, name: 'level' })).toThrow(/built in/)
    expect(() => annotations.registerTemplate({ ...cross, name: 'trend' })).toThrow(/already registered/)
    expect(() => annotations.registerTemplate({ ...cross, name: 'Bad Name' })).toThrow(TypeError)
    expect(() => annotations.registerTemplate({ ...cross, name: 'zero', anchors: 0 })).toThrow(RangeError)
    expect(() => annotations.registerTemplate({ ...cross, name: 'nine', anchors: 9 })).toThrow(RangeError)
    expect(() => annotations.registerTemplate({ ...cross, name: 'tags', axisTags: [3] })).toThrow(RangeError)
    expect(() => annotations.registerTemplate({ name: 'nofn', anchors: 1 } as never)).toThrow(TypeError)
  })

  it('keeps templates per layer', () => {
    const one = layer(), two = layer()
    one.registerTemplate(cross)
    expect(two.listKinds()).not.toContain('cross')
    expect(two.setAnnotations('mine', [spec({ key: 'c', kind: 'cross', anchors: [{ time: 200, price: 100 }] })]).rejected).toEqual([{ key: 'c', code: 'unknown_kind' }])
  })

  it('contains a template that throws or returns garbage to its own annotation', () => {
    const annotations = layer()
    annotations.registerTemplate({ name: 'boom', anchors: 1, create: () => { throw new Error('boom') } })
    annotations.registerTemplate({ name: 'junk', anchors: 1, create: () => [null, 3, { type: 'line', from: { x: NaN, y: 0 }, to: { x: 1, y: 1 } }, { type: 'rect', x: 50, y: 50, width: -4, height: 3 }, { type: 'text', x: 60, y: 60, text: 'kept' }] as never })
    annotations.registerTemplate({ name: 'flood', anchors: 1, create: () => Array.from({ length: 500 }, () => ({ type: 'marker' as const, x: 60, y: 60 })) })
    annotations.setAnnotations('mine', ['boom', 'junk', 'flood', 'trend'].map(kind => spec({ key: kind, kind, anchors: kind === 'trend' ? [{ time: 100, price: 90 }, { time: 400, price: 120 }] : [{ time: 200, price: 100 }] })))
    expect(find(annotations, 'boom').status).toBe('unprojectable')
    expect(find(annotations, 'flood').status).toBe('unprojectable')
    expect(find(annotations, 'junk').figures).toEqual([{ type: 'text', x: 60, y: 60, text: 'kept' }])
    expect(find(annotations, 'trend').status).toBe('visible')
  })

  it('reports an annotation entirely outside the pane as offscreen', () => {
    const annotations = layer()
    annotations.setAnnotations('mine', [spec({ key: 'far', kind: 'trend', anchors: [{ time: 100000, price: 100 }, { time: 100400, price: 120 }] })])
    expect(find(annotations, 'far').status).toBe('offscreen')
  })
})
