import { describe, expect, it } from 'vitest'
import { parseWorkspaceDocument } from './workspacePersistence'

const document = (render: Record<string, unknown>): string => JSON.stringify({
  version: 1, symbol: { ticker: 'AAA' }, period: { multiplier: 1, timespan: 'hour', text: '1h' },
  render, layout: {}, indicators: [], drawings: { version: 1, drawings: [] }
})

describe('workspace document render options', () => {
  it('accepts the theme a themed workspace saves, so a themed chart can always save itself', () => {
    expect(parseWorkspaceDocument(document({ theme: 'light', background: '#fff' })).render.theme).toBe('light')
    expect(parseWorkspaceDocument(document({ theme: 'dark' })).render.theme).toBe('dark')
  })
  it('rejects a theme that is neither base set, and still rejects unknown options', () => {
    expect(() => parseWorkspaceDocument(document({ theme: 'sepia' }))).toThrow(/Unknown render theme/)
    expect(() => parseWorkspaceDocument(document({ themed: 'dark' }))).toThrow(/Unknown or missing render options property/)
  })
  it('saves the viewer\'s grid, legend and hidden watermark, but never a watermark text', () => {
    const saved = parseWorkspaceDocument(document({ gridLines: 'both', legend: false, watermark: null })).render
    expect([saved.gridLines, saved.legend, saved.watermark]).toEqual(['both', false, null])
    expect(() => parseWorkspaceDocument(document({ gridLines: 'diagonal' }))).toThrow(/Unknown grid lines mode/)
    expect(() => parseWorkspaceDocument(document({ watermark: { title: 'X' } }))).toThrow(/can only be null/)
  })
})
