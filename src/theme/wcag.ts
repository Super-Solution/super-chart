/**
 * WCAG 2 contrast for the token tests (src/theme/*.test.ts). Colours are
 * '#RGB', '#RRGGBB', 'rgb()/rgba()' or 'color-mix(in srgb, A p%, B)' with
 * the inputs in the same forms; translucent colours are composited over what
 * they sit on first. Not part of the package entries.
 */

export interface RGBA { r: number, g: number, b: number, a: number }

function splitTopLevel (text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(text.slice(start).trim())
  return parts
}

export function parse (color: string): RGBA {
  const c = color.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)
  if (hex !== null) {
    const h = hex[1].length === 3 ? hex[1].split('').map(x => x + x).join('') : hex[1]
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(c)
  if (fn !== null) {
    const n = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    return { r: n[0], g: n[1], b: n[2], a: n[3] ?? 1 }
  }
  const mix = /^color-mix\(\s*in srgb\s*,(.*)\)$/i.exec(c)
  if (mix !== null) {
    const [first, second] = splitTopLevel(mix[1])
    const m = /^(.*?)\s+([\d.]+)%$/.exec(first)
    if (m === null) throw new Error(`unsupported color-mix: ${color}`)
    const p = Number(m[2]) / 100
    const a = parse(m[1])
    const b = parse(second)
    // color-mix(in srgb) interpolates premultiplied channels.
    const alpha = a.a * p + b.a * (1 - p)
    const ch = (x: number, y: number): number => alpha === 0 ? 0 : (x * a.a * p + y * b.a * (1 - p)) / alpha
    return { r: ch(a.r, b.r), g: ch(a.g, b.g), b: ch(a.b, b.b), a: alpha }
  }
  throw new Error(`unsupported colour: ${color}`)
}

/** `top` painted over an opaque `bottom`. */
export function over (top: string | RGBA, bottom: string | RGBA): RGBA {
  const t = typeof top === 'string' ? parse(top) : top
  const b = typeof bottom === 'string' ? parse(bottom) : bottom
  const mix = (x: number, y: number): number => x * t.a + y * (1 - t.a)
  return { r: mix(t.r, b.r), g: mix(t.g, b.g), b: mix(t.b, b.b), a: 1 }
}

function luminance (c: RGBA): number {
  const lin = (v: number): number => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

/** Contrast of `fg` on `bg`; each is composited over `base` (default white) when translucent. */
export function contrast (fg: string, bg: string, base = '#FFFFFF'): number {
  const b = over(bg, base)
  const f = over(fg, b)
  const [hi, lo] = [luminance(f), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
