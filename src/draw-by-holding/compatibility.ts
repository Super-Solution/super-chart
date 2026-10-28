/** klinecharts 9 uses mouse/touch handlers. Block moves after a hold, but let native release reset its pressed state. */
export function createHoldCompatibility (onPinch: () => void): {
  start: () => void
  release: () => void
  move: (e: Event) => void
} {
  let held = false
  return {
    start () { held = true },
    release () { held = false },
    move (e) {
      if (e.type === 'touchmove' && (e as TouchEvent).touches.length > 1) {
        held = false
        onPinch()
        return
      }
      if (held) { e.preventDefault(); e.stopPropagation() }
    }
  }
}
