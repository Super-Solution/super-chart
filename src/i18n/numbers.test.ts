/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from 'vitest'

import { formatBigNumber, unitsLocale } from './numbers'

describe('formatBigNumber (SC-147)', () => {
  it('leaves small values (below 1000) exactly as klinecharts passed them', () => {
    expect(formatBigNumber('999', 'en-US')).toBe('999')
    expect(formatBigNumber(42.5, 'en-US')).toBe('42.5')
    expect(formatBigNumber('-999', 'en-US')).toBe('-999')
  })

  it('western (the default): K/M/B, at most 2 decimals, either sign', () => {
    expect(formatBigNumber(123456, 'en-US')).toBe('123.46K')
    expect(formatBigNumber(1_000_000, 'en-US')).toBe('1M')
    expect(formatBigNumber(-123456, 'en-US')).toBe('-123.46K')
    // The observed regression this also fixes: klinecharts' own formatter
    // wrote "1000K" for a million (it tests `> 1e6` strictly).
    expect(formatBigNumber(1_000_000, 'en-US')).not.toBe('1000K')
  })

  it('western stays western for zh-CN/zh-TW unless numberUnits is "locale"', () => {
    expect(formatBigNumber(123456, 'zh-CN')).toBe('123.46K')
    expect(formatBigNumber(123456, 'zh-TW')).toBe('123.46K')
  })

  it('numberUnits "locale" uses the chart locale\'s own compact units', () => {
    expect(formatBigNumber(123456, 'zh-CN', 'locale')).toBe('12.35万')
    expect(formatBigNumber(123456, 'zh-TW', 'locale')).toBe('12.35萬')
  })

  it('a locale outside the supported list falls back to western (en-US), never a decimal comma', () => {
    const deDE = formatBigNumber(123456, 'de-DE', 'locale')
    expect(deDE).toBe('123.46K')
    expect(deDE).not.toContain(',')
  })

  it('unitsLocale: "locale" only for a chart locale with its own units; "western" for everything', () => {
    expect(unitsLocale('zh-CN', 'locale')).toBe('zh-CN')
    expect(unitsLocale('zh-TW', 'locale')).toBe('zh-TW')
    expect(unitsLocale('en-US', 'locale')).toBe('en-US')
    expect(unitsLocale('ja-JP', 'locale')).toBe('en-US')
    expect(unitsLocale('zh-CN', 'western')).toBe('en-US')
  })

  it('a non-numeric string is returned unchanged', () => {
    expect(formatBigNumber('n/a', 'en-US')).toBe('n/a')
  })
})
