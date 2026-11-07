import type { MarketOverlayFrame } from './marketOverlays'

export interface MarketOverlayRenderOptions {
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
  const { bounds, profile, zones } = frame
  if (profile === null && zones.length === 0) return
  const up = options.up ?? '#26a69a', down = options.down ?? '#ef5350'
  const profileColor = options.profile ?? '#7e57c2'
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
    if (profile !== null) {
      ctx.fillStyle = profileColor
      for (const row of profile.rows) {
        if (row.rect === null) continue
        ctx.globalAlpha = alpha * (row.pointOfControl ? 0.65 : 0.32)
        ctx.fillRect(row.rect.x, row.rect.y, row.rect.width, row.rect.height)
      }
      ctx.strokeStyle = profileColor
      const line = (y: number | null, opacity: number, dash: number[]): void => {
        if (y === null) return
        ctx.globalAlpha = alpha * opacity; ctx.setLineDash(dash)
        ctx.beginPath(); ctx.moveTo(bounds.left, y); ctx.lineTo(bounds.right, y); ctx.stroke()
      }
      line(profile.pocY, 0.9, [4, 4])
      if (options.showValueArea) { line(profile.vahY, 0.5, [2, 4]); line(profile.valY, 0.5, [2, 4]) }
    }
  } finally { ctx.restore() }
}
