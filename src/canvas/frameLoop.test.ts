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

import { describe, expect, it } from 'vitest'
import { collectCanvases, createFrameLoop, isKlineCanvas, type FrameLoopEnv } from './frameLoop'

/** A manual requestAnimationFrame. */
function fakeEnv (): FrameLoopEnv & { flush: () => number, queued: () => number, errors: unknown[] } {
  let now = 0
  let id = 0
  const queue = new Map<number, (t: number) => void>()
  const errors: unknown[] = []
  return {
    raf: cb => { queue.set(++id, cb); return id },
    cancel: h => { queue.delete(h) },
    now: () => now,
    onError: e => { errors.push(e) },
    errors,
    queued: () => queue.size,
    flush: () => {
      now += 16
      const due = [...queue.values()]
      queue.clear()
      for (const cb of due) cb(now)
      return due.length
    }
  }
}

/**
 * The scheduling of a klinecharts 9.8.12 Canvas, reproduced: one pending
 * frame per canvas, and a request that arrives while one is pending is
 * DROPPED along with its callback (`_resetPixelRatio`'s size change).
 */
class Canvas9812 {
  _requestAnimationId = -1
  _width = 100
  _height = 50
  paints: string[] = []
  _ctx = { clearRect: () => {} }
  constructor (readonly raf: (cb: () => void) => number, readonly log: string[] = []) {}
  _listener (): void { this.paints.push(`w${this._width}`); this.log.push(`paint:${this._width}`) }
  _executeListener (fn?: () => void): void {
    if (this._requestAnimationId === -1) {
      this._requestAnimationId = this.raf(() => {
        this._ctx.clearRect()
        fn?.()
        this._listener()
        this._requestAnimationId = -1
      })
    }
  }

  resize (w: number): void { this._executeListener(() => { this._width = w }) }
}

/** klinecharts 9.7.2: a new request CANCELS the pending one, callback and all. */
class Canvas972 extends Canvas9812 {
  constructor (readonly env: { raf: (cb: () => void) => number, cancel: (h: number) => void }) { super(env.raf) }
  _executeListener (fn?: () => void): void {
    if (this._requestAnimationId !== -1) this.env.cancel(this._requestAnimationId)
    this._requestAnimationId = this.raf(() => {
      this._ctx.clearRect()
      fn?.()
      this._listener()
    })
  }
}

describe('the klinecharts race this module exists for (put-back: the emulations really lose the resize)', () => {
  it('9.8.12: a resize requested while a repaint is pending is dropped; the canvas keeps its old width', () => {
    const env = fakeEnv()
    const c = new Canvas9812(env.raf)
    c._executeListener() // a repaint is queued (a drawing changed)
    c.resize(120) // the pane changes size in the same frame
    env.flush()
    expect(c._width).toBe(100)
  })

  it('9.7.2: a repaint requested after a resize cancels it; the canvas keeps its old width', () => {
    const env = fakeEnv()
    const c = new Canvas972(env)
    c.resize(120)
    c._executeListener()
    env.flush()
    expect(c._width).toBe(100)
  })
})

