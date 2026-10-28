/**
 * The Solid DOM runtime the compiled JSX imports (vite.config.ts points
 * babel-preset-solid's `moduleName` here). It is `solid-js/web` with two
 * functions made safe to run at import time without a DOM, so the `.` entry
 * can be imported in Node, in SSR and in test runners without `document`:
 *
 * - `template`: Solid 1.6 builds every JSX template when its module loads
 *   (73 of them), with document.createElement. Here the node is built on the
 *   first `cloneNode`, the only way the compiled code uses a template.
 * - `delegateEvents`: the compiled modules call it at the top level, and its
 *   default argument reads `window.document`. Without a window it does nothing;
 *   nothing can be clicked there anyway.
 *
 * Rendering still needs a DOM: construct the chart in the browser (an effect).
 *
 * Part of SUPer-Chart (Apache-2.0).
 */

import { template as buildTemplate, delegateEvents as delegateDomEvents } from 'solid-js/web'

// The two local exports below deliberately shadow solid-js/web's: a module's own
// export wins over the same name from `export *` (ES modules define it so).
/* eslint-disable import/export */
export * from 'solid-js/web'

/** Solid's `template`, built on first use. */
export function template (html: string, count: number, isSVG?: boolean): Element {
  let node: Element | undefined
  const lazy = {
    cloneNode (deep?: boolean): Node {
      if (node === undefined) {
        node = buildTemplate(html, count, isSVG)
      }
      return node.cloneNode(deep)
    }
  }
  return lazy as unknown as Element
}

/** Solid's `delegateEvents`; a no-op where there is no window. */
export function delegateEvents (eventNames: string[], doc?: Document): void {
  if (doc === undefined && typeof window === 'undefined') {
    return
  }
  delegateDomEvents(eventNames, doc ?? window.document)
}
