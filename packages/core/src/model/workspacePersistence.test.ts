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
})
