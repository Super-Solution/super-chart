/**
 * Small object helpers, so the bundle does not carry lodash for two calls.
 *
 * They are deliberately not klinecharts' `utils.clone`: that comes from the
 * host's klinecharts at runtime, and in 9.1.1 it returned plain objects by
 * reference. `getStyles()` returns klinecharts' live styles object, so a
 * "clone" that is really a reference would make "Restore default" restore
 * nothing.
 *
 * Part of SUPer-Chart (Apache-2.0).
 */

function isPlainObject (value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Deep copy of arrays and plain objects. Everything else (functions, class
 * instances, dates, DOM nodes) is kept by reference, as lodash `cloneDeep`
 * does for values it cannot copy. `structuredClone` is not used because style
 * callbacks can be functions, and it throws on those.
 */
export function deepClone<T> (value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => deepClone(item)) as unknown as T
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      out[key] = deepClone(value[key])
    }
    return out as T
  }
  return value
}

/**
 * Set `value` at a dotted path (`'candle.priceMark.last.show'`), creating
 * plain objects for missing or non-object levels. Every settings key is a
 * dotted path; brackets are not supported (klinecharts' `formatValue` does
 * not read them either). Returns `target`.
 */
/** The value at a dotted path ('grid.show'), or undefined when any step is missing. */
export function getPath (source: unknown, path: string): unknown {
  let node = source
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') {
      return undefined
    }
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

export function setPath<T extends object> (target: T, path: string, value: unknown): T {
  const keys = path.split('.')
  let node = target as Record<string, unknown>
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    const next = node[key]
    if (next === null || typeof next !== 'object') {
      node[key] = {}
    }
    node = node[key] as Record<string, unknown>
  }
  node[keys[keys.length - 1]] = value
  return target
}

/**
 * Deep merge of style layers into a new object; later layers win. Plain
 * objects merge key by key; arrays and every other value replace what is
 * there (klinecharts 9.1 replaces arrays on merge, so a layer always carries
 * whole arrays); `undefined` is skipped. The inputs are not changed.
 */
export function mergeDeep<T extends object> (...layers: Array<T | null | undefined>): T {
  const out: Record<string, unknown> = {}
  for (const layer of layers) {
    if (!isPlainObject(layer)) {
      continue
    }
    for (const key of Object.keys(layer)) {
      const value = layer[key]
      if (value === undefined) {
        continue
      }
      const current = out[key]
      out[key] = isPlainObject(value) && isPlainObject(current)
        ? mergeDeep(current, value)
        : deepClone(value)
    }
  }
  return out as T
}
