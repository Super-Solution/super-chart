import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import i18n, { format, load, matchLocale, negotiateLocale, resolveLocale, supportedLocales } from './index'
import enUS from './en-US.json'
import zhCN from './zh-CN.json'
import zhTW from './zh-TW.json'

const dir = __dirname
const files = readdirSync(dir).filter(f => f.endsWith('.json'))
const dicts: Record<string, Record<string, string>> = Object.fromEntries(
  files.map(f => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Record<string, string>])
)

describe('resolveLocale (SC-043)', () => {
  it.each([
    ['zh-TW', 'zh-TW'], ['zh-HK', 'zh-TW'], ['zh-MO', 'zh-TW'], ['zh-Hant', 'zh-TW'], ['zh-Hant-TW', 'zh-TW'], ['zh_TW', 'zh-TW'], ['ZH-tw', 'zh-TW'],
    ['zh', 'zh-CN'], ['zh-CN', 'zh-CN'], ['zh-Hans', 'zh-CN'], ['zh-SG', 'zh-CN'], ['zh_cn', 'zh-CN'],
    ['en', 'en-US'], ['en-US', 'en-US'], ['en-GB', 'en-US'], ['en-AU', 'en-US'],
    ['ja', 'en-US'], ['fr-FR', 'en-US'], ['', 'en-US'], ['!!', 'en-US'], ['  ', 'en-US']
  ])('%s -> %s', (tag, expected) => {
    expect(resolveLocale(tag)).toBe(expected)
  })

  it('is en-US for a value that is not a string', () => {
    expect(resolveLocale(undefined)).toBe('en-US')
    expect(resolveLocale(42)).toBe('en-US')
    expect(matchLocale(null)).toBeNull()
  })

  it('keeps a locale a host registered, exactly and by language', () => {
    load('ja-JP', { indicator: 'インジケーター' })
    expect(resolveLocale('ja-JP')).toBe('ja-JP')
    expect(resolveLocale('ja')).toBe('ja-JP')
    expect(supportedLocales()).toEqual(expect.arrayContaining(['en-US', 'zh-CN', 'zh-TW', 'ja-JP']))
  })

  it('negotiates the first supported language of the viewer, else en-US', () => {
    expect(negotiateLocale(['zh-TW', 'en-US'])).toBe('zh-TW')
    expect(negotiateLocale(['fr-FR', 'zh-HK', 'en'])).toBe('zh-TW')
    expect(negotiateLocale(['fr-FR', 'de'])).toBe('en-US')
    expect(negotiateLocale(['en-GB', 'zh-CN'])).toBe('en-US')
    expect(negotiateLocale([])).toBe('en-US')
    expect(negotiateLocale(undefined)).toBe('en-US')
  })
})

describe('lookup and registration (SC-043, SC-149)', () => {
  it('fills keys a new locale leaves out from en-US instead of showing raw keys', () => {
    load('fr-FR', { indicator: 'Indicateur' })
    expect(i18n('indicator', 'fr-FR')).toBe('Indicateur')
    expect(i18n('setting', 'fr-FR')).toBe(enUS.setting)
  })

  it('extends an existing locale instead of replacing it, and does not touch the built-in table', () => {
    const before = zhCN.setting
    load('zh-CN', { setting: '设定' })
    expect(i18n('setting', 'zh-CN')).toBe('设定')
    expect(i18n('indicator', 'zh-CN')).toBe(zhCN.indicator)
    expect(zhCN.setting).toBe(before)
    load('zh-CN', { setting: before })
  })

  it('a partial override of en-US keeps every other en-US string', () => {
    load('en-US', { indicator: 'Studies' })
    expect(i18n('indicator', 'en-US')).toBe('Studies')
    expect(i18n('timezone', 'en-US')).toBe('Timezone')
    expect(i18n('full_screen', 'en-US')).toBe('Full Screen')
    expect(enUS.indicator).toBe('Indicator')
    load('en-US', { indicator: enUS.indicator })
  })

  it('shows English, not the raw key, for a locale nobody loaded', () => {
    expect(i18n('indicator', 'xx-XX')).toBe('Indicator')
    expect(i18n('no_such_key', 'xx-XX')).toBe('no_such_key')
  })

  it('zh-TW is Traditional Chinese, not English or raw keys', () => {
    expect(i18n('indicator', 'zh-TW')).toBe('指標')
    expect(i18n('timezone', 'zh-TW')).toBe('時區')
    expect(i18n('setting', 'zh-TW')).toBe('設定')
  })

  it('format fills placeholders and leaves unknown ones', () => {
    expect(format('{count} bars', { count: 12 })).toBe('12 bars')
    expect(format('{a} {b}', { a: 1 })).toBe('1 {b}')
    expect(format('plain')).toBe('plain')
  })
})

describe('locale files (SC-072)', () => {
  it('ships en-US, zh-CN and zh-TW with the same keys', () => {
    expect(Object.keys(dicts).sort()).toEqual(['en-US', 'zh-CN', 'zh-TW'])
    const keys = Object.keys(enUS).sort()
    expect(Object.keys(zhCN).sort()).toEqual(keys)
    expect(Object.keys(zhTW).sort()).toEqual(keys)
  })

  it('every value is a non-empty string', () => {
    for (const [name, dict] of Object.entries(dicts)) {
      for (const [key, value] of Object.entries(dict)) {
        expect({ name, key, ok: typeof value === 'string' && value.trim().length > 0 }).toEqual({ name, key, ok: true })
      }
    }
  })

  it('en-US has no CJK text', () => {
    const cjk = Object.entries(enUS).filter(([, v]) => /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/.test(v))
    expect(cjk).toEqual([])
  })

  it('en-US spells the indicator names right', () => {
    expect(enUS.boll).toContain('Bollinger')
    expect(enUS.bbi).toContain('Bull and Bear Index')
    expect(Object.values(enUS).join(' ')).not.toMatch(/Bolinger|Bearlndex/)
  })

  it('zh-TW uses Traditional characters where zh-CN uses Simplified ones', () => {
    // Characters that exist only in Simplified Chinese and appear in zh-CN.json.
    const simplifiedOnly = /[时设图线标锁删显隐价数据载试动对轴网关闭无为个这进复择颜样细层键图录货币认账产类]/
    const offending = Object.entries(zhTW).filter(([, v]) => simplifiedOnly.test(v))
    expect(offending).toEqual([])
  })

  it('placeholders match across locales', () => {
    const names = (v: string): string[] => (v.match(/\{\w+\}/g) ?? []).sort()
    for (const key of Object.keys(enUS) as Array<keyof typeof enUS>) {
      expect({ key, zhCN: names(zhCN[key]) }).toEqual({ key, zhCN: names(enUS[key]) })
      expect({ key, zhTW: names(zhTW[key]) }).toEqual({ key, zhTW: names(enUS[key]) })
    }
  })
})
