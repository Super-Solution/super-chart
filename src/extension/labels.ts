/**
 * The text Super Chart's own drawing tools draw on the canvas ("Target",
 * "Stop", "12 bars", a text tool's placeholder), in the chart's locale.
 *
 * A template's createPointFigures gets no locale and no chart (klinecharts
 * 9.x passes only the overlay, coordinates, bounding, precision and styles),
 * and templates are registered once for the whole page. So the strings come
 * from module state: the Pro chart installs its locale's strings from its
 * locale effect, right before it calls klinecharts' setLocale, whose full
 * repaint then redraws the labels. One locale per page, last writer wins;
 * every host today mounts all its charts in one locale.
 *
 * Without a Pro chart (the lite entry's registerExtensionOverlays on a raw
 * klinecharts chart) the tools draw the en-US text below, so this module does
 * not pull the chrome's dictionaries into the lite bundle. A test keeps these
 * strings equal to src/i18n/en-US.json.
 *
 * Part of SUPer-Chart (Apache-2.0).
 */

/** The en-US labels (the same text as src/i18n/en-US.json). */
export const DRAWING_LABELS_EN = {
  drawing_long: 'Long',
  drawing_short: 'Short',
  drawing_rr: '{side} · RR {rr}',
  drawing_target: 'Target {price} ({pct})',
  drawing_stop: 'Stop {price} ({pct})',
  drawing_bars: '{count} bars',
  drawing_text: 'Text',
  drawing_note: 'Note',
  drawing_callout: 'Callout',
  drawing_sign: 'Sign'
} as const
export type DrawingLabelKey = keyof typeof DRAWING_LABELS_EN

/** Where the labels come from: a key's text, or undefined for the en-US one. */
export type DrawingLabelSource = (key: DrawingLabelKey) => string | undefined

let source: DrawingLabelSource = () => undefined

/** The strings the drawing tools draw from now on (the caller repaints the chart). */
export function setDrawingLabelSource (next: DrawingLabelSource | null): void {
  source = next ?? (() => undefined)
}

/** A drawing tool's label, with `{name}` placeholders filled; never the raw key. */
export function drawingLabel (key: DrawingLabelKey, vars?: Readonly<Record<string, string | number>>): string {
  const template = source(key) ?? DRAWING_LABELS_EN[key]
  if (vars === undefined) {
    return template
  }
  return template.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all))
}
