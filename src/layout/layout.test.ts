import { describe, expect, it, vi } from 'vitest'

import { FIT_SLACK, FitStep, chooseStep, fitSteps, fitTopBar, stepRank } from './topBarFit'
import { decideRoot } from './hostRoot'
import { ALL_PARTS, resolveParts } from './parts'
import { shouldResize } from './observeSize'
import { CHART_PARTS } from '../types'

describe('top bar fit steps', () => {
  it('auto: labels, then icons, then tools into More one by one, then periods collapsed', () => {
    const steps = fitSteps('auto', 2)
    expect(steps).toEqual([
      { size: 'regular', hidden: 0 },
      { size: 'compact', hidden: 0 }, { size: 'compact', hidden: 1 }, { size: 'compact', hidden: 2 },
      { size: 'narrow', hidden: 0 }, { size: 'narrow', hidden: 1 }, { size: 'narrow', hidden: 2 }
    ])
    expect(steps.map(s => stepRank(s, 2))).toEqual([0, 3, 4, 5, 6, 7, 8])
  })

  it('a forced class keeps its class and still moves tools into More', () => {
    expect(fitSteps('regular', 1)).toEqual([{ size: 'regular', hidden: 0 }, { size: 'regular', hidden: 1 }])
    expect(fitSteps('narrow', 1).every(s => s.size === 'narrow')).toBe(true)
  })

  it('in auto, core tools stay until the periods have collapsed', () => {
    const steps = fitSteps('auto', 7, 5)
    expect(steps.filter(s => s.size === 'compact').map(s => s.hidden)).toEqual([0, 1, 2, 3, 4, 5])
    expect(steps.filter(s => s.size === 'narrow').map(s => s.hidden)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    // A forced class can move every tool.
    expect(Math.max(...fitSteps('compact', 7, 5).map(s => s.hidden))).toBe(7)
  })

  it('chooses the least collapsed step that fits, with a handful of measurements', () => {
    // Needed width per step: labels 1200, icons 700, each tool out -40, periods collapsed -150.
    const need = (s: FitStep): number => (s.size === 'regular' ? 1200 : 700) - (s.size === 'narrow' ? 150 : 0) - 40 * s.hidden
    for (const [width, expected] of [
      [1300, { size: 'regular', hidden: 0 }],
      [800, { size: 'compact', hidden: 0 }],
      [620, { size: 'compact', hidden: 2 }],
      [500, { size: 'compact', hidden: 5 }],
      [480, { size: 'narrow', hidden: 2 }],
      [100, { size: 'narrow', hidden: 7 }]
    ] as Array<[number, FitStep]>) {
      const fits = vi.fn((s: FitStep) => need(s) <= width)
      expect(chooseStep(fitSteps('auto', 7, 5), fits)).toEqual(expected)
      expect(fits.mock.calls.length).toBeLessThanOrEqual(8)
    }
  })

  it('steps back up only with slack, so a width at the boundary does not flip', () => {
    const need = (s: FitStep): number => (s.size === 'regular' ? 1000 : 600)
    let state: FitStep = { size: 'regular', hidden: 0 }
    const run = (width: number, current: FitStep | null): FitStep => fitTopBar('auto', 0, current, {
      apply: s => { state = s },
      measure: slack => need(state) <= width - slack
    })
    expect(run(999, null)).toEqual({ size: 'compact', hidden: 0 })
    // Back to 1000 wide: labels would fit with 0px to spare, not FIT_SLACK.
    expect(run(1000, { size: 'compact', hidden: 0 })).toEqual({ size: 'compact', hidden: 0 })
    expect(run(1000 + FIT_SLACK, { size: 'compact', hidden: 0 })).toEqual({ size: 'regular', hidden: 0 })
    // Staying in the current step needs no slack.
    expect(run(1000, { size: 'regular', hidden: 0 })).toEqual({ size: 'regular', hidden: 0 })
    // It leaves the bar in the chosen state.
    expect(state).toEqual({ size: 'regular', hidden: 0 })
  })
})

describe('the root box', () => {
  it('waits for a rendered container and the stylesheet', () => {
    expect(decideRoot({ rendered: false, styled: true, width: 0, height: 0 })).toBeNull()
    expect(decideRoot({ rendered: true, styled: false, width: 0, height: 0 })).toBeNull()
  })

  it('falls back to a definite height when the container gives none, and flags no width', () => {
    expect(decideRoot({ rendered: true, styled: true, width: 800, height: 0 })).toEqual({ autosize: true, noWidth: false })
    expect(decideRoot({ rendered: true, styled: true, width: 800, height: 420 })).toEqual({ autosize: false, noWidth: false })
    expect(decideRoot({ rendered: true, styled: true, width: 0, height: 420 })).toEqual({ autosize: false, noWidth: true })
  })
})

describe('parts', () => {
  it('defaults every part to true', () => {
    expect(resolveParts(undefined)).toEqual(ALL_PARTS)
    expect(Object.keys(ALL_PARTS)).toEqual([...CHART_PARTS])
    expect(Object.values(ALL_PARTS).every(v => v)).toBe(true)
  })

  it('merges over a base and ignores unknown keys and non-booleans with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const once = resolveParts({ symbol: false, bogus: false, replay: 'no' })
    expect(once.symbol).toBe(false)
    expect(once.replay).toBe(true)
    expect('bogus' in once).toBe(false)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(resolveParts({ symbol: true, fullscreen: false }, once)).toEqual({ ...ALL_PARTS, fullscreen: false })
    expect(resolveParts('symbol')).toEqual(ALL_PARTS)
    warn.mockRestore()
  })
})

describe('observeSize', () => {
  it('resizes on a real change, never for a hidden (zero) size or a repeat', () => {
    expect(shouldResize({ width: 500, height: 300 }, null)).toBe(true)
    expect(shouldResize({ width: 500, height: 300 }, { width: 500, height: 300 })).toBe(false)
    expect(shouldResize({ width: 500.2, height: 300 }, { width: 500, height: 300 })).toBe(false)
    expect(shouldResize({ width: 600, height: 300 }, { width: 500, height: 300 })).toBe(true)
    expect(shouldResize({ width: 0, height: 300 }, { width: 500, height: 300 })).toBe(false)
  })
})
