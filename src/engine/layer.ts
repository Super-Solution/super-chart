import type { EngineFrame } from './frame'
import type { MarketBar } from '../core/types'

/** Optional paint layer. Callbacks read borrowed data; they must not mutate chart state. */
export interface EngineLayer {
  update: (frame: EngineFrame, revealedRawBars: readonly MarketBar[]) => void
  paint: (context: CanvasRenderingContext2D) => void
  dispose?: () => void
}
