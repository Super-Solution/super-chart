/** Pure reversible value/coordinate scale shared by renderers and drawing tools. */
export type PriceScaleMode = 'linear' | 'log' | 'percentage'
export interface PriceScaleOptions {
  mode?: PriceScaleMode
  reversed?: boolean
  /** Raw price bounds, not log or percentage values. */
  range?: readonly [number, number]
}
export interface PriceScale {
  min: number
  max: number
  ticks: number[]
  y: (price: number) => number
  value: (y: number) => number
  label: (price: number, precision: number) => string
}

export function validatePriceScale (options: PriceScaleOptions): void {
  if (options.mode !== undefined && !['linear', 'log', 'percentage'].includes(options.mode)) throw new RangeError('Unknown price scale')
  if (options.range !== undefined) {
    const [min, max] = options.range
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max || (options.mode === 'log' && min <= 0)) throw new RangeError('Invalid price scale range')
  }
}

export function createPriceScale (values: readonly number[], top: number, bottom: number, options: PriceScaleOptions = {}, base = 1): PriceScale {
  validatePriceScale(options)
  const mode = options.mode ?? 'linear'
  if (mode === 'percentage' && (!Number.isFinite(base) || base === 0)) throw new RangeError('Percentage scale requires a finite nonzero reference price')
  const reference = Math.abs(base)
  const transform = mode === 'log' ? (v: number) => Math.log(v)
    : mode === 'percentage' ? (v: number) => (v - base) / reference * 100 : (v: number) => v
  const inverse = mode === 'log' ? (v: number) => Math.exp(v)
    : mode === 'percentage' ? (v: number) => base + v / 100 * reference : (v: number) => v
  let min = Infinity, max = -Infinity
  for (const value of values) {
    if (!Number.isFinite(value) || (mode === 'log' && value <= 0)) continue
    const v = transform(value)
    min = Math.min(min, v); max = Math.max(max, v)
  }
  if (options.range !== undefined) { min = transform(options.range[0]); max = transform(options.range[1]) }
  else {
    if (!Number.isFinite(min)) { min = 0; max = 1 }
    const pad = max > min ? (max - min) * 0.08 : mode === 'log' ? Math.log(1.05) : min === 0 ? 0.01 : Math.max(Number.MIN_VALUE, Math.abs(min) * 0.05)
    min -= pad; max += pad
  }
  const span = max - min, height = Math.max(1, bottom - top)
  const y = (price: number): number => {
    const fraction = (transform(price) - min) / span
    return options.reversed === true ? top + fraction * height : bottom - fraction * height
  }
  const value = (pixel: number): number => inverse(min + (options.reversed === true ? pixel - top : bottom - pixel) / height * span)
  const rawStep = span / 4, magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const step = ([1, 2, 5, 10].find(n => n * magnitude >= rawStep) ?? 10) * magnitude
  const ticks: number[] = []
  if (Number.isFinite(step) && step > 0) {
    const start = Math.ceil(min / step) * step
    // Count bound also prevents floating-point underflow from trapping a render loop.
    for (let i = 0; i < 12 && start + i * step <= max; i++) ticks.push(inverse(start + i * step))
  }
  return {
    min: inverse(min),
    max: inverse(max),
    ticks,
    y,
    value,
    label: (price, precision) => mode === 'percentage' ? `${transform(price).toFixed(2)}%` : price.toFixed(precision)
  }
}
