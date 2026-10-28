/**
 * The chart watermark.
 *
 * There is no default watermark (owner decision): a bare chart shows none. The
 * `.klinecharts-pro-watermark` element is still created on every chart, empty,
 * because hosts style it (Broker paints its own logo as a CSS background on it).
 *
 * Part of SUPer-Chart (Apache-2.0).
 */

/** Text, a Node, or a factory the chart calls once to get its own Node. */
export type WatermarkOption = string | Node | (() => Node)

export const WATERMARK_CLASS = 'klinecharts-pro-watermark'

/**
 * The watermark element for one chart.
 *
 * - A string is shown as text (textContent, never parsed as HTML).
 * - A detached Node is appended as it is, so a host that keeps a reference to
 *   it can still change it. A Node that is already attached anywhere (another
 *   chart, the page) is deep-cloned instead, because appending would move it
 *   and leave its owner without it; the clone has no event listeners.
 * - A factory is called once for this chart.
 */
export function createWatermark (option: WatermarkOption | null | undefined, doc: Document = document): HTMLDivElement {
  const element = doc.createElement('div')
  element.className = WATERMARK_CLASS
  if (option === null || option === undefined) {
    return element
  }
  if (typeof option === 'string') {
    element.textContent = option.trim()
    return element
  }
  const node = typeof option === 'function' ? option() : option
  element.appendChild(node.parentNode === null ? node : node.cloneNode(true))
  return element
}
