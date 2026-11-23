// SPDX-License-Identifier: GPL-3.0-or-later
import { colors, themeName } from './tokens'

/** Where the badge leads. */
export const POWERED_BY_URL = 'https://supersolution.io'
export const POWERED_BY_LABEL = 'Powered by Super Chart'

/** The badge is a 22px circle `BADGE_INSET` from the chart's left and bottom edges. */
export const BADGE_INSET = 4
export const BADGE_SIZE = 22
/** Where the first thing in the time-axis row may start: past the badge, with a gap as wide as its inset. */
export const BADGE_CLEARANCE = BADGE_INSET * 2 + BADGE_SIZE

/**
 * Centre of a time-axis label or crosshair time tag: on its own position, kept inside the chart (`margin` from the right
 * edge and from the left one) and clear of the badge, which sits in the same row at the left. A label wider than the
 * room keeps its left edge at the clearance.
 */
export function timeLabelCentre (position: number, width: number, chartWidth: number, margin: number): number {
  return Math.max(Math.max(margin, BADGE_CLEARANCE) + width / 2, Math.min(chartWidth - margin - width / 2, position))
}

const STYLE = `
.sc-powered{position:absolute;left:${BADGE_INSET}px;bottom:${BADGE_INSET}px;z-index:3;box-sizing:border-box;display:inline-flex;align-items:center;gap:0;height:${BADGE_SIZE}px;min-width:${BADGE_SIZE}px;max-width:${BADGE_SIZE}px;padding:0 3px;overflow:hidden;white-space:nowrap;text-decoration:none;cursor:pointer;pointer-events:auto;touch-action:manipulation;
border-radius:999px;color:var(--sc-powered-ink);font:500 11px/1 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:0;text-transform:none;
background:linear-gradient(135deg,rgba(255,255,255,.34) 0%,rgba(255,255,255,.06) 42%,rgba(255,255,255,.02) 58%,rgba(255,255,255,.18) 100%);
-webkit-backdrop-filter:blur(6px) saturate(1.4);backdrop-filter:blur(6px) saturate(1.4);
border:1px solid var(--sc-powered-edge);
box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(255,255,255,.08),0 1px 6px rgba(0,0,0,.14);
opacity:.55;transition:opacity .18s ease,max-width .22s ease,gap .22s ease,padding .22s ease}
.sc-powered:hover,.sc-powered:focus-visible{text-decoration:none;opacity:1;max-width:190px;gap:6px;padding:0 10px 0 3px}
.sc-powered:focus-visible{outline:2px solid var(--sc-powered-focus);outline-offset:2px}
.sc-powered svg{flex:none;width:16px;height:16px;display:block}
.sc-powered-text{flex:none}
@media (prefers-reduced-motion:reduce){.sc-powered{transition:none}}
@media print{.sc-powered{opacity:.7}}
`

const MARK = '<svg viewBox="-15 -61 120 120" aria-hidden="true" focusable="false"><g fill="none" stroke-linecap="round" stroke-width="4.5"><path stroke="var(--sc-powered-bar)" d="M11 -13.85V54.15M79 -56V12"/><path stroke="var(--sc-powered-mid)" d="M45 -35.93V32.07"/></g><g transform="skewY(-28)"><rect x="0" y="0" width="22" height="48" rx="3" fill="var(--sc-powered-bar)"/><rect x="34" y="0" width="22" height="48" rx="3" fill="var(--sc-powered-mid)"/><rect x="68" y="0" width="22" height="48" rx="3" fill="var(--sc-powered-bar)"/></g></svg>'

export interface PoweredByBadge {
  /** Follow the chart's theme: the mark and the glass edge keep their contrast on light and dark. */
  setTheme: (theme: unknown) => void
  dispose: () => void
}

/**
 * The "Powered by Super Chart" badge in the chart's bottom-left corner.
 *
 * It belongs to the chart, not to the workspace chrome, so it is there with every layout and with `headless`, and it
 * has no option to turn it off. It sits in the bottom-left corner, where the price gutter meets the time axis; the time labels start clear of it (`timeLabelCentre`). It takes pointer
 * events only on itself, and opens `supersolution.io` in a new tab. At rest it is a small, faint glass bubble holding the
 * mark; hover or keyboard focus reveals the words.
 */
export function attachPoweredBy (root: HTMLElement, theme: unknown): PoweredByBadge {
  const doc = root.ownerDocument
  const style = doc.createElement('style')
  style.textContent = STYLE
  const link = doc.createElement('a')
  link.className = 'sc-powered'
  link.href = POWERED_BY_URL
  link.target = '_blank'
  link.rel = 'noopener'
  link.setAttribute('aria-label', `${POWERED_BY_LABEL} (opens supersolution.io in a new tab)`)
  link.title = POWERED_BY_LABEL
  link.innerHTML = MARK
  const text = doc.createElement('span')
  text.className = 'sc-powered-text'
  text.textContent = POWERED_BY_LABEL
  text.setAttribute('aria-hidden', 'true')
  link.append(text)
  root.append(style, link)
  const setTheme = (value: unknown): void => {
    const c = colors(value), dark = themeName(value) === 'dark'
    link.style.setProperty('--sc-powered-bar', c.ink)
    link.style.setProperty('--sc-powered-mid', c.violet)
    link.style.setProperty('--sc-powered-ink', c.ink)
    link.style.setProperty('--sc-powered-edge', dark ? 'rgba(255,255,255,.22)' : 'rgba(15,15,20,.16)')
    link.style.setProperty('--sc-powered-focus', c.violetStrong)
  }
  setTheme(theme)
  return { setTheme, dispose: () => { link.remove(); style.remove() } }
}
