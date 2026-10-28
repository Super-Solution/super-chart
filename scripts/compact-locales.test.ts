import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { compactLocales, localeTablesModule } from './compact-locales.mjs'

const names = ['en-US', 'zh-CN', 'zh-TW']
const source = fileURLToPath(new URL('../src', import.meta.url))
const dictionaries: Array<Record<string, string>> = names.map(name => JSON.parse(
  readFileSync(new URL(`../src/i18n/${name}.json`, import.meta.url), 'utf8')
))
const decode = (input: Array<Record<string, string>>): Array<Record<string, string>> =>
  new Function(`${localeTablesModule(input).replace('export const locales', 'const locales')}; return locales;`)()

afterEach(() => {
  for (const name of names) vi.doUnmock(`../src/i18n/${name}.json`)
  vi.resetModules()
})

describe('built locale tables', () => {
  it('preserves every authored key, value and placeholder in all three locales', () => {
    const decoded = decode(dictionaries)
    decoded.forEach((dictionary, index) => {
      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(dictionaries[index]).sort())
      for (const [key, value] of Object.entries(dictionaries[index])) expect(dictionary[key]).toBe(value)
    })
  })

  it('preserves pipes, empty strings, quotes, backslashes, Unicode and prototype-named own keys', () => {
    const entries = [
      ['pipe|key', 'left|right'], ['empty', ''], ['quoted', '"\\中文\n{count}'], ['__proto__', 'safe']
    ]
    const input = [Object.fromEntries(entries), Object.fromEntries(entries.map(([key]) => [key, '']))]
    expect(decode(input)).toEqual(input)
    expect(Object.hasOwn(decode(input)[0], '__proto__')).toBe(true)
    expect(decode([{}, {}, {}])).toEqual([{}, {}, {}])
  })

  it('rejects missing or extra keys, inherited values and non-string translations', () => {
    expect(() => decode([])).toThrow(/At least one/)
    expect(() => decode([{ a: 'A' }, { b: 'B' }])).toThrow(/identical keys/)
    expect(() => decode([{ a: 'A' }, { a: 'A', b: 'B' }])).toThrow(/identical keys/)
    expect(() => decode([{ a: 'A' }, Object.assign(Object.create({ a: 'inherited' }), { b: 'B' })])).toThrow(/identical keys/)
    expect(() => decode([{ a: 'A' }, { a: 1 } as unknown as Record<string, string>])).toThrow(/string values/)
  })

  it('retains original English fallback and independent tables after host overrides', async () => {
    const decoded = decode(dictionaries)
    names.forEach((name, index) => vi.doMock(`../src/i18n/${name}.json`, () => ({ default: decoded[index] })))
    const { default: lookup, load } = await import('../src/i18n/index')
    const original = decoded[0].indicator
    load('en-US', { indicator: 'Host studies' })
    load('zh-CN', { indicator: '' })
    load('partial-test', { setting: 'Custom setting' })
    expect(lookup('indicator', 'en-US')).toBe('Host studies')
    expect(lookup('indicator', 'zh-CN')).toBe('')
    expect(lookup('indicator', 'partial-test')).toBe(original)
    expect(lookup('not_a_key', 'partial-test')).toBe('not_a_key')
    expect(decoded).toEqual(dictionaries)
  })
})

describe('build-only locale transform', () => {
  it.each(['/repo/src', 'F:\\repo\\src'])('targets exact locale modules on %s', root => {
    const plugin = compactLocales(root)
    expect(plugin.apply).toBe('build')
    expect(plugin.enforce).toBe('post')
    for (const name of names) {
      expect(plugin.transform('', `${root}/i18n/${name}.json`)?.code).toContain('export default locales[')
    }
    for (const other of ['other.json', 'en-US.json?raw', 'zh-CN.json?url', 'en-US.json.backup']) {
      expect(plugin.transform('', `${root}/i18n/${other}`)).toBeUndefined()
    }
    expect(plugin.transform('', `${root}/unrelated/en-US.json`)).toBeUndefined()
  })

  it('loads the generated shared table from the authored files', () => {
    const plugin = compactLocales(source)
    const id = `${source}/i18n/compact-locale-tables.js`
    expect(plugin.resolveId(id)).toBe(id.replace(/\\/g, '/'))
    expect(plugin.load(id)).toBe(localeTablesModule(dictionaries))
    expect(plugin.load(`${id}?raw`)).toBeUndefined()
    expect(plugin.resolveId(`${source}/unrelated.js`)).toBeUndefined()
  })
})
