import { describe, expect, it, vi } from 'vitest'

import {
  attachCursorReset, attachLatestTracking, attachWheelNavigation, decideNavKey, decideWheelAction, isAtLatest,
  makeKeyNavHandler, nextBarSpace, pointInRect
} from './navigation'
import type { CursorResetChart, KeyNavChart, LatestTrackingChart, WheelNavChart } from './navigation'

describe('nextBarSpace', () => {
  it('negative deltaY (wheel up) zooms in by 1.1x per notch', () => {
    let bs = 8
    for (let i = 0; i < 3; i++) bs = nextBarSpace(bs, -100)
    expect(bs).toBeCloseTo(8 * 1.1 * 1.1 * 1.1, 5) // 10.648
  })

  it('positive deltaY (wheel down) zooms out', () => {
    expect(nextBarSpace(11, 100)).toBeCloseTo(10, 5)
  })

  it('clamps to [1, 50] — reaches exactly 50 from just under it', () => {
    expect(nextBarSpace(49, -100)).toBe(50)
    expect(nextBarSpace(1, 100)).toBe(1)
  })

  it('deltaY 0 is a no-op', () => {
    expect(nextBarSpace(8, 0)).toBe(8)
  })
})

describe('decideWheelAction', () => {
  it('horizontal-dominant wheel is always passthrough (klinecharts keeps scrolling it)', () => {
    expect(decideWheelAction({ deltaX: 50, deltaY: 5, mode: 'zoom', ctrlKey: false })).toBe('passthrough')
  })

  it('mode "zoom" (default): vertical wheel anywhere in the chart zooms', () => {
    expect(decideWheelAction({ deltaX: 0, deltaY: -100, mode: 'zoom', ctrlKey: false })).toBe('zoom')
  })

  it('mode "none": vertical wheel scrolls the page, never zooms', () => {
    expect(decideWheelAction({ deltaX: 0, deltaY: -100, mode: 'none', ctrlKey: false })).toBe('page-scroll')
  })

  it('mode "modifier": zooms only with ctrlKey (trackpad pinch), else page-scroll', () => {
    expect(decideWheelAction({ deltaX: 0, deltaY: -100, mode: 'modifier', ctrlKey: false })).toBe('page-scroll')
    expect(decideWheelAction({ deltaX: 0, deltaY: -100, mode: 'modifier', ctrlKey: true })).toBe('zoom')
  })

  it('deltaY 0 is passthrough', () => {
    expect(decideWheelAction({ deltaX: 0, deltaY: 0, mode: 'zoom', ctrlKey: false })).toBe('passthrough')
  })
})

describe('attachWheelNavigation', () => {
  function fakeRoot (): { root: EventTarget & { dispatch: (e: Partial<WheelEvent>) => void }, listeners: Array<(e: WheelEvent) => void> } {
    const listeners: Array<(e: WheelEvent) => void> = []
    const root = {
      addEventListener: (_type: string, fn: (e: WheelEvent) => void) => { listeners.push(fn) },
      removeEventListener: (_type: string, fn: (e: WheelEvent) => void) => {
        const i = listeners.indexOf(fn)
        if (i >= 0) listeners.splice(i, 1)
      },
      dispatch (e: Partial<WheelEvent>) { listeners.forEach(fn => { fn(e as WheelEvent) }) }
    }
    return { root: root as unknown as EventTarget & { dispatch: (e: Partial<WheelEvent>) => void }, listeners }
  }

  it('zoom mode: calls setBarSpace and prevents default + stops propagation', () => {
    const { root } = fakeRoot()
    const chart: WheelNavChart = { getBarSpace: () => 8, setBarSpace: vi.fn(), isZoomEnabled: () => true }
    attachWheelNavigation(root as unknown as HTMLElement, chart, () => 'zoom')
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    ;(root as unknown as { dispatch: (e: unknown) => void }).dispatch({ deltaX: 0, deltaY: -100, ctrlKey: false, preventDefault, stopPropagation })
    expect(chart.setBarSpace).toHaveBeenCalledWith(nextBarSpace(8, -100))
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
  })

  it('mode "none": stops propagation (blocks klinecharts) but does not preventDefault (page scrolls)', () => {
    const { root } = fakeRoot()
    const chart: WheelNavChart = { getBarSpace: () => 8, setBarSpace: vi.fn(), isZoomEnabled: () => true }
    attachWheelNavigation(root as unknown as HTMLElement, chart, () => 'none')
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    ;(root as unknown as { dispatch: (e: unknown) => void }).dispatch({ deltaX: 0, deltaY: -100, ctrlKey: false, preventDefault, stopPropagation })
    expect(chart.setBarSpace).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
  })

  it('horizontal scroll: neither prevented nor stopped (klinecharts scrolls as today)', () => {
    const { root } = fakeRoot()
    const chart: WheelNavChart = { getBarSpace: () => 8, setBarSpace: vi.fn(), isZoomEnabled: () => true }
    attachWheelNavigation(root as unknown as HTMLElement, chart, () => 'zoom')
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    ;(root as unknown as { dispatch: (e: unknown) => void }).dispatch({ deltaX: 50, deltaY: 5, ctrlKey: false, preventDefault, stopPropagation })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
  })

  it('zoom disabled: still swallows the event (no dead-zone regression) but does not change bar space', () => {
    const { root } = fakeRoot()
    const chart: WheelNavChart = { getBarSpace: () => 8, setBarSpace: vi.fn(), isZoomEnabled: () => false }
    attachWheelNavigation(root as unknown as HTMLElement, chart, () => 'zoom')
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    ;(root as unknown as { dispatch: (e: unknown) => void }).dispatch({ deltaX: 0, deltaY: -100, ctrlKey: false, preventDefault, stopPropagation })
    expect(chart.setBarSpace).not.toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
  })
})

