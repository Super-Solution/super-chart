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

// klinecharts keeps its own locale table for the strings it draws on the
// canvas (the candle legend's "Time: ", "Open: " …) and ships only zh-CN and
// en-US: any other locale draws the raw keys ("time", "open"). This fills the
// table for every locale the chart uses. klinecharts is a peer, so this is the
// host's instance; its registerLocale merges, so this never removes a host's
// own strings, and it is global, so it serves every chart on the page.
//
// Part of SUPer-Chart (Apache-2.0).

import { registerLocale, getSupportedLocales } from 'klinecharts'

/** The keys klinecharts draws on the canvas. */
export const CANVAS_KEYS = ['time', 'open', 'high', 'low', 'close', 'volume', 'turnover', 'change'] as const
export type CanvasKey = typeof CANVAS_KEYS[number]

// klinecharts' own en-US strings (9.7/9.8), for locales it does not know.
const CANVAS_EN: Record<CanvasKey, string> = {
  time: 'Time: ',
  open: 'Open: ',
  high: 'High: ',
  low: 'Low: ',
  close: 'Close: ',
  volume: 'Volume: ',
  turnover: 'Turnover: ',
  change: 'Change: '
}

const CANVAS_BUILTIN: Record<string, Record<CanvasKey, string>> = {
  'zh-TW': {
    time: '時間：',
    open: '開：',
    high: '高：',
    low: '低：',
    close: '收：',
    volume: '成交量：',
    turnover: '成交額：',
    change: '漲跌幅：'
  }
}

/** The canvas keys in a dictionary (a host's registerLocale argument). */
export function canvasStrings (ls: Readonly<Record<string, string>>): Partial<Record<CanvasKey, string>> {
  const out: Partial<Record<CanvasKey, string>> = {}
  for (const key of CANVAS_KEYS) {
    if (typeof ls[key] === 'string') {
      out[key] = ls[key]
    }
  }
  return out
}

/**
 * Make sure klinecharts has canvas strings for `locale` before a chart uses
 * it: the built-in table for zh-TW, else English. A locale klinecharts
 * already knows is left alone.
 */
export function ensureCanvasLocale (locale: string): void {
  try {
    if (getSupportedLocales().includes(locale)) {
      return
    }
    registerLocale(locale, { ...CANVAS_EN, ...CANVAS_BUILTIN[locale] })
  } catch (e) {
    // A klinecharts without the locale API: the canvas keeps its own strings.
  }
}

/**
 * Forward a host's canvas strings for `locale` to klinecharts. klinecharts
 * merges them over what it has (after ensureCanvasLocale gave an unknown
 * locale a full table), so the keys the host left out keep their text.
 */
export function registerCanvasStrings (locale: string, ls: Readonly<Record<string, string>>): void {
  const strings = canvasStrings(ls)
  ensureCanvasLocale(locale)
  if (Object.keys(strings).length > 0) {
    try {
      registerLocale(locale, strings as Record<CanvasKey, string>)
    } catch (e) {
      // see ensureCanvasLocale
    }
  }
}
