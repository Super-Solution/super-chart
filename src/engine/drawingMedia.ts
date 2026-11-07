import type { DrawingBounds } from './drawings'

/** Local, self-contained raster resources only. No remote URL or SVG is decoded. */
export const DRAWING_IMAGE_LIMITS = Object.freeze({ encodedCharacters: 512 * 1024, dimension: 4096, pixels: 4 * 1024 * 1024, cachedImages: 32, cachedPixels: 16 * 1024 * 1024 })
interface Raster { mime: string, bytes: Uint8Array, width: number, height: number }
const fail = (): never => { throw new TypeError('Drawing images must be bounded static PNG, JPEG or WebP rasters') }
function dimensions (width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > DRAWING_IMAGE_LIMITS.dimension || height > DRAWING_IMAGE_LIMITS.dimension || width * height > DRAWING_IMAGE_LIMITS.pixels) throw new RangeError('Drawing image exceeds its decoded dimension or pixel limit')
}
function header (bytes: Uint8Array, mime: string): { width: number, height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (offset: number, length: number): string => String.fromCharCode(...bytes.subarray(offset, offset + length))
  let width = 0, height = 0
  if (mime === 'image/png') {
    if (bytes.length < 33 || bytes[0] !== 137 || text(1, 7) !== 'PNG\r\n\x1a\n' || view.getUint32(8) !== 13 || text(12, 4) !== 'IHDR') fail()
    width = view.getUint32(16); height = view.getUint32(20)
    let at = 8, ended = false, headers = 0
    while (at + 12 <= bytes.length) {
      const size = view.getUint32(at), kind = text(at + 4, 4)
      if (size > bytes.length - at - 12 || kind === 'acTL') fail()
      if (kind === 'IHDR' && ++headers !== 1) fail()
      at += size + 12
      if (kind === 'IEND') { ended = size === 0 && at === bytes.length; break }
    }
    if (!ended) fail()
  } else if (mime === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) fail()
    let at = 2, headers = 0
    while (at < bytes.length) {
      if (bytes[at++] !== 255) fail()
      while (bytes[at] === 255) at++
      const marker = bytes[at++]
      if (marker === 218 || marker === 217) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (at + 2 > bytes.length) fail()
      const size = view.getUint16(at)
      if (size < 2 || size > bytes.length - at) fail()
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (![192, 193, 194].includes(marker) || ++headers !== 1) fail()
        if (size < 8) fail()
        height = view.getUint16(at + 3); width = view.getUint16(at + 5)
        dimensions(width, height)
      }
      at += size
    }
  } else if (mime === 'image/webp') {
    if (bytes.length < 20 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WEBP' || view.getUint32(4, true) !== bytes.length - 8) fail()
    let at = 12, canvasWidth = 0, canvasHeight = 0, streams = 0
    while (at + 8 <= bytes.length) {
      const kind = text(at, 4), size = view.getUint32(at + 4, true), start = at + 8
      if (size > bytes.length - start || kind === 'ANIM' || kind === 'ANMF') fail()
      if (kind === 'VP8X') {
        if (size !== 10 || canvasWidth !== 0 || (bytes[start] & 2) !== 0) fail()
        canvasWidth = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16)
        canvasHeight = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16)
        dimensions(canvasWidth, canvasHeight)
      } else if (kind === 'VP8 ') {
        if (++streams !== 1 || size < 10 || (bytes[start] & 1) !== 0 || text(start + 3, 3) !== '\x9d\x01\x2a') fail()
        width = view.getUint16(start + 6, true) & 0x3fff; height = view.getUint16(start + 8, true) & 0x3fff
        dimensions(width, height)
      } else if (kind === 'VP8L') {
        if (++streams !== 1 || size < 5 || bytes[start] !== 47) fail()
        const packed = view.getUint32(start + 1, true)
        width = 1 + (packed & 0x3fff); height = 1 + ((packed >>> 14) & 0x3fff)
        dimensions(width, height)
      }
      at = start + size + (size % 2)
    }
    if (at !== bytes.length || streams !== 1 || (canvasWidth !== 0 && (canvasWidth !== width || canvasHeight !== height))) fail()
  } else fail()
  dimensions(width, height)
  return { width, height }
}
function raster (source: unknown): Raster {
  if (typeof source !== 'string' || source.length > DRAWING_IMAGE_LIMITS.encodedCharacters) throw new RangeError('Drawing image exceeds its encoded size limit')
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source)
  if (match === null || match[2].length % 4 !== 0) return fail()
  let raw: string
  try { raw = atob(match[2]) } catch { return fail() }
  const bytes = Uint8Array.from(raw, character => character.charCodeAt(0))
  return { mime: match[1], bytes, ...header(bytes, match[1]) }
}
/** Validates metadata before the browser decoder can allocate a large bitmap. */
export function validateDrawingImage (value: unknown): string { raster(value); return value as string }

/** Encode a local file. Decode with DrawingImageRenderer.prepare before committing it. */
export async function createDrawingImage (blob: Blob, signal?: AbortSignal): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size <= 0 || blob.size > Math.floor((DRAWING_IMAGE_LIMITS.encodedCharacters - 32) * 3 / 4)) fail()
  signal?.throwIfAborted()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  signal?.throwIfAborted(); header(bytes, blob.type)
  let binary = ''
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192))
  return validateDrawingImage(`data:${blob.type};base64,${btoa(binary)}`)
}

