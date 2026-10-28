import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Imports are hoisted before any other module code runs, so this import runs
// before the Image stub below is installed by beforeEach() — safe only
// because imageTool.ts calls `new Image()` lazily inside resolveImg/startLoad,
// never at module load, and no test calls createPointFigures before its own
// beforeEach has run (vitest guarantees that ordering per test).
import { image, backoffFor, shouldRetry, RETRY_BACKOFF_MS, MAX_ATTEMPTS } from './imageTool'

// A controllable stand-in for the DOM Image constructor (vitest runs these
// tests in a node environment with no DOM). Each instance is recorded so a
// test can drive its onload/onerror by hand instead of waiting on a real
// network load.
class FakeImage {
  static created: FakeImage[] = []
  crossOrigin = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private _src = ''
  get src (): string { return this._src }
  set src (v: string) { this._src = v; FakeImage.created.push(this) }
}

beforeEach(() => {
  FakeImage.created = []
  ;(globalThis as unknown as { Image: unknown }).Image = FakeImage
  vi.useFakeTimers()
  vi.setSystemTime(0)
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { Image?: unknown }).Image
})

function params (extendData: unknown, chart: unknown): any {
  return {
    overlay: { extendData },
    coordinates: [{ x: 10, y: 10 }, { x: 60, y: 40 }],
    bounding: { width: 800, height: 400, left: 0, top: 0, right: 800, bottom: 400 },
    barSpace: { bar: 6, halfBar: 3, gapBar: 4, halfGapBar: 2 },
    precision: { price: 2, volume: 0 },
    thousandsSeparator: ',',
    decimalFoldThreshold: 3,
    dateTimeFormat: new Intl.DateTimeFormat('en-US'),
    defaultStyles: {},
    chart,
    xAxis: null,
    yAxis: null
  }
}

function fakeChart (): { resize: ReturnType<typeof vi.fn> } {
  return { resize: vi.fn() }
}

const create = (p: unknown): any[] => ([] as any[]).concat(image.createPointFigures?.(p as never) ?? [])
const attrsOf = (figs: unknown): { state: string, img: unknown } => (figs as any[])[0].attrs
/** Fires a FakeImage's onload/onerror without a non-null assertion (both are always set by startLoad before this is called). */
const settle = (img: FakeImage, kind: 'onload' | 'onerror'): void => { img[kind]?.() }

describe('backoffFor / shouldRetry (pure retry policy)', () => {
  it('grows the backoff per attempt, then repeats the last value', () => {
    expect(backoffFor(1)).toBe(RETRY_BACKOFF_MS[0])
    expect(backoffFor(2)).toBe(RETRY_BACKOFF_MS[1])
    expect(backoffFor(3)).toBe(RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1])
    expect(backoffFor(99)).toBe(RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1])
  })

  it('retries only a failed entry, only after its backoff, and never past MAX_ATTEMPTS', () => {
    expect(shouldRetry({ state: 'loading', attempts: 1, failedAt: 0 }, 999_999)).toBe(false)
    expect(shouldRetry({ state: 'ok', attempts: 1, failedAt: 0 }, 999_999)).toBe(false)
    expect(shouldRetry({ state: 'error', attempts: 1, failedAt: 1000 }, 1000 + backoffFor(1) - 1)).toBe(false)
    expect(shouldRetry({ state: 'error', attempts: 1, failedAt: 1000 }, 1000 + backoffFor(1))).toBe(true)
    expect(shouldRetry({ state: 'error', attempts: MAX_ATTEMPTS, failedAt: 0 }, Number.MAX_SAFE_INTEGER)).toBe(false)
  })
})

