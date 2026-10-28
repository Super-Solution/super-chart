import { describe, expect, it } from 'vitest'

import { COLLAPSED_PANE_HEIGHT, MIN_SUB_PANE_HEIGHT, layoutPaneHeights } from './paneLayout'
import type { SubPaneSpec } from './paneLayout'

function vol (priority = 0, height = 72): SubPaneSpec {
  return { id: 'vol', preferredHeight: height, priority }
}

describe('layoutPaneHeights', () => {
  it('no sub-panes: the candle pane gets the whole area', () => {
    expect(layoutPaneHeights(400, [])).toEqual({ candleHeight: 400, subPanes: [] })
  })

  it('preferred heights that fit are kept exactly (SupWallet 3x88px at a tall enough host)', () => {
    const panes: SubPaneSpec[] = [
      { id: 'a', preferredHeight: 88, priority: 0 },
      { id: 'b', preferredHeight: 88, priority: 1 },
      { id: 'c', preferredHeight: 88, priority: 2 }
    ]
    const result = layoutPaneHeights(900, panes)
    expect(result.subPanes.map(p => p.height)).toEqual([88, 88, 88])
    expect(result.subPanes.every(p => !p.collapsed)).toBe(true)
    expect(result.candleHeight).toBe(900 - 264)
  })

  it('never returns a pane at or below 0px, and heights sum to the pane area, across widths and counts', () => {
    for (const area of [360, 480, 640, 900]) {
      for (let n = 1; n <= 6; n++) {
        const panes: SubPaneSpec[] = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, preferredHeight: i === 0 ? 72 : 100, priority: i }))
        const result = layoutPaneHeights(area, panes)
        expect(result.candleHeight).toBeGreaterThan(0)
        for (const p of result.subPanes) {
          expect(p.height).toBeGreaterThan(0)
          if (p.collapsed) {
            expect(p.height).toBe(COLLAPSED_PANE_HEIGHT)
          } else {
            expect(p.height).toBeGreaterThanOrEqual(MIN_SUB_PANE_HEIGHT)
          }
        }
        const total = result.candleHeight + result.subPanes.reduce((s, p) => s + p.height, 0)
        expect(total).toBe(area)
      }
    }
  })

  it('the candle pane is at least the 55% floor when panes must shrink', () => {
    // VOL(72) + MACD(100) at 360px: klinecharts' fixed defaults left 188px of candles (98px with a legend, per SC-159); the floor rule keeps >= 55%.
    const panes: SubPaneSpec[] = [vol(0, 72), { id: 'macd', preferredHeight: 100, priority: 1 }]
    const result = layoutPaneHeights(360, panes)
    expect(result.candleHeight).toBeGreaterThanOrEqual(Math.round(360 * 0.55) - 1)
  })

  it('scales sub-panes down proportionally before collapsing anything', () => {
    const panes: SubPaneSpec[] = [{ id: 'a', preferredHeight: 100, priority: 0 }, { id: 'b', preferredHeight: 50, priority: 1 }]
    const result = layoutPaneHeights(300, panes) // floor 165, budget 135 < 150 preferred
    expect(result.subPanes.every(p => !p.collapsed)).toBe(true)
    const [a, b] = result.subPanes
    expect(a.height).toBeGreaterThan(b.height) // keeps the original 2:1 ratio, roughly
    expect(a.height).toBeGreaterThanOrEqual(MIN_SUB_PANE_HEIGHT)
    expect(b.height).toBeGreaterThanOrEqual(MIN_SUB_PANE_HEIGHT)
  })

  it('collapses the lowest-priority panes first when even the minimum does not fit', () => {
    // 6 sub-panes at 360px: floor ~198, budget ~162; 6*30=180 > 162, so at least one must collapse.
    // Lowest `priority` value collapses first; the caller decides what priority
    // means — here, "most recently added collapses first" is expressed by
    // giving later panes a lower number (5 - i).
    const panes: SubPaneSpec[] = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, preferredHeight: 100, priority: 5 - i }))
    const result = layoutPaneHeights(360, panes)
    const collapsedIds = result.subPanes.filter(p => p.collapsed).map(p => p.id)
    expect(collapsedIds.length).toBeGreaterThan(0)
    // p5 (i=5, priority 0, the lowest) collapses before p0 (i=0, priority 5, the highest).
    expect(collapsedIds).toContain('p5')
    expect(collapsedIds).not.toContain('p0')
  })

  it('host-specified heights are kept exactly when they fit, at 640px with up to 4 sub-panes', () => {
    for (let n = 1; n <= 4; n++) {
      const panes: SubPaneSpec[] = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, preferredHeight: 72, priority: i }))
      const result = layoutPaneHeights(640, panes)
      expect(result.subPanes.every(p => p.height === 72 && !p.collapsed)).toBe(true)
    }
  })

  it('is idempotent: laying out an already-collapsed set again gives the same result', () => {
    const panes: SubPaneSpec[] = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, preferredHeight: 100, priority: i }))
    const first = layoutPaneHeights(360, panes)
    const second = layoutPaneHeights(360, first.subPanes.map((p, i) => ({ id: p.id, preferredHeight: p.height, priority: i })))
    expect(second.subPanes.map(p => p.height)).toEqual(first.subPanes.map(p => p.height))
  })
})
