/**
 * The chrome stylesheet as the build compiles it, for the token tests
 * (src/theme/*.test.ts). Node only; not part of the package entries.
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

interface Less { render: (input: string, options: { filename: string }) => Promise<{ css: string }> }

const ROOT_LESS = fileURLToPath(new URL('../index.less', import.meta.url))

/** src/index.less compiled with the build's less (plain-CSS imports are left as @import). */
export async function compileChromeCss (): Promise<string> {
  const less = createRequire(import.meta.url)('less') as Less
  const { css } = await less.render(readFileSync(ROOT_LESS, 'utf8'), { filename: ROOT_LESS })
  return css
}

/** The declarations of the first rule whose selector is exactly `selector`. */
export function ruleDeclarations (css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)
  if (rule === null) {
    throw new Error(`no rule for ${selector}`)
  }
  const out: Record<string, string> = {}
  for (const decl of rule[1].split(';')) {
    const i = decl.indexOf(':')
    if (i > 0) {
      out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim()
    }
  }
  return out
}

/** The root's custom properties per theme: light is the root rule, dark adds its overrides. */
export function themeVars (css: string): { light: Record<string, string>, dark: Record<string, string> } {
  const pick = (d: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(d).filter(([k]) => k.startsWith('--')))
  const light = pick(ruleDeclarations(css, '.klinecharts-pro'))
  const dark = { ...light, ...pick(ruleDeclarations(css, '.klinecharts-pro[data-theme="dark"]')) }
  return { light, dark }
}

/** Resolve var(--x) references against a set of custom properties (no fallbacks needed here). */
export function resolveVars (value: string, vars: Record<string, string>, depth = 0): string {
  if (depth > 10) {
    throw new Error(`var() cycle in ${value}`)
  }
  return value.replace(/var\((--[a-z0-9-]+)\)/gi, (_, name: string) => {
    const v = vars[name]
    if (v === undefined) {
      throw new Error(`undefined ${name}`)
    }
    return resolveVars(v, vars, depth + 1)
  })
}
