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

import { createSignal } from 'solid-js'

import zhCN from './zh-CN.json'
import zhTW from './zh-TW.json'
import enUS from './en-US.json'

/** The locale every lookup falls back to, and what an unsupported tag resolves to. */
export const FALLBACK_LOCALE = 'en-US'

// String-keyed on purpose: a key type derived from en-US.json would put a JSON
// import into the published d.ts, which dts-bundle-generator cannot bundle.
const english: Readonly<Record<string, string>> = enUS
const locales: Record<string, Readonly<Record<string, string>>> = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'zh-TW': zhTW
}

// Read by every lookup, so a mounted chart's chrome re-renders when a host
// registers strings after it mounted.
const [revision, setRevision] = createSignal(0)

/**
 * Add or extend the chrome strings for a locale: merged over the locale's
 * current strings (never replacing them, and never mutating the built-in
 * tables). A key the locale lacks shows its en-US text, so a partial
 * dictionary is fine. Canvas strings are forwarded separately (src/i18n/canvas.ts).
 */
export function load (key: string, ls: Readonly<Record<string, string>>): void {
  locales[key] = { ...locales[key], ...ls }
  setRevision(r => r + 1)
}

/** Locales with chrome strings: the built-in three plus any a host registered. */
export function supportedLocales (): string[] {
  return Object.keys(locales)
}

function exactLocale (tag: string): string | undefined {
  const lower = tag.toLowerCase()
  return Object.keys(locales).find(k => k.toLowerCase() === lower)
}

/**
 * The language and script of a tag, maximized (zh-HK → zh + Hant, zh → zh +
 * Hans). Null for an invalid tag. Without Intl.Locale, a prefix match.
 */
function languageOf (tag: string): { language: string, script?: string } | null {
  const IntlLocale = (Intl as unknown as { Locale?: new (tag: string) => { maximize: () => { language: string, script?: string } } }).Locale
  if (typeof IntlLocale === 'function') {
    try {
      const max = new IntlLocale(tag).maximize()
      return { language: max.language, script: max.script }
    } catch (e) {
      return null
    }
  }
  const m = /^([a-z]{2,3})(?:-([a-z]{4}))?(?:-([a-z]{2}|\d{3}))?(?:-|$)/i.exec(tag)
  if (m === null) {
    return null
  }
  const language = m[1].toLowerCase()
  const script = m[2] !== undefined
    ? m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()
    : (language === 'zh' ? (/^(tw|hk|mo)$/i.test(m[3] ?? '') ? 'Hant' : 'Hans') : undefined)
  return { language, script }
}

/**
 * The supported locale a BCP-47 tag stands for, or null when none does.
 * An exact match wins (case-insensitive; `_` reads as `-`), so a locale a
 * host registered is kept as it is. Otherwise: Traditional Chinese (zh-TW,
 * zh-HK, zh-MO, zh-Hant-*) is zh-TW; other Chinese (zh, zh-CN, zh-SG,
 * zh-Hans) is zh-CN; any English is en-US; another language matches a
 * registered locale of the same language.
 */
export function matchLocale (tag: unknown): string | null {
  if (typeof tag !== 'string') {
    return null
  }
  const t = tag.trim().replace(/_/g, '-')
  if (t === '') {
    return null
  }
  const exact = exactLocale(t)
  if (exact !== undefined) {
    return exact
  }
  const lang = languageOf(t)
  if (lang === null) {
    return null
  }
  if (lang.language === 'zh') {
    return lang.script === 'Hant' ? 'zh-TW' : 'zh-CN'
  }
  if (lang.language === 'en') {
    return 'en-US'
  }
  return Object.keys(locales).find(k => languageOf(k)?.language === lang.language) ?? null
}

/** matchLocale, with en-US for a tag no supported locale stands for. */
export function resolveLocale (tag: unknown): string {
  return matchLocale(tag) ?? FALLBACK_LOCALE
}

/** The first of the viewer's languages (navigator.languages order) that is supported, else en-US. */
export function negotiateLocale (tags: readonly unknown[] | null | undefined): string {
  for (const tag of tags ?? []) {
    const match = matchLocale(tag)
    if (match !== null) {
      return match
    }
  }
  return FALLBACK_LOCALE
}

/** The browser's preferred languages, most preferred first ([] without a navigator). */
export function viewerLanguages (): readonly string[] {
  if (typeof navigator === 'undefined') {
    return []
  }
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages
  }
  return typeof navigator.language === 'string' ? [navigator.language] : []
}

/** Fill `{name}` placeholders. Unknown names are left as they are. */
export function format (template: string, vars?: Readonly<Record<string, string | number>>): string {
  if (vars === undefined) {
    return template
  }
  return template.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all))
}

/** The string for `key` in `locale`, else its en-US text, else the key itself. */
export default (key: string, locale: string): string => {
  revision()
  return locales[locale]?.[key] ?? english[key] ?? key
}
