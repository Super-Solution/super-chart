/**
 * One place that puts Super Chart's figures and overlays into klinecharts'
 * registry. Nothing registers at import any more: the `.` entry calls this
 * once when it loads (that is the documented behaviour of the full entry), and
 * the lite entry's registerExtensionOverlays() calls it on demand. So importing
 * lite just for `chartStyles` registers nothing, and whichever entry loads
 * first, there is one figure implementation, not two competing ones.
 *
 * Part of SUPer-Chart (Apache-2.0).
 */

import { registerOverlay } from 'klinecharts'

import overlays from './index'
import { withAccent } from './accent'
import { registerHitPathFigure } from './hitPath'
import { registerImageFigure } from './imageTool'
import { registerCountdownOverlay } from '../canvas/countdown'
import { registerHighLowOverlay } from '../canvas/highLowTags'
import { registerCustomSeriesOverlay } from '../charttypes/customSeriesOverlay'
import { patchBuiltinLineHitTest } from './builtinHit'

let registered = false

/**
 * Register the extension figures and overlays. Idempotent, and — like every
 * registration here — done once at import (this module's caller is the `.`
 * entry's top-level side effect), never at first mount: a chart mounting
 * must register nothing beyond what importing the package already did
 * (see e2e/tests/smoke.spec.ts). `attachBarCountdown`'s own lazy call
 * (for the lite entry / a raw-klinecharts host that never imports this
 * module) stays a no-op here, since `registerCountdownOverlay` is itself
 * idempotent — same for SC-NEXT's registerHighLowOverlay and
 * registerCustomSeriesOverlay below.
 */
export function registerExtensions (): void {
  if (registered) {
    return
  }
  registered = true
  registerHitPathFigure()
  registerImageFigure()
  registerCountdownOverlay(registerOverlay)
  registerHighLowOverlay(registerOverlay)
  registerCustomSeriesOverlay(registerOverlay)
  // withAccent: the tools' accent colours come from the chart they draw on.
  overlays.forEach(o => { registerOverlay(withAccent(o)) })
  // A wider, correct hit test for the rail's built-in (klinecharts-native)
  // line tools, but only for a drawing_tools instance (SC-100).
  patchBuiltinLineHitTest()
}
