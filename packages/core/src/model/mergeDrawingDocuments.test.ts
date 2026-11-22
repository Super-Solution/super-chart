import { describe, expect, it } from 'vitest'
import { DrawingStore, mergeDrawingDocuments } from './drawings'

function store (...items: Array<{ id: string, price: number }>): string {
  const s = new DrawingStore()
  for (const item of items) s.add({ id: item.id, type: 'horizontal', anchors: [{ timestamp: 1_700_000_000_000, price: item.price }] })
  return s.exportJson()
}
const ids = (json: string | null): string[] => (JSON.parse(json ?? '{"drawings":[]}') as { drawings: Array<{ id: string }> }).drawings.map(d => d.id)

describe('mergeDrawingDocuments', () => {
  it('keeps every drawing of either side, and this device\'s version of one both have', () => {
    const local = store({ id: 'a', price: 1 }, { id: 'b', price: 20 })
    const remote = store({ id: 'a', price: 2 }, { id: 'c', price: 3 })
    const merged = mergeDrawingDocuments(local, remote)
    expect(ids(merged)).toEqual(['a', 'c', 'b'])
    const a = (JSON.parse(merged ?? '') as { drawings: Array<{ id: string, anchors: Array<{ price: number }> }> }).drawings.find(d => d.id === 'a')
    expect(a?.anchors[0]?.price).toBe(1)
  })

  it('the result is a document the store accepts', () => {
    const merged = mergeDrawingDocuments(store({ id: 'a', price: 1 }), store({ id: 'b', price: 2 }))
    expect(() => { new DrawingStore().importJson(merged ?? '') }).not.toThrow()
  })

  it('returns null for a document that is not valid, or too big when joined', () => {
    const good = store({ id: 'a', price: 1 })
    expect(mergeDrawingDocuments(good, '{"version":2,"drawings":[]}')).toBeNull()
    expect(mergeDrawingDocuments('nope', good)).toBeNull()
    expect(mergeDrawingDocuments(good, '{"version":1,"drawings":[{"id":"x"}]}')).toBeNull()
    const many = (prefix: string): string => { const s = new DrawingStore(); for (let i = 0; i < 600; i++) s.add({ id: `${prefix}${i}`, type: 'horizontal', anchors: [{ timestamp: 1_700_000_000_000, price: i }] }); return s.exportJson() }
    expect(mergeDrawingDocuments(many('l'), many('r'))).toBeNull()
  })

  it('does not accept a duplicated id inside one document', () => {
    const one = JSON.parse(store({ id: 'a', price: 1 })) as { version: number, drawings: unknown[] }
    one.drawings.push(one.drawings[0])
    expect(mergeDrawingDocuments(JSON.stringify(one), store({ id: 'b', price: 1 }))).toBeNull()
  })
})