describe('decideNavKey', () => {
  it('ArrowLeft/ArrowRight pan by 1 bar, or 10 with Shift', () => {
    expect(decideNavKey({ code: 'ArrowLeft', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false })).toEqual({ kind: 'scroll', bars: 1 })
    expect(decideNavKey({ code: 'ArrowRight', shiftKey: true, altKey: false, ctrlKey: false, metaKey: false })).toEqual({ kind: 'scroll', bars: -10 })
  })

  it('Equal/Minus zoom, Home/End jump, Alt+R resets', () => {
    expect(decideNavKey({ code: 'Equal', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false })).toEqual({ kind: 'zoomIn' })
    expect(decideNavKey({ code: 'Minus', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false })).toEqual({ kind: 'zoomOut' })
    expect(decideNavKey({ code: 'Home', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false })).toEqual({ kind: 'home' })
    expect(decideNavKey({ code: 'End', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false })).toEqual({ kind: 'end' })
    expect(decideNavKey({ code: 'KeyR', shiftKey: false, altKey: true, ctrlKey: false, metaKey: false })).toEqual({ kind: 'reset' })
  })

  it('plain KeyR (no Alt) does nothing — it is not a shortcut on its own', () => {
    expect(decideNavKey({ code: 'KeyR', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false })).toBeNull()
  })

  it('Ctrl/Cmd combos and IME composition are left alone', () => {
    expect(decideNavKey({ code: 'ArrowLeft', shiftKey: false, altKey: false, ctrlKey: true, metaKey: false })).toBeNull()
    expect(decideNavKey({ code: 'Equal', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: true })).toBeNull()
  })

  it('an unrelated key does nothing', () => {
    expect(decideNavKey({ code: 'KeyA', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false })).toBeNull()
  })
})

