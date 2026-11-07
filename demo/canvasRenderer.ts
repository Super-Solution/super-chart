import type { RealtimeChartFrame } from '@supersolutions/super-chart-core'

/** Web-only drawing boundary. Receives prepared geometry; owns no feed or gestures. */
export function paintChart (ctx: CanvasRenderingContext2D, frame: RealtimeChartFrame): void {
  const m = frame.model, g = m.geometry
  ctx.font = '12px system-ui'; ctx.fillStyle = '#aebcca'
  for (const value of m.yTicks) {
    const y = m.y(value); ctx.fillText(value.toFixed(2), 3, y + 4)
    ctx.strokeStyle = '#283444'; ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.right, y); ctx.stroke()
  }
  const body = Math.max(1, Math.min(12, g.plotWidth / Math.max(1, m.plottedCandles.length) * 0.65))
  for (const k of m.plottedCandles) {
    ctx.fillStyle = ctx.strokeStyle = k.c >= k.o ? '#58c9ac' : '#f28b82'
    ctx.beginPath(); ctx.moveTo(k.x, k.wickTop); ctx.lineTo(k.x, k.wickBottom); ctx.stroke()
    ctx.fillRect(k.x - body / 2, k.bodyTop, body, Math.max(1, k.bodyBottom - k.bodyTop))
  }
  for (const line of m.plottedSeries) {
    ctx.strokeStyle = line.source.color ?? '#8bafff'; ctx.beginPath()
    line.points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y) }); ctx.stroke()
  }
}

/** Snapshot only the chart layer, at its current backing resolution, with an opaque background. */
export async function chartPng (chart: HTMLCanvasElement): Promise<Blob> {
  const output = document.createElement('canvas')
  output.width = chart.width; output.height = chart.height
  const ctx = output.getContext('2d')
  if (ctx === null) throw new Error('Canvas 2D is unavailable')
  ctx.fillStyle = '#10151d'; ctx.fillRect(0, 0, output.width, output.height)
  ctx.drawImage(chart, 0, 0)
  return await new Promise((resolve, reject) => {
    output.toBlob(blob => { if (blob !== null) resolve(blob); else reject(new Error('PNG encoding failed')) }, 'image/png')
  })
}
