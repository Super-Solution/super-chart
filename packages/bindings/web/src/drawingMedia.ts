import { DRAWING_IMAGE_LIMITS, dimensions, fail, header, raster, validateDrawingImage, type DrawingBounds, type Raster } from '@supersolutions/super-chart-core'

export { DRAWING_IMAGE_LIMITS, validateDrawingImage }

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