describe('makeKeyNavHandler', () => {
  function fakeChart (dom: object, overrides: Partial<KeyNavChart> = {}): KeyNavChart {
    return {
      getDom: () => dom as HTMLElement,
      getBarSpace: () => 8,
      setBarSpace: vi.fn(),
      isZoomEnabled: () => true,
      scrollByDistance: vi.fn(),
      scrollToDataIndex: vi.fn(),
      scrollToRealTime: vi.fn(),
      ...overrides
    }
  }

  it('only acts when the event target is exactly the klinecharts canvas container', () => {
    const dom = {}
    const chart = fakeChart(dom)
    const handler = makeKeyNavHandler(chart, () => 8)
    const other = {}
    const handled = handler({ code: 'ArrowLeft', target: other, preventDefault: vi.fn() } as unknown as KeyboardEvent)
    expect(handled).toBe(false)
    expect(chart.scrollByDistance).not.toHaveBeenCalled()
  })

  it('ArrowLeft scrolls by +1 bar-space (older bars); Shift+ArrowLeft by 10', () => {
    const dom = {}
    const chart = fakeChart(dom)
    const handler = makeKeyNavHandler(chart, () => 8)
    const preventDefault = vi.fn()
    expect(handler({ code: 'ArrowLeft', target: dom, preventDefault } as unknown as KeyboardEvent)).toBe(true)
    expect(chart.scrollByDistance).toHaveBeenCalledWith(8)
    expect(preventDefault).toHaveBeenCalled()

    const handler2 = makeKeyNavHandler(chart, () => 8)
    handler2({ code: 'ArrowLeft', shiftKey: true, target: dom, preventDefault: vi.fn() } as unknown as KeyboardEvent)
    expect(chart.scrollByDistance).toHaveBeenCalledWith(80)
  })

  it('ArrowRight scrolls by a negative distance (newer bars)', () => {
    const dom = {}
    const chart = fakeChart(dom)
    const handler = makeKeyNavHandler(chart, () => 8)
    handler({ code: 'ArrowRight', target: dom, preventDefault: vi.fn() } as unknown as KeyboardEvent)
    expect(chart.scrollByDistance).toHaveBeenCalledWith(-8)
  })

  it('Equal/Minus zoom via setBarSpace, guarded by isZoomEnabled', () => {
    const dom = {}
    const chart = fakeChart(dom, { isZoomEnabled: () => false })
    const handler = makeKeyNavHandler(chart, () => 8)
    handler({ code: 'Equal', target: dom, preventDefault: vi.fn() } as unknown as KeyboardEvent)
    expect(chart.setBarSpace).not.toHaveBeenCalled()
  })

  it('Home jumps to the first bar (scrollToDataIndex(0)); End to real time', () => {
    const dom = {}
    const chart = fakeChart(dom)
    const handler = makeKeyNavHandler(chart, () => 8)
    handler({ code: 'Home', target: dom, preventDefault: vi.fn() } as unknown as KeyboardEvent)
    expect(chart.scrollToDataIndex).toHaveBeenCalledWith(0)
    handler({ code: 'End', target: dom, preventDefault: vi.fn() } as unknown as KeyboardEvent)
    expect(chart.scrollToRealTime).toHaveBeenCalled()
  })

  it('Alt+R restores the captured initial bar space and scrolls to real time', () => {
    const dom = {}
    const chart = fakeChart(dom)
    const handler = makeKeyNavHandler(chart, () => 6)
    handler({ code: 'KeyR', altKey: true, target: dom, preventDefault: vi.fn() } as unknown as KeyboardEvent)
    expect(chart.setBarSpace).toHaveBeenCalledWith(6)
    expect(chart.scrollToRealTime).toHaveBeenCalled()
  })

  it('a key it does not own returns false and touches nothing', () => {
    const dom = {}
    const chart = fakeChart(dom)
    const handler = makeKeyNavHandler(chart, () => 8)
    expect(handler({ code: 'KeyA', target: dom, preventDefault: vi.fn() } as unknown as KeyboardEvent)).toBe(false)
  })
})

describe('pointInRect', () => {
  it('inside, on the edge, and outside', () => {
    const rect = { left: 10, top: 10, width: 20, height: 20 }
    expect(pointInRect(15, 15, rect)).toBe(true)
    expect(pointInRect(10, 10, rect)).toBe(true) // edge inclusive
    expect(pointInRect(30, 30, rect)).toBe(true) // far edge inclusive
    expect(pointInRect(9, 15, rect)).toBe(false)
    expect(pointInRect(31, 15, rect)).toBe(false)
  })
})

