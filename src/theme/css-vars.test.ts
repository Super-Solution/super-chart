import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// Every `var(--klinecharts-pro-*)` the chrome reads must be a custom property
// the chrome defines. An undefined one is invalid at computed-value time, so
// the property silently falls back to inheritance (SC-066: the drawing-rail
// flyout labels read `var(---klinecharts-pro-text-color)`, three dashes, and
// ignored both the default and a host's text colour).

const SRC = fileURLToPath(new URL('..', import.meta.url))
const ROOT_LESS = join(SRC, 'index.less')

function sourceFiles (dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path))
    } else if (/\.(less|css|tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

/** Custom properties declared as `--name:` in a stylesheet. */
function declaredVars (css: string): Set<string> {
  return new Set([...css.matchAll(/(--klinecharts-pro-[a-z0-9-]+)\s*:/g)].map(m => m[1]))
}

/** Every `var(--x)` read, with whether it carries a fallback (`var(--x, …)`). */
function referencedVars (text: string): Array<{ name: string, fallback: boolean }> {
  return [...text.matchAll(/var\(\s*(-{2,}[A-Za-z0-9_-]+)\s*([,)])/g)].map(m => ({ name: m[1], fallback: m[2] === ',' }))
}

describe('chrome CSS custom properties', () => {
  const declared = declaredVars(readFileSync(ROOT_LESS, 'utf8'))
  const files = sourceFiles(SRC)

  it('scans the chrome sources', () => {
    expect(files.some(f => f.endsWith(join('component', 'list', 'index.less')))).toBe(true)
    expect(declared.has('--klinecharts-pro-text-color')).toBe(true)
  })

  it('never reads a custom property with three dashes', () => {
    const bad = files.flatMap(f => referencedVars(readFileSync(f, 'utf8'))
      .filter(r => r.name.startsWith('---'))
      .map(r => `${relative(SRC, f)}: ${r.name}`))
    expect(bad).toEqual([])
  })

  it('reads only --klinecharts-pro-* properties that src/index.less defines', () => {
    const missing = files.flatMap(f => referencedVars(readFileSync(f, 'utf8'))
      .filter(r => r.name.startsWith('--klinecharts-pro-') && !r.fallback && !declared.has(r.name))
      .map(r => `${relative(SRC, f)}: ${r.name}`))
    expect(missing).toEqual([])
  })

  it('the helpers see what they claim to', () => {
    expect(referencedVars('a{color:var(---x);b:var(--y, red);c:var( --z )}')).toEqual([
      { name: '---x', fallback: false }, { name: '--y', fallback: true }, { name: '--z', fallback: false }
    ])
    expect([...declaredVars('.r{--klinecharts-pro-a: 1; --other: 2; --klinecharts-pro-b:3}')]).toEqual(['--klinecharts-pro-a', '--klinecharts-pro-b'])
  })
})
