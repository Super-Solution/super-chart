/**
 * Big numbers on the canvas (volume, its axis and legend): klinecharts'
 * customApi.formatBigNumber.
 *
 * klinecharts' own formatter writes K/M/B with three decimals and only above
 * the unit ("1000K" for a million, since it tests `> 1e6`). This one uses a
 * cached Intl compact formatter with at most two decimals, from 1000 up
 * (either sign), and leaves smaller values exactly as klinecharts passed them.
 *
 * Units: 'western' (the default) is K/M/B in every language, the TradingView
 * convention. 'locale' uses the chart locale's own units, 万/亿 for zh-CN and
 * 萬/億 for zh-TW. Only the chart's supported locales get their own format; any
 * other locale is formatted as en-US, so no comma decimal ("1,2 Mio.") or
 * "123.456" (a German thousands group) ever sits next to prices that
 * klinecharts writes with a '.' decimal.
 *
 * Part of SUPer-Chart (Apache-2.0).
 */

export type NumberUnits = 'western' | 'locale'

const LOCALE_UNITS = ['en-US', 'zh-CN', 'zh-TW']

const cache = new Map<string, Intl.NumberFormat | null>()

function compact (locale: string): Intl.NumberFormat | null {
  let format = cache.get(locale)
  if (format === undefined) {
    try {
      format = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 })
    } catch (e) {
      format = null // an engine without compact notation: klinecharts' own text
    }
    cache.set(locale, format)
  }
  return format
}

/** The locale whose compact units a chart in `locale` uses. */
export function unitsLocale (locale: string, units: NumberUnits): string {
  return units === 'locale' && LOCALE_UNITS.includes(locale) ? locale : 'en-US'
}

/**
 * `value` as the chart shows a big number: compact from 1000 up (either
 * sign), else unchanged. `value` is what klinecharts passes, often already a
 * string with its precision applied.
 */
export function formatBigNumber (value: string | number, locale: string, units: NumberUnits = 'western'): string {
  const v = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(v) || Math.abs(v) < 1000) {
    return String(value)
  }
  const format = compact(unitsLocale(locale, units))
  if (format === null) {
    return String(value)
  }
  return format.format(v)
}
