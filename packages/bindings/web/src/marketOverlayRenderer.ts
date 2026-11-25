import type { MarketOverlayFrame } from '@supersolutions/super-chart-core'
import { colors, type ThemeName } from './tokens'

export interface MarketOverlayRenderOptions {
  /** Picks the default colours; up, down and profile below override them. */
  theme?: ThemeName
  up?: string
  down?: string
  profile?: string
  /** Show value-area boundaries in addition to the point of control. */
  showValueArea?: boolean
}

/** Canvas-only paint; projection and raw-data calculations stay platform neutral. */
export function paintMarketOverlays (
  ctx: CanvasRenderingContext2D, frame: MarketOverlayFrame, options: MarketOverlayRenderOptions = {}
): void {
  const { bounds, profile, sessionProfiles, zones } = frame
  if (profile === null && sessionProfiles.length === 0 && zones.length === 0) return
  // Zones are market data (up/down); the volume profile is a neutral measure, so it takes line-strong.
  const theme = colors(options.theme)
  const up = options.up ?? theme.up, down = options.down ?? theme.down
  const profileColor = options.profile ?? theme.lineStrong
  ctx.save()
  try {
    ctx.beginPath(); ctx.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top); ctx.clip()
    const alpha = ctx.globalAlpha
    ctx.lineWidth = 1
    for (const zone of zones) {
      const color = zone.direction === 'bullish' ? up : down
      const { x, y, width, height } = zone.rect
      ctx.fillStyle = color
      if (zone.kind === 'fair-value-gap') {
        ctx.globalAlpha = alpha * (zone.status === 'filled' ? 0.08 : 0.22)
        ctx.fillRect(x, y, width, height)
      } else {
        const mitigated = zone.status === 'mitigated'
        ctx.globalAlpha = alpha * (mitigated ? 0.06 : 0.16)
        ctx.fillRect(x, y, width, height)
        ctx.setLineDash(mitigated ? [3, 3] : [])
        ctx.globalAlpha = alpha * (mitigated ? 0.35 : 0.9)
        ctx.strokeStyle = color; ctx.strokeRect(x, y, width, height)
      }
    }
    const profiles = profile === null ? sessionProfiles.map(entry => entry.profile) : [profile, ...sessionProfiles.map(entry => entry.profile)]
    for (const each of profiles) {
      ctx.fillStyle = profileColor
      for (const row of each.rows) {
        if (row.rect === null) continue
        ctx.globalAlpha = alpha * (row.pointOfControl ? 0.65 : 0.32)
        ctx.fillRect(row.rect.x, row.rect.y, row.rect.width, row.rect.height)
      }
      ctx.strokeStyle = profileColor
      // The lines run across the profile's own span (the whole plot for the visible profile).
      const line = (y: number | null, opacity: number, dash: number[]): void => {
        if (y === null) return
        ctx.globalAlpha = alpha * opacity; ctx.setLineDash(dash)
        ctx.beginPath(); ctx.moveTo(each.span.left, y); ctx.lineTo(each.span.right, y); ctx.stroke()
      }
      line(each.pocY, 0.9, [4, 4])
      if (options.showValueArea) { line(each.vahY, 0.5, [2, 4]); line(each.valY, 0.5, [2, 4]) }
    }
  } finally { ctx.restore() }
}
