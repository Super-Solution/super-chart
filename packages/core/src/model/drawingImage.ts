/** Pure, local raster resources only: no remote URL or SVG is decoded. Shared by the renderer-free drawing model and the Web image renderer. */
export const DRAWING_IMAGE_LIMITS = Object.freeze({ encodedCharacters: 512 * 1024, dimension: 4096, pixels: 4 * 1024 * 1024, cachedImages: 32, cachedPixels: 16 * 1024 * 1024 })
export interface Raster { mime: string, bytes: Uint8Array, width: number, height: number }
export const fail = (): never => { throw new TypeError('Drawing images must be bounded static PNG, JPEG or WebP rasters') }
export function dimensions (width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > DRAWING_IMAGE_LIMITS.dimension || height > DRAWING_IMAGE_LIMITS.dimension || width * height > DRAWING_IMAGE_LIMITS.pixels) throw new RangeError('Drawing image exceeds its decoded dimension or pixel limit')
}
export function header (bytes: Uint8Array, mime: string): { width: number, height: number } {
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
export function raster (source: unknown): Raster {
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
