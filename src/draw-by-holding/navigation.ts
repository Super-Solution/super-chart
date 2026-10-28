export interface HoldNavigationChart {
  isScrollEnabled: () => boolean
  isZoomEnabled: () => boolean
  setScrollEnabled: (enabled: boolean) => void
  setZoomEnabled: (enabled: boolean) => void
}

/** Preserve a host's disabled flags across every end/cancel path, including disposal. */
export function createHoldNavigation (chart: () => HoldNavigationChart | null): { start: () => void, finish: () => void } {
  let saved: { chart: HoldNavigationChart, scroll: boolean, zoom: boolean } | null = null
  return {
    start () {
      if (saved !== null) return
      const target = chart()
      if (target === null) return
      saved = { chart: target, scroll: target.isScrollEnabled(), zoom: target.isZoomEnabled() }
      target.setScrollEnabled(false)
      target.setZoomEnabled(false)
    },
    finish () {
      const previous = saved
      saved = null
      if (previous === null) return
      previous.chart.setScrollEnabled(previous.scroll)
      previous.chart.setZoomEnabled(previous.zoom)
    }
  }
}