describe('createFrameLoop', () => {
  it('adopted, neither version loses a resize, in either order', () => {
    const env = fakeEnv()
    const loop = createFrameLoop(env)
    const a = new Canvas9812(env.raf)
    const b = new Canvas972(env)
    expect(loop.adopt([a, b])).toBe(2)
    a._executeListener()
    a.resize(120)
    b.resize(130)
    b._executeListener()
    env.flush()
    expect([a._width, b._width]).toEqual([120, 130])
    expect([a.paints, b.paints]).toEqual([['w120'], ['w130']])
  })

  it('every dirty layer paints in ONE frame callback, once each, however often it asked', () => {
    const env = fakeEnv()
    const loop = createFrameLoop(env)
    const layers = [0, 1, 2, 3].map(() => new Canvas9812(env.raf))
    loop.adopt(layers)
    for (let i = 0; i < 5; i++) for (const l of layers) l._executeListener()
    expect(env.queued()).toBe(1)
    expect(env.flush()).toBe(1)
    expect(layers.map(l => l.paints.length)).toEqual([1, 1, 1, 1])
    expect(env.queued()).toBe(0)
  })

  it('motion runs first: what a clock callback moves is painted in that same frame', () => {
    const env = fakeEnv()
    const loop = createFrameLoop(env)
    const log: string[] = []
    const layer = new Canvas9812(env.raf, log)
    loop.adopt([layer])
    loop.clock.raf(() => {
      log.push('motion')
      layer._width = 222
      layer._executeListener() // the chart moved: its layer asks to repaint
    })
    expect(env.flush()).toBe(1)
    expect(log).toEqual(['motion', 'paint:222'])
    expect(env.queued()).toBe(0) // no extra frame for a layer already painted this frame
  })

  it('a tween re-arming itself runs next frame; a layer asking again while painting goes to the next frame (no loop)', () => {
    const env = fakeEnv()
    const loop = createFrameLoop(env)
    const layer = new Canvas9812(env.raf)
    let ticks = 0
    const tick = (): void => { ticks++; if (ticks < 3) loop.clock.raf(tick) }
    loop.clock.raf(tick)
    let again = 2
    layer._listener = () => { layer.paints.push('p'); if (again-- > 0) layer._executeListener() }
    loop.adopt([layer])
    layer._executeListener()
    env.flush()
    expect([ticks, layer.paints.length]).toEqual([1, 1])
    env.flush()
    env.flush()
    expect([ticks, layer.paints.length]).toEqual([3, 3])
    env.flush()
    expect(env.queued()).toBe(0)
  })

  it('clock.cancel stops a pending callback, including one cancelled by another callback in the same frame', () => {
    const env = fakeEnv()
    const loop = createFrameLoop(env)
    const ran: string[] = []
    const h1 = loop.clock.raf(() => { ran.push('a') })
    loop.clock.cancel(h1)
    let h3 = 0
    loop.clock.raf(() => { ran.push('b'); loop.clock.cancel(h3) })
    h3 = loop.clock.raf(() => { ran.push('c') })
    env.flush()
    expect(ran).toEqual(['b'])
  })

  it('a layer whose paint throws is reported, the other layers still paint, and it repaints next time', () => {
    const env = fakeEnv()
    const loop = createFrameLoop(env)
    const bad = new Canvas9812(env.raf)
    const good = new Canvas9812(env.raf)
    let throwOnce = true
    bad._listener = () => { if (throwOnce) { throwOnce = false; throw new Error('draw failed') } bad.paints.push('ok') }
    loop.adopt([bad, good])
    bad._executeListener()
    good._executeListener()
    env.flush()
    expect(env.errors.length).toBe(1)
    expect(good.paints.length).toBe(1)
    bad._executeListener()
    env.flush()
    expect(bad.paints).toEqual(['ok'])
  })

  it('adopt ignores anything that is not a klinecharts canvas and is idempotent; dispose hands the layers back', () => {
    const env = fakeEnv()
    const loop = createFrameLoop(env)
    const layer = new Canvas9812(env.raf)
    expect(isKlineCanvas({})).toBe(false)
    expect(loop.adopt([null, undefined, {}, layer, layer])).toBe(1)
    expect(Object.prototype.hasOwnProperty.call(layer, '_executeListener')).toBe(true)
    layer._executeListener()
    loop.dispose()
    expect(env.queued()).toBe(0)
    expect(Object.prototype.hasOwnProperty.call(layer, '_executeListener')).toBe(false)
    layer._executeListener() // klinecharts' own scheduling again
    env.flush()
    expect(layer.paints.length).toBe(1)
  })
})

describe('createFrameLoop: removed panes', () => {
  it('forgets a layer whose element left the document (a removed pane) on the next adopt pass', () => {
    const env = fakeEnv()
    const loop = createFrameLoop(env)
    const gone = Object.assign(new Canvas9812(env.raf), { _element: { isConnected: true } })
    const kept = Object.assign(new Canvas9812(env.raf), { _element: { isConnected: true } })
    loop.adopt([gone, kept])
    gone._executeListener()
    gone._element.isConnected = false
    loop.adopt([kept])
    env.flush()
    expect(gone.paints).toEqual([]) // its queued repaint was dropped with it
    loop.dispose()
    expect(Object.prototype.hasOwnProperty.call(kept, '_executeListener')).toBe(false)
  })
})

describe('collectCanvases', () => {
  it('walks every pane (main and y-axis widgets) and the x-axis pane, and tolerates missing pieces', () => {
    const w = (tag: string): { _mainCanvas: string, _overlayCanvas: string } => ({ _mainCanvas: `${tag}:main`, _overlayCanvas: `${tag}:overlay` })
    const candle = { getMainWidget: () => w('candle'), getYAxisWidget: () => w('candle-y') }
    const xAxis = { getMainWidget: () => w('x'), getYAxisWidget: () => null }
    const chart = { getAllDrawPanes: () => [candle, xAxis], getXAxisPane: () => xAxis }
    expect(collectCanvases(chart)).toEqual(['candle:main', 'candle:overlay', 'candle-y:main', 'candle-y:overlay', 'x:main', 'x:overlay'])
    expect(collectCanvases(null)).toEqual([])
    expect(collectCanvases({ getAllDrawPanes: () => { throw new Error('gone') } })).toEqual([])
  })
})
