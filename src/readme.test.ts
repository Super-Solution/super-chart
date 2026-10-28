import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { superscriptReference } from './superscript'

// README.md ships in the package and is what integrators and agents read first.
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

describe('README', () => {
  it('carries the SuperScript reference exactly as superscriptReference() returns it', () => {
    const block = /<!-- superscript-reference:start -->\n```text\n([\s\S]*?)\n```\n<!-- superscript-reference:end -->/.exec(readme)
    expect(block, 'the generated reference block is present').not.toBeNull()
    expect(block![1]).toBe(superscriptReference())
  })

  // With any klinecharts in the peer range, `.` fails to load in plain Node
  // (scripts/check-package.mjs, check "plain-node", pins that down). The README
  // once promised it was "safe ... in Node", and a Node tool trusting it crashes.
  it('does not promise that "." loads in plain Node, and sends Node tools to ./superscript', () => {
    for (const wrong of ['safe in server-rendered files and in Node', 'no longer needs a DOM (SSR, Node)', '`require()` loads a CommonJS build']) {
      expect(readme.includes(wrong), wrong).toBe(false)
    }
    expect(readme).toMatch(/Plain Node, without a bundler, cannot load `\.`/)
    expect(readme).toMatch(/Node tools \([^)]*\) use `@zzyzxlabs\/super-chart\/superscript`/)
    expect(readme, 'the CommonJS build is documented as a separate copy').toMatch(/separate copy of the engine/)
  })

  it('names no package, path or site that does not exist', () => {
    for (const wrong of ['@zzyzx/super-chart', 'dist/style.css', '@klinecharts/pro', 'klinecharts.com', 'docs:dev', 'new SuperChart("#']) {
      expect(readme.includes(wrong), wrong).toBe(false)
    }
  })
})
