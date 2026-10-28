// Source-level checks on the thin Solid layer around the drawing editor. The
// behaviour itself is tested on the pure modules (src/drawing-editor); these only
// pin that the components still hand it the inputs those tests assume. Unit tests
// run in node without a DOM or the Solid compiler, so the components are read as
// text (as labels.test.ts does for the i18n keys).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const toolbar = readFileSync(join(__dirname, 'index.tsx'), 'utf-8')
const chartPro = readFileSync(join(__dirname, '..', '..', 'ChartProComponent.tsx'), 'utf-8')

const count = (source: string, pattern: RegExp): number => (source.match(pattern) ?? []).length

describe('drawing toolbar wiring', () => {
  it('the lock toggle keeps one accessible name and reports its state only through aria-pressed', () => {
    expect(toolbar).toMatch(/aria-label=\{t\(TOOLBAR_LABELS\.lock\)\}\s+title=\{t\(TOOLBAR_LABELS\.lock\)\}\s+aria-pressed=\{props\.snapshot\.locked\}/)
    // no name or tooltip that depends on the state
    expect(toolbar).not.toMatch(/(aria-label|title)=\{[^}\n]*locked/)
  })

  it('every popover is fitted inside the chart (popoverLeft)', () => {
    const menus = count(toolbar, /<div ref=\{popoverRef\} class="tb-popover tb-menu/g)
    const colorPopovers = count(toolbar, /<ColorPopover\s+ref=\{popoverRef\}/g)
    expect(menus + colorPopovers).toBe(count(toolbar, /<Show when=\{popover\(\) === '/g))
    expect(toolbar).toMatch(/<div ref=\{props\.ref\} class="tb-popover tb-color-popover"/)
    expect(toolbar).toMatch(/popoverLeft\(/)
  })

  it('the first placement avoids the lines a drawing draws beyond its points', () => {
    expect(toolbar).toMatch(/defaultToolbarPosition\(bounds, size, rect, \{ topInset: LEGEND_INSET, avoidLines \}\)/)
    expect(chartPro).toMatch(/lines = drawnLines\(overlay\.name, points, /)
    expect(chartPro).toMatch(/avoid=\{selectedDrawingAvoid\}/)
  })

  it('makes brush and highlighter strokes clickable across their visible width', () => {
    const brush = readFileSync(join(__dirname, '..', '..', 'extension', 'brush.ts'), 'utf-8')
    expect(brush).toMatch(/const tolerance = strokeHitTolerance\(overlay\.styles\?\.line\?\.size \?\? size\)/)
    expect(brush).toMatch(/hitPathWithin\(tolerance, coordinates\)/)
  })

  it('passes the input type, so Escape from the opacity slider closes its popover', () => {
    expect(toolbar).toMatch(/targetInputType: target instanceof HTMLInputElement \? target\.type\.toLowerCase\(\) : null/)
  })

  it('feeds the editor the symbol (symbol search and the host\'s setSymbol both go through that signal)', () => {
    expect(chartPro).toMatch(/createEffect\(\(\) => \{ editor\.setDataContext\(drawingsKeyOf\(symbol\(\)\)\) \}\)/)
    // drawingsKeyOf defaults to the ticker, but a host can override it (SC-120)
    expect(chartPro).toMatch(/drawingsKeyOf = \(s: SymbolInfo \| undefined\): string => \(s === undefined \? '' : props\.drawingsKey\(s\)\)/)
    // setSymbol is the raw signal setter, wrapped for the public API (SC-023's
    // Promise<LoadResult> and SC-108's symbolChange event) — applySymbol calls
    // it, so both the modal ('user') and props.ref ('api') still update the
    // same signal editor.setDataContext above reads.
    expect(chartPro).toMatch(/const applySymbol = async \(s: SymbolInfo, source: 'user' \| 'api'\): Promise<LoadResult> => \{[\s\S]*?setSymbol\(s\)/)
    // The object literal is assigned to `chartApi` (so the AI/MCP command
    // layer's execute() can close over it before props.ref(chartApi) below)
    // rather than being built inline in the props.ref(...) call itself —
    // setSymbol is still the same wrapper, in the same literal.
    expect(chartPro).toMatch(/chartApi = \{[\s\S]*?\n\s+setSymbol: async s => await applySymbol\(s, 'api'\),\n/)
    expect(chartPro).toMatch(/props\.ref\(chartApi\)/)
  })

  it('reserves room for the replay bar before the toolbar places or clamps itself (SC-057)', () => {
    expect(toolbar).toMatch(/const height = chart\.clientHeight - Math\.max\(0, props\.reservedBottom\?\.\(\) \?\? 0\)/)
    expect(chartPro).toMatch(/reservedBottom=\{toolbarReservedBottom\}/)
    expect(chartPro).toMatch(/<ReplayBar\s+ref=\{el => \{ replayBarRef = el \}\}/)
    // re-clamps (not just re-placed on selection) when reservedBottom's own value changes
    expect(toolbar).toMatch(/createEffect\(on\(\(\) => props\.reservedBottom\?\.\(\), \(\) => \{ place\(false\) \}/)
  })

  it('caps the toolbar\'s own width to the chart\'s, and lets it wrap instead of overflowing (SC-080)', () => {
    expect(toolbar).toMatch(/setMaxWidth\(bounds\.width\)/)
    expect(toolbar).toMatch(/'max-width': `\$\{maxWidth\(\)\}px`/)
    const less = readFileSync(join(__dirname, 'index.less'), 'utf-8')
    expect(less).toMatch(/flex-wrap:\s*wrap/)
  })

  it('registers its Delete/Backspace/Escape handling on the chart\'s key dispatcher at EDITOR priority, not its own window listener', () => {
    expect(toolbar).toMatch(/scope\?\.keys\.register\(onEditorKey, \{ priority: KEY_PRIORITY\.EDITOR \}\)/)
    expect(toolbar).not.toMatch(/window\.addEventListener\('keydown'/)
    expect(toolbar).not.toMatch(/window\.removeEventListener\('keydown'/)
  })

  it('rings drawing-toolbar swatches from the text colour instead of border-color (SC-059)', () => {
    const less = readFileSync(join(__dirname, 'index.less'), 'utf-8')
    expect(count(less, /box-shadow: inset 0 0 0 1px color-mix\(in srgb, var\(--klinecharts-pro-text-color\) 55%, transparent\);/g)).toBe(2)
    expect(less).not.toMatch(/\.tb-swatch\s*\{[^}]*border: solid 1px var\(--klinecharts-pro-border-color\)/s)
  })
})