interface ImageEntry { promise: Promise<void>, bitmap: ImageBitmap | null, error: Error | null, pixels: number, invalidations: Set<() => void> }
/** One instance per chart. All pixels originate in local raster bytes, keeping export untainted. */
export class DrawingImageRenderer {
  private readonly entries = new Map<string, ImageEntry>()
  private readonly held = new Map<string, number>()
  private pixels = 0
  private disposed = false
  /** Optional owner-window decoder is useful when the chart lives in another document. */
  constructor (private readonly decode: (blob: Blob) => Promise<ImageBitmap> = async blob => await createImageBitmap(blob)) {}

  // Return the same cached decode promise to every caller; an async wrapper would change its identity.
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  prepare (source: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Drawing image renderer is disposed'))
    const previous = this.entries.get(source)
    if (previous !== undefined) return previous.promise
    let input: Raster
    try { input = raster(source) } catch (error) { return Promise.reject(error) }
    const pixels = input.width * input.height
    if (this.entries.size >= DRAWING_IMAGE_LIMITS.cachedImages || this.pixels + pixels > DRAWING_IMAGE_LIMITS.cachedPixels) return Promise.reject(new RangeError('Drawing image cache is full; release unused images before adding another'))
    const entry: ImageEntry = { promise: Promise.resolve(), bitmap: null, error: null, pixels, invalidations: new Set() }
    this.entries.set(source, entry); this.pixels += pixels
    entry.promise = Promise.resolve().then(async () => {
      if (this.disposed || this.entries.get(source) !== entry) throw new Error('Drawing image decode was cancelled')
      const bitmap = await this.decode(new Blob([input.bytes], { type: input.mime }))
      if (this.disposed || this.entries.get(source) !== entry) { bitmap.close(); throw new Error('Drawing image decode was cancelled') }
      try {
        dimensions(bitmap.width, bitmap.height)
        if (bitmap.width * bitmap.height !== pixels) throw new RangeError('Decoded image dimensions disagree with the raster header')
        entry.bitmap = bitmap
      } catch (error) { bitmap.close(); throw error }
    }).catch(error => {
      entry.error = error instanceof Error ? error : new Error(String(error)); throw entry.error
    }).finally(() => {
      const callbacks = [...entry.invalidations]; entry.invalidations.clear()
      if (!this.disposed && this.entries.get(source) === entry) for (const callback of callbacks) { try { callback() } catch { /* Consumer invalidation must not affect resource ownership. */ } }
    })
    // Painting may initiate decoding without a consumer awaiting prepare().
    void entry.promise.catch(() => {})
    return entry.promise
  }

  getError (source: string): Error | null { return this.entries.get(source)?.error ?? null }
  paint (context: CanvasRenderingContext2D, source: string, bounds: DrawingBounds, clip: DrawingBounds, onInvalidate?: () => void): 'ready' | 'loading' | 'unavailable' {
    if (this.disposed || ![bounds.left, bounds.top, bounds.right, bounds.bottom, clip.left, clip.top, clip.right, clip.bottom].every(Number.isFinite) || bounds.right <= bounds.left || bounds.bottom <= bounds.top || clip.right <= clip.left || clip.bottom <= clip.top) return 'unavailable'
    if (!this.entries.has(source)) void this.prepare(source).catch(() => {})
    const entry = this.entries.get(source)
    if (entry === undefined || entry.error !== null) return 'unavailable'
    if (entry.bitmap === null) { if (onInvalidate !== undefined) entry.invalidations.add(onInvalidate); return 'loading' }
    context.save()
    try {
      context.beginPath(); context.rect(clip.left, clip.top, clip.right - clip.left, clip.bottom - clip.top); context.clip()
      context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'
      context.drawImage(entry.bitmap, bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
    } finally { context.restore() }
    return 'ready'
  }

  /** Source data stays in drawing history; a released bitmap can be decoded again on undo. */
  retain (sources: ReadonlySet<string>): void {
    for (const [source, entry] of this.entries) {
      // A local file is prepared before its drawing exists. Its await continuation
      // can commit before the next frame; collection must not cancel that decode.
      const pending = entry.bitmap === null && entry.error === null
      if (!sources.has(source) && !this.held.has(source) && !pending) this.release(source)
    }
  }

  /** Keep validated resources across an asynchronous market/document restore. */
  hold (sources: ReadonlySet<string>): () => void {
    if (this.disposed) throw new Error('Drawing image renderer is disposed')
    if (sources.size > DRAWING_IMAGE_LIMITS.cachedImages) throw new RangeError('Too many held drawing images')
    const keys = [...sources]
    for (const source of keys) validateDrawingImage(source)
    if (new Set([...this.held.keys(), ...keys]).size > DRAWING_IMAGE_LIMITS.cachedImages) throw new RangeError('Too many held drawing images')
    for (const source of keys) this.held.set(source, (this.held.get(source) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      for (const source of keys) {
        const count = this.held.get(source) ?? 0
        if (count <= 1) this.held.delete(source); else this.held.set(source, count - 1)
      }
    }
  }

  has (source: string): boolean { return this.entries.has(source) }
  release (source: string): void {
    // A cancelled file-picker can share bytes with an in-flight document restore.
    // One caller must not invalidate another caller's explicit resource lease.
    if (this.held.has(source)) return
    const entry = this.entries.get(source)
    if (entry === undefined) return
    this.entries.delete(source); this.pixels -= entry.pixels; entry.invalidations.clear(); entry.bitmap?.close()
  }

  dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.held.clear()
    for (const source of this.entries.keys()) this.release(source)
  }
}