describe('image overlay: per-URL cache with bounded retries (SC-184)', () => {
  it('starts loading and reports state "loading" with no image yet', () => {
    const figs = create(params('https://example.com/a.png', fakeChart()))
    expect(attrsOf(figs)).toMatchObject({ state: 'loading', img: null })
    expect(FakeImage.created).toHaveLength(1)
    expect(FakeImage.created[0].crossOrigin).toBe('anonymous')
  })

  it('reports "ok" and draws the image once it loads, and redraws the waiting chart', () => {
    const chart = fakeChart()
    create(params('https://example.com/b.png', chart))
    settle(FakeImage.created[0], 'onload')
    expect(chart.resize).toHaveBeenCalledTimes(1)
    const figs = create(params('https://example.com/b.png', fakeChart()))
    expect(attrsOf(figs).state).toBe('ok')
    expect(attrsOf(figs).img).toBe(FakeImage.created[0])
  })

  it('reports "error" on a failed load (404, network failure, or a cross-origin load with no ACAO header)', () => {
    const chart = fakeChart()
    create(params('https://example.com/missing.png', chart))
    settle(FakeImage.created[0], 'onerror')
    expect(chart.resize).toHaveBeenCalledTimes(1)
    const figs = create(params('https://example.com/missing.png', fakeChart()))
    expect(attrsOf(figs).state).toBe('error')
  })

  it('retries a failed URL after its backoff, and stops after MAX_ATTEMPTS — never one request per repaint', () => {
    const url = 'https://example.com/flaky.png'
    create(params(url, fakeChart()))
    expect(FakeImage.created).toHaveLength(1)
    settle(FakeImage.created[0], 'onerror')
    // 100 repaints immediately after the failure: no new request until the backoff elapses.
    for (let i = 0; i < 100; i++) create(params(url, fakeChart()))
    expect(FakeImage.created).toHaveLength(1)
    vi.setSystemTime(backoffFor(1) + 1)
    create(params(url, fakeChart()))
    expect(FakeImage.created).toHaveLength(2)
    settle(FakeImage.created[1], 'onerror')
    vi.setSystemTime(backoffFor(1) + 1 + backoffFor(2) + 1)
    create(params(url, fakeChart()))
    expect(FakeImage.created).toHaveLength(3)
    settle(FakeImage.created[2], 'onerror')
    // 3 attempts made (MAX_ATTEMPTS): no further request, ever, even much later.
    vi.setSystemTime(Number.MAX_SAFE_INTEGER / 2)
    for (let i = 0; i < 100; i++) create(params(url, fakeChart()))
    expect(FakeImage.created).toHaveLength(3)
  })

  it('redraws every chart that asked for a still-loading URL, not only the first (SC-008: no single "the chart")', () => {
    const chartA = fakeChart()
    const chartB = fakeChart()
    create(params('https://example.com/shared.png', chartA))
    create(params('https://example.com/shared.png', chartB))
    expect(FakeImage.created).toHaveLength(1) // one request, two waiters
    settle(FakeImage.created[0], 'onload')
    expect(chartA.resize).toHaveBeenCalledTimes(1)
    expect(chartB.resize).toHaveBeenCalledTimes(1)
  })

  it('a chart that asks again after the URL has already settled is not queued (nothing to wait for)', () => {
    const chartA = fakeChart()
    create(params('https://example.com/settled.png', chartA))
    settle(FakeImage.created[0], 'onload')
    const chartB = fakeChart()
    create(params('https://example.com/settled.png', chartB))
    expect(chartB.resize).not.toHaveBeenCalled()
  })

  it('treats an empty or missing extendData as no image (never calls new Image())', () => {
    expect(attrsOf(create(params('', fakeChart()))).state).toBe('error')
    expect(attrsOf(create(params('   ', fakeChart()))).state).toBe('error')
    expect(attrsOf(create(params(undefined, fakeChart()))).state).toBe('error')
    expect(FakeImage.created).toHaveLength(0)
  })

  it('returns [] when the two placement points are not both there yet', () => {
    const p = params('https://example.com/x.png', fakeChart())
    expect(create({ ...p, coordinates: [{ x: 1, y: 1 }] })).toEqual([])
  })
})
