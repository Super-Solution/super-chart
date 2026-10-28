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

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import { DRAWING_LABELS_EN, drawingLabel, setDrawingLabelSource } from './labels'
import enUS from '../i18n/en-US.json'
import zhCN from '../i18n/zh-CN.json'
import zhTW from '../i18n/zh-TW.json'

const I18N_DIR = join(__dirname, '..', 'i18n')
const locales: Array<{ file: string, dict: Record<string, string> }> = readdirSync(I18N_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => ({ file: f, dict: JSON.parse(readFileSync(join(I18N_DIR, f), 'utf-8')) as Record<string, string> }))

describe('drawing labels (SC-146)', () => {
  it('always resolves — even before any locale source is set — never the raw key', () => {
    setDrawingLabelSource(null)
    for (const key of Object.keys(DRAWING_LABELS_EN) as Array<keyof typeof DRAWING_LABELS_EN>) {
      expect(drawingLabel(key)).toBe(DRAWING_LABELS_EN[key])
    }
  })

  it('the en-US fallback text matches src/i18n/en-US.json byte for byte', () => {
    for (const [key, value] of Object.entries(DRAWING_LABELS_EN)) {
      expect({ key, value }).toEqual({ key, value: (enUS as Record<string, string>)[key] })
    }
  })

  it('every drawing-label key exists, non-empty, in every shipped locale file', () => {
    const keys = Object.keys(DRAWING_LABELS_EN)
    for (const { file, dict } of locales) {
      for (const key of keys) {
        expect({ file, key, ok: typeof dict[key] === 'string' && dict[key].length > 0 }).toEqual({ file, key, ok: true })
      }
    }
  })

  it('fills {name} placeholders', () => {
    setDrawingLabelSource(null)
    expect(drawingLabel('drawing_target', { price: '135.87', pct: '+7.94%' })).toBe('Target 135.87 (+7.94%)')
    expect(drawingLabel('drawing_bars', { count: 12 })).toBe('12 bars')
  })

  it('a set source overrides the fallback (zh-CN put-back check)', () => {
    setDrawingLabelSource(key => zhCN[key])
    expect(drawingLabel('drawing_target', { price: '100', pct: '+1%' })).toBe('目标 100 (+1%)')
    expect(drawingLabel('drawing_long')).toBe(zhCN.drawing_long)
    setDrawingLabelSource(key => zhTW[key])
    expect(drawingLabel('drawing_stop', { price: '90', pct: '-1%' })).toBe(zhTW.drawing_stop.replace('{price}', '90').replace('{pct}', '-1%'))
    setDrawingLabelSource(null)
  })

  it('a source that returns undefined for a key falls back to en-US, never the key', () => {
    setDrawingLabelSource(() => undefined)
    expect(drawingLabel('drawing_note')).toBe(DRAWING_LABELS_EN.drawing_note)
    setDrawingLabelSource(null)
  })
})