describe('isAtLatest / attachLatestTracking', () => {
  it('true when the visible range reaches the last bar, false otherwise', () => {
    expect(isAtLatest({ getVisibleRange: () => ({ to: 100 }), getDataList: () => new Array(100) })).toBe(true)
    expect(isAtLatest({ getVisibleRange: () => ({ to: 80 }), getDataList: () => new Array(100) })).toBe(false)
  })

  function fakeRoot (): HTMLElement {
    const listeners = new Map<string, Array<() => void>>()
    return {
      addEventListener: (type: string, fn: () => void) => {
        const arr = listeners.get(type) ?? []
        listeners.set(type, arr)
        arr.push(fn)
      },
      removeEventListener: (type: string, fn: () => void) => {
        const arr = listeners.get(type)
        const i = arr?.indexOf(fn) ?? -1
        if (arr !== undefined && i >= 0) arr.splice(i, 1)
      },
      dispatch: (type: string) => { listeners.get(type)?.forEach(fn => { fn() }) }
    } as unknown as HTMLElement
  }

  it('checks immediately on attach, and again on the tracked action types', () => {
    let to = 80
    const dataList = new Array(100)
    const chart: LatestTrackingChart = {
      getVisibleRange: () => ({ to }),
      getDataList: () => dataList,
      subscribeAction: vi.fn(),
      unsubscribeAction: vi.fn()
    }
    const onChange = vi.fn()
    const root = fakeRoot()
    attachLatestTracking(root, chart, ['onVisibleRangeChange'], onChange)
    expect(onChange).toHaveBeenCalledWith(false)
    to = 100
    const cb = (chart.subscribeAction as ReturnType<typeof vi.fn>).mock.calls[0][1] as () => void
    cb()
    expect(onChange).toHaveBeenLastCalledWith(true)
  })

  it('also recomputes on pointerup/wheel on the root, so an unsubscribeAction(type) wipe cannot get it stuck', () => {
    let to = 80
    const dataList = new Array(100)
    const chart: LatestTrackingChart = {
      getVisibleRange: () => ({ to }),
      getDataList: () => dataList,
      subscribeAction: vi.fn(),
      unsubscribeAction: vi.fn()
    }
    const onChange = vi.fn()
    const root = fakeRoot()
    attachLatestTracking(root, chart, ['onVisibleRangeChange'], onChange)
    to = 100
    ;(root as unknown as { dispatch: (t: string) => void }).dispatch('pointerup')
    expect(onChange).toHaveBeenLastCalledWith(true)
  })

  it('dispose removes every listener it added', () => {
    const chart: LatestTrackingChart = {
      getVisibleRange: () => ({ to: 0 }),
      getDataList: () => [],
      subscribeAction: vi.fn(),
      unsubscribeAction: vi.fn()
    }
    const root = fakeRoot()
    const dispose = attachLatestTracking(root, chart, ['onVisibleRangeChange'], vi.fn())
    dispose()
    expect(chart.unsubscribeAction).toHaveBeenCalledWith('onVisibleRangeChange', expect.any(Function))
  })
})

describe('attachCursorReset', () => {
  it('resets a pointer cursor back to crosshair, and never touches a non-pointer cursor', () => {
    const el = { style: { cursor: 'pointer' } }
    const chart: CursorResetChart = {
      getDom: () => el as unknown as HTMLElement,
      subscribeAction: vi.fn(),
      unsubscribeAction: vi.fn()
    }
    attachCursorReset(chart, 'onCrosshairChange')
    const handler = (chart.subscribeAction as ReturnType<typeof vi.fn>).mock.calls[0][1] as (d: { paneId?: string }) => void
    handler({ paneId: 'candle_pane' })
    expect(el.style.cursor).toBe('crosshair')

    const other = { style: { cursor: 'move' } }
    const chart2: CursorResetChart = { getDom: () => other as unknown as HTMLElement, subscribeAction: vi.fn(), unsubscribeAction: vi.fn() }
    attachCursorReset(chart2, 'onCrosshairChange')
    const handler2 = (chart2.subscribeAction as ReturnType<typeof vi.fn>).mock.calls[0][1] as (d: { paneId?: string }) => void
    handler2({ paneId: 'candle_pane' })
    expect(other.style.cursor).toBe('move') // a drawing-editor cursor is not overwritten
  })

  it('dispose unsubscribes the same callback', () => {
    const chart: CursorResetChart = { getDom: () => null, subscribeAction: vi.fn(), unsubscribeAction: vi.fn() }
    const dispose = attachCursorReset(chart, 'onCrosshairChange')
    dispose()
    const subscribed = (chart.subscribeAction as ReturnType<typeof vi.fn>).mock.calls[0][1]
    const unsubscribed = (chart.unsubscribeAction as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(unsubscribed).toBe(subscribed)
  })
})
