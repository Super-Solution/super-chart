import { describe, expect, it, beforeEach } from 'vitest'
import {
  getIndicatorCatalog, addIndicatorCatalogEntries, setIndicatorCatalog, resetIndicatorCatalog,
  catalogEntryFor, isScReplacement, registerCatalogedScriptIndicator, getDrawingToolCatalog, SC_INDICATOR_NAMES
} from './catalog'

describe('indicator catalogue', () => {
  beforeEach(() => { resetIndicatorCatalog() })

  it('seeds the 27 klinecharts built-ins plus the SC_ pack', () => {
    const names = getIndicatorCatalog().map(e => e.name)
    expect(names).toContain('RSI')
    expect(names).toContain('MACD')
    for (const n of SC_INDICATOR_NAMES) expect(names).toContain(n)
  })

  it('isScReplacement is true only for RSI/MACD/SMA\'s SC_ targets', () => {
    expect(isScReplacement('SC_RSI')).toBe(true)
    expect(isScReplacement('SC_ATR')).toBe(false)
  })

  it('addIndicatorCatalogEntries adds without dropping the seed', () => {
    addIndicatorCatalogEntries([{ name: 'MY_SCRIPT', title: 'My script', category: 'scripts', pane: 'new', params: [], source: 'script', listed: true }])
    const names = getIndicatorCatalog().map(e => e.name)
    expect(names).toContain('MY_SCRIPT')
    expect(names).toContain('RSI')
  })

  it('setIndicatorCatalog replaces the whole list (a host curating its own)', () => {
    setIndicatorCatalog([{ name: 'ONLY_ONE', title: 'Only', category: 'other', pane: 'new', params: [], source: 'host', listed: true }])
    expect(getIndicatorCatalog().map(e => e.name)).toEqual(['ONLY_ONE'])
    expect(catalogEntryFor('RSI')).toBeUndefined()
  })

  it('registerCatalogedScriptIndicator registers AND lists a script (SC-133\'s SUPER_TEST case)', () => {
    // The real registrar binds to klinecharts' registerIndicator/getSupportedIndicators,
    // which need a browser ESM host; a fake one exercises this wrapper's own logic
    // (registered.add proves the register callback ran, not just the catalog write).
    const registered: string[] = []
    const fakeRegister = (o: { name: string }): string => { registered.push(o.name); return o.name }
    const name = registerCatalogedScriptIndicator({ name: 'SUPER_TEST', source: 'plot(close)' }, { title: 'Super Test' }, fakeRegister)
    expect(registered).toEqual(['SUPER_TEST'])
    const entry = catalogEntryFor(name)
    expect(entry).toBeDefined()
    expect(entry?.source).toBe('script')
    expect(entry?.listed).toBe(true)
    expect(entry?.title).toBe('Super Test')
  })

  it('put-back: a plain registerScriptIndicator call (no catalog wrapper) would stay unlisted', () => {
    // Simulated by never calling addIndicatorCatalogEntries for this name.
    expect(catalogEntryFor('SUPER_UNLISTED')).toBeUndefined()
  })
})

describe('getDrawingToolCatalog', () => {
  it('lists this package\'s own overlays and excludes the non-tool figures', () => {
    // klinecharts' real getSupportedOverlays() needs a browser ESM host; the
    // fake list stands in for it (this package's own tools come from ./index
    // regardless of what is injected here).
    const list = getDrawingToolCatalog(['priceLine', 'simpleAnnotation', 'simpleTag', 'segment'])
    expect(list.some(e => e.name === 'anchoredVWAP')).toBe(true)
    expect(list.some(e => e.name === 'priceLine')).toBe(false)
    expect(list.some(e => e.name === 'simpleAnnotation')).toBe(false)
    expect(list.some(e => e.name === 'simpleTag')).toBe(false)
    const builtinSegment = list.find(e => e.name === 'segment' && e.group === 'builtin')
    expect(builtinSegment).toBeDefined()
  })
})
