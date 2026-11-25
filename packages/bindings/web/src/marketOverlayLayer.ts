import { projectMarketOverlays, type MarketOverlayFrame, type MarketOverlayOptions } from '@supersolutions/super-chart-core'
import { paintMarketOverlays, type MarketOverlayRenderOptions } from './marketOverlayRenderer'
import type { EngineLayer } from './layer'
import { colors, CANVAS_LABEL_FONT } from './tokens'

/** Import on demand; the base engine does not import the market detectors. */
export function createMarketOverlayLayer (
  options: MarketOverlayOptions,
  render: MarketOverlayRenderOptions = {}
): EngineLayer & { getSnapshot: () => MarketOverlayFrame | null } {
  const settings = {
    ...options,
    volumeProfile: typeof options.volumeProfile === 'object' ? { ...options.volumeProfile } : options.volumeProfile,
    orderBlocks: typeof options.orderBlocks === 'object' ? { ...options.orderBlocks } : options.orderBlocks
  }
  const style = { ...render }
  let projected: MarketOverlayFrame | null = null
  return {
    update: (frame, bars) => { projected = projectMarketOverlays(frame, bars, settings) },
    paint: context => {
      if (projected === null) return
      paintMarketOverlays(context, projected, style)
      const statuses = Object.values(projected.status)
      const message = statuses.includes('invalid-data') ? 'Overlay data unavailable'
        : projected.status.volumeProfile === 'too-wide' ? 'Zoom in to display the volume profile'
          : statuses.includes('too-wide') ? 'Zoom in to display imbalance zones'
            : statuses.includes('missing-volume') ? 'Volume profile needs reported volume' : ''
      if (message !== '') {
        context.save()
        try {
          context.font = CANVAS_LABEL_FONT; context.textAlign = 'left'; context.textBaseline = 'bottom'; context.fillStyle = colors(style.theme).inkMuted
          context.fillText(message, projected.bounds.left + 6, projected.bounds.bottom - 6, Math.max(1, projected.bounds.right - projected.bounds.left - 12))
        } finally { context.restore() }
      }
    },
    getSnapshot: () => projected,
    dispose: () => { projected = null }
  }
}
