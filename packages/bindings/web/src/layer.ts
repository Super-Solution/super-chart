import { type EngineFrame, type MarketBar } from '@supersolutions/super-chart-core'

/**
 * Optional paint layer. Callbacks read borrowed data; they must not mutate chart state.
 *
 * The chart's layer order, bottom to top:
 *   main canvas     background, grid, price series, indicators, last-price line,
 *                   axis labels and the last-price tag, then each layer's `paint`
 *                   (shapes: bands, lines, markers)
 *   drawing canvas  the person's drawings, then each layer's `paintLabels`
 *                   (text that must stay readable: chips and axis price tags)
 *   cursor canvas   the crosshair and its tags
 * Lines never cross a label: anything with words in it paints above every line.
 */
export interface EngineLayer {
  update: (frame: EngineFrame, revealedRawBars: readonly MarketBar[]) => void
  paint: (context: CanvasRenderingContext2D) => void
  /** Painted on the drawing canvas after the person's drawings. */
  paintLabels?: (context: CanvasRenderingContext2D) => void
  dispose?: () => void
}
