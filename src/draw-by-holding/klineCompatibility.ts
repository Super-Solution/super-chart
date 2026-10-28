interface NativeGesture {
  _cancelClick: boolean
  _cancelTap: boolean
  _longTapActive: boolean
  _pinchPrevented: boolean
  _clearLongTapTimeout: () => void
}

/**
 * klinecharts 9.7.2/9.8.12's SyntheticEvent owns release cleanup, but offers no
 * public cancel-click/long-tap API. Keep this compatibility read isolated (as
 * drawing-editor/compat.ts does for selection). Unsupported peers fail closed.
 */
function nativeGesture (chart: unknown): NativeGesture | null {
  const event = (chart as { _chartEvent?: { _event?: Partial<NativeGesture> } } | null)?._chartEvent?._event
  return event !== undefined && event !== null && typeof event._cancelClick === 'boolean' && typeof event._cancelTap === 'boolean' &&
    typeof event._longTapActive === 'boolean' && typeof event._pinchPrevented === 'boolean' && typeof event._clearLongTapTimeout === 'function'
    ? event as NativeGesture : null
}

export function supportsNativeHold (chart: unknown): boolean { return nativeGesture(chart) !== null }

/** Cancel only click/tap interpretation; native mouseup/touchend still clears pressed state and root listeners. */
export function prepareNativeHold (chart: unknown): boolean {
  const gesture = nativeGesture(chart)
  if (gesture === null) return false
  gesture._cancelClick = true
  gesture._cancelTap = true
  gesture._clearLongTapTimeout()
  gesture._longTapActive = false
  gesture._pinchPrevented = false
  return true
}
