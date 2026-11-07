import { type EngineFrame, type MarketBar } from '@supersolutions/super-chart-core'

/** Optional paint layer. Callbacks read borrowed data; they must not mutate chart state. */
export interface EngineLayer {
  update: (frame: EngineFrame, revealedRawBars: readonly MarketBar[]) => void
  paint: (context: CanvasRenderingContext2D) => void
  dispose?: () => void
}
