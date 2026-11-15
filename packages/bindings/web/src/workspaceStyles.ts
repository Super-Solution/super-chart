/**
 * The workspace chrome's stylesheet, scoped under `.sc-ws` and driven by the
 * --sc-* custom properties that tokens.ts sets on the root. Hover, focus and
 * pressed states need real CSS, so it is adopted as a constructable sheet
 * (allowed under a strict style-src CSP) on the root node that holds the
 * workspace, document or shadow root, and released with the last workspace.
 */
const CSS = `
.sc-ws { font: 400 13px/1.35 var(--sc-font); color: var(--sc-ink); background: var(--sc-surface); }
.sc-ws [hidden] { display: none !important; }
.sc-ws :focus-visible { outline: 2px solid var(--sc-violet-strong); outline-offset: 2px; }
.sc-ws .sc-row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; min-height: 40px; padding: 4px 8px; border-bottom: 1px solid var(--sc-line); box-sizing: border-box; }
.sc-ws .sc-row.sc-foot { border-bottom: 0; border-top: 1px solid var(--sc-line); }
.sc-ws .sc-sep { width: 1px; height: 18px; margin: 0 6px; background: var(--sc-line); flex: none; }
.sc-ws .sc-btn { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--sc-ink); font: 500 13px/1 var(--sc-font); white-space: nowrap; cursor: pointer; transition: background-color 160ms cubic-bezier(0.2, 0.8, 0.2, 1), color 160ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.sc-ws .sc-btn:hover { background: var(--sc-surface-sunken); }
.sc-ws .sc-btn[aria-pressed="true"] { background: var(--sc-violet-tint); color: var(--sc-violet-strong); }
.sc-ws .sc-btn:disabled { background: transparent; color: var(--sc-ink-muted); opacity: 0.55; cursor: default; }
.sc-ws .sc-btn.sc-sym { font-size: 14px; font-weight: 600; }
.sc-ws .sc-btn.sc-x { width: 22px; height: 22px; padding: 0; justify-content: center; color: var(--sc-ink-muted); font-size: 15px; }
.sc-ws .sc-btn.sc-x:hover { color: var(--sc-ink); background: var(--sc-surface); }
.sc-ws .sc-field { display: inline-flex; align-items: center; gap: 6px; padding-left: 4px; }
.sc-ws .sc-label { font-size: 12px; color: var(--sc-ink-muted); }
.sc-ws .sc-select, .sc-ws .sc-input { height: 30px; max-width: 180px; padding: 0 8px; border: 1px solid var(--sc-line); border-radius: 6px; background: var(--sc-surface); color: var(--sc-ink); font: 500 13px var(--sc-font); box-sizing: border-box; transition: border-color 160ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.sc-ws .sc-select:hover, .sc-ws .sc-input:hover { border-color: var(--sc-line-strong); }
.sc-ws .sc-chip { position: relative; display: inline-flex; align-items: center; gap: 2px; height: 28px; padding: 0 3px 0 10px; border-radius: 6px; background: var(--sc-surface-sunken); }
.sc-ws .sc-chip summary { list-style: none; cursor: pointer; font: 500 12px var(--sc-mono); color: var(--sc-ink); white-space: nowrap; }
.sc-ws .sc-chip summary::-webkit-details-marker { display: none; }
.sc-ws .sc-pop { position: absolute; z-index: 5; top: calc(100% + 6px); left: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 240px; padding: 12px; border: 1px solid var(--sc-line); border-radius: 10px; background: var(--sc-surface); }
.sc-ws .sc-ivl { font: 500 11px/18px var(--sc-mono); padding: 0 6px; border-radius: 4px; background: var(--sc-surface-sunken); color: var(--sc-ink); }
.sc-ws .sc-status { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 12px; font-size: 12px; color: var(--sc-ink-muted); }
.sc-ws .sc-status b { font-weight: 600; color: var(--sc-ink); }
.sc-ws .sc-notice { padding: 6px 12px; font-size: 12px; color: var(--sc-danger); }
.sc-ws .sc-notice:empty { display: none; }
.sc-ws .sc-meta { padding: 0 6px; font-size: 12px; color: var(--sc-ink-muted); font-variant-numeric: tabular-nums; }
.sc-ws .sc-search:not([hidden]) { position: absolute; z-index: 4; top: 44px; left: 8px; display: flex; flex-direction: column; gap: 8px; width: min(480px, calc(100% - 16px)); padding: 12px; border: 1px solid var(--sc-line); border-radius: 10px; background: var(--sc-surface); box-sizing: border-box; }
.sc-ws .sc-search-row { display: flex; gap: 8px; }
.sc-ws .sc-search-row .sc-input { flex: 1; max-width: none; height: 32px; }
.sc-ws .sc-results { list-style: none; margin: 0; padding: 0; max-height: 260px; overflow: auto; }
.sc-ws .sc-result { width: 100%; height: 36px; justify-content: flex-start; }
.sc-ws .sc-result .sc-muted { color: var(--sc-ink-muted); font-weight: 400; }
.sc-ws .sc-result .sc-end { margin-left: auto; }
@media (prefers-reduced-motion: reduce) { .sc-ws .sc-btn, .sc-ws .sc-select, .sc-ws .sc-input { transition: none; } }
`

type StyleRoot = (Document | ShadowRoot) & { adoptedStyleSheets: CSSStyleSheet[] }
const adopted = new WeakMap<Node, { release: () => void, users: number }>()

/** Adds the sheet to the root that holds `host`; the returned function releases it. */
export function adoptWorkspaceStyles (host: HTMLElement): () => void {
  const root = host.getRootNode() as Node
  const existing = adopted.get(root)
  if (existing !== undefined) { existing.users++; return once(root) }
  const doc = host.ownerDocument, win = doc.defaultView
  let release: () => void
  const target = root as Partial<StyleRoot>
  if (win !== null && Array.isArray(target.adoptedStyleSheets) && typeof win.CSSStyleSheet === 'function' && 'replaceSync' in win.CSSStyleSheet.prototype) {
    const sheet = new win.CSSStyleSheet()
    sheet.replaceSync(CSS)
    const styleRoot = root as StyleRoot
    styleRoot.adoptedStyleSheets = [...styleRoot.adoptedStyleSheets, sheet]
    release = () => { styleRoot.adoptedStyleSheets = styleRoot.adoptedStyleSheets.filter(item => item !== sheet) }
  } else {
    // Older engines: a style element in the head or the shadow root.
    const style = doc.createElement('style')
    style.textContent = CSS
    const parent = root.nodeType === 11 ? root : doc.head ?? doc.documentElement
    parent.appendChild(style)
    release = () => { style.remove() }
  }
  adopted.set(root, { release, users: 1 })
  return once(root)
}

function once (root: Node): () => void {
  let done = false
  return () => {
    if (done) return
    done = true
    const entry = adopted.get(root)
    if (entry === undefined) return
    entry.users--
    if (entry.users === 0) { entry.release(); adopted.delete(root) }
  }
}
