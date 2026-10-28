import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { prepareNativeHold, supportsNativeHold } from './klineCompatibility'
import { createHoldCompatibility } from './compatibility'

type Handler = (event: Record<string, unknown>) => void
class Surface {
  readonly listeners = new Map<string, Handler[]>()
  readonly ownerDocument: Surface
  readonly documentElement: Surface
  constructor (doc?: Surface) { this.ownerDocument = doc ?? this; this.documentElement = this }
  addEventListener (name: string, handler: Handler): void { this.listeners.set(name, [...(this.listeners.get(name) ?? []), handler]) }
  removeEventListener (name: string, handler: Handler): void { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(fn => fn !== handler)) }
  contains (): boolean { return true }
  getBoundingClientRect (): { left: number, top: number } { return { left: 0, top: 0 } }
  fire (name: string, event: Record<string, unknown>): void { (this.listeners.get(name) ?? []).slice().forEach(fn => { fn(event) }) }
}
interface PeerGesture {
  destroy: () => void
  _mousePressed: boolean
  _activeTouchId: number | null
  _unsubscribeRootMouseEvents: unknown
  _unsubscribeRootTouchEvents: unknown
  _longTapActive: boolean
}
type PeerConstructor = new (target: Surface, handlers: Record<string, () => void>, options: Record<string, () => boolean>) => PeerGesture

