import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import { TOOLBAR_LABELS, LINE_STYLE_LABELS } from './labels'

const I18N_DIR = join(__dirname, '..', 'i18n')
const TOOLBAR_SOURCE = join(__dirname, '..', 'widget', 'drawing-toolbar', 'index.tsx')

const locales = readdirSync(I18N_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => ({ file: f, keys: JSON.parse(readFileSync(join(I18N_DIR, f), 'utf-8')) as Record<string, string> }))

describe('drawing toolbar i18n', () => {
  it('has at least the two shipped locales', () => {
    expect(locales.map(l => l.file).sort()).toEqual(expect.arrayContaining(['en-US.json', 'zh-CN.json']))
  })

  it('has every toolbar label in every locale, non-empty', () => {
    const keys = [...Object.values(TOOLBAR_LABELS), ...Object.values(LINE_STYLE_LABELS)]
    for (const { file, keys: dict } of locales) {
      for (const key of keys) {
        expect({ file, key, value: typeof dict[key] === 'string' && dict[key].length > 0 }).toEqual({ file, key, value: true })
      }
    }
  })

  it('keeps the locale files in step (same keys everywhere)', () => {
    const [first, ...rest] = locales
    for (const other of rest) {
      expect(Object.keys(other.keys).sort()).toEqual(Object.keys(first.keys).sort())
    }
  })

  it('the toolbar component takes its text from these labels, not literal keys', () => {
    const source = readFileSync(TOOLBAR_SOURCE, 'utf-8')
    // i18n is only ever called with a label constant
    const literalCalls = source.match(/i18n\(\s*['"`]/g) ?? []
    expect(literalCalls).toEqual([])
    expect(source).toContain('TOOLBAR_LABELS')
  })
})