function actualPeer (packageName: string): { target: Surface, root: Surface, gesture: PeerGesture, chart: unknown, handlers: Record<string, ReturnType<typeof vi.fn>> } {
  const require = createRequire(import.meta.url)
  const file = require.resolve(`${packageName}/dist/index.esm.js`)
  const source = readFileSync(file, 'utf8')
  // Verify the adapter's path against the actual shipped ChartImp and Event constructors.
  expect(source).toMatch(/this\._chartEvent = new Event\(/)
  expect(source).toMatch(/this\._event = new SyntheticEvent\(/)
  const start = source.indexOf('var SyntheticEvent = ')
  expect(start).toBeGreaterThan(0)
  const end = source.indexOf('\n}());', start)
  expect(end).toBeGreaterThan(start)
  // Execute the peer's unchanged SyntheticEvent implementation with a tiny non-browser DOM surface.
  // This is not a reimplementation of its press/tap/release state machine.
  const Ctor = runInNewContext(source.slice(start, end + 6) + '\nSyntheticEvent', {
    isIOS: () => false,
    isFF: () => false,
    isValid: (value: unknown) => value !== null && value !== undefined,
    __assign: Object.assign,
    setTimeout,
    clearTimeout,
    performance: { now: () => 1000 }
  }) as PeerConstructor
  const root = new Surface()
  const target = new Surface(root)
  const handlers = { mouseDownEvent: vi.fn(), mouseUpEvent: vi.fn(), mouseClickEvent: vi.fn(), pressedMouseMoveEvent: vi.fn(), touchStartEvent: vi.fn(), touchEndEvent: vi.fn(), tapEvent: vi.fn(), longTapEvent: vi.fn(), pinchStartEvent: vi.fn(), pinchEvent: vi.fn(), pinchEndEvent: vi.fn() }
  const gesture = new Ctor(target, handlers, { treatVertDragAsPageScroll: () => false, treatHorzDragAsPageScroll: () => false })
  return { target, root, gesture, chart: { _chartEvent: { _event: gesture } }, handlers }
}
const mouse = (type: string, x: number): Record<string, unknown> => ({ type, button: 0, clientX: x, clientY: 20, pageX: x, pageY: 20, timeStamp: 1000, cancelable: true, preventDefault: vi.fn() })
const finger = (id: number, x: number): Record<string, unknown> => ({ identifier: id, clientX: x, clientY: 20, pageX: x, pageY: 20 })
const touch = (type: string, touches: Array<Record<string, unknown>>, changedTouches = touches): Record<string, unknown> => ({ type, touches, changedTouches, timeStamp: 2000, cancelable: true, preventDefault: vi.fn() })

afterEach(() => { vi.useRealTimers() })

describe.each(['klinecharts', 'klinecharts-compat'])('%s shipped native event compatibility', packageName => {
  it('finds the real private seam, suppresses synthetic click, releases cleanly and permits the next quick drag', () => {
    vi.useFakeTimers()
    const { target, root, gesture, chart, handlers } = actualPeer(packageName)
    target.fire('mousedown', mouse('mousedown', 20))
    expect(gesture._mousePressed).toBe(true)
    expect(supportsNativeHold(chart)).toBe(true)
    expect(prepareNativeHold(chart)).toBe(true)
    // No native move reaches the peer while the hold controller owns the stroke.
    root.fire('mouseup', mouse('mouseup', 120))
    expect(handlers.mouseUpEvent).toHaveBeenCalledOnce()
    expect(handlers.mouseClickEvent).not.toHaveBeenCalled()
    expect(gesture._mousePressed).toBe(false)
    expect(gesture._unsubscribeRootMouseEvents).toBeNull()
    target.fire('mousedown', mouse('mousedown', 20))
    root.fire('mousemove', mouse('mousemove', 70))
    expect(handlers.pressedMouseMoveEvent).toHaveBeenCalledOnce()
    root.fire('mouseup', mouse('mouseup', 70))
    expect(gesture._mousePressed).toBe(false)
    gesture.destroy()
    gesture.destroy()
  })
  it('cancels the actual 500ms long tap, permits a second-finger pinch and releases without a tap', () => {
    vi.useFakeTimers()
    const { target, root, gesture, chart, handlers } = actualPeer(packageName)
    const first = finger(1, 20)
    target.fire('touchstart', touch('touchstart', [first]))
    vi.advanceTimersByTime(333)
    expect(prepareNativeHold(chart)).toBe(true)
    vi.advanceTimersByTime(500)
    expect(handlers.longTapEvent).not.toHaveBeenCalled()
    expect(gesture._longTapActive).toBe(false)
    const second = finger(2, 70)
    target.fire('touchstart', touch('touchstart', [first, second], [second]))
    expect(handlers.pinchStartEvent).toHaveBeenCalledOnce()
    root.fire('touchend', touch('touchend', [], [first]))
    expect(handlers.tapEvent).not.toHaveBeenCalled()
    expect(gesture._activeTouchId).toBeNull()
    expect(gesture._unsubscribeRootTouchEvents).toBeNull()
    gesture.destroy()
  })
})

describe('move suppression boundary', () => {
  it('leaves quick pan alone, suppresses held mouse/touch moves until native release and yields to pinch', () => {
    const onPinch = vi.fn()
    const compatibility = createHoldCompatibility(onPinch)
    const quick = new Event('mousemove', { cancelable: true })
    compatibility.move(quick)
    expect(quick.defaultPrevented).toBe(false)
    compatibility.start()
    const held = new Event('mousemove', { cancelable: true })
    compatibility.move(held)
    expect(held.defaultPrevented).toBe(true)
    // Escape cancels drawing state but does not resume panning within the same physical press.
    const afterEscape = new Event('mousemove', { cancelable: true })
    compatibility.move(afterEscape)
    expect(afterEscape.defaultPrevented).toBe(true)
    compatibility.release()
    const next = new Event('mousemove', { cancelable: true })
    compatibility.move(next)
    expect(next.defaultPrevented).toBe(false)
    compatibility.start()
    const pinch = new Event('touchmove', { cancelable: true })
    Object.defineProperty(pinch, 'touches', { value: [finger(1, 20), finger(2, 70)] })
    compatibility.move(pinch)
    expect(onPinch).toHaveBeenCalledOnce()
    expect(pinch.defaultPrevented).toBe(false)
  })
  it('fails closed for an unsupported peer without mutating it', () => {
    const peer = { _chartEvent: { _event: { _cancelClick: false } } }
    expect(supportsNativeHold(peer)).toBe(false)
    expect(prepareNativeHold(peer)).toBe(false)
    expect(peer._chartEvent._event._cancelClick).toBe(false)
    expect(prepareNativeHold(null)).toBe(false)
    expect(prepareNativeHold({ _chartEvent: { _event: null } })).toBe(false)
  })
})
