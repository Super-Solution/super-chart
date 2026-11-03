# Drawing interactions

### Draw by holding

Opt in with `drawByHolding: true`. Hold the primary pointer still for about a
third of a second, then draw a single stroke. Lines, rays, horizontal/vertical
lines, rectangles, ellipses, Fibonacci retracements, paths and arrows become
normal editable user drawings, with the same undo/redo and layout persistence
as the drawing rail. A quick drag keeps panning. End a straight line at the
right price axis for a ray; a horizontal stroke near a candle wick snaps to its
high/low; three sides of a box suggest Fibonacci; a short backward hook suggests
an arrow. Ambiguous strokes keep alternate readings.

While the newest result is selected and focus stays on the plot, chart root or
chart-owned document focus, **Tab** cycles readings, **Shift+Tab** goes back,
and **Escape** removes it as an undoable action. Another press, tool, selection,
history action or symbol/period change ends these temporary keys. Buttons,
links, ARIA controls, editable fields, Objects and toolbars retain their normal
focus navigation; focusing them ends the latest result's shortcut state.
Typing, IME composition, host focus and open chart dialogs retain their keys.
An unfinished stroke is discarded on Escape, pointer cancellation, a second
finger or disposal, with the host's original scroll/zoom flags restored.

A scribble crossing visible, unlocked user drawing geometry erases the touched
drawings in one undoable batch. Hidden/locked drawings and host/AI annotations
are protected. Unknown area tools are not erased by guessed anchor geometry.
The `?` button opens help; closing it stores no browser data. A host can set
`{ delayMs: 333, guide: false }` to supply its own help.

The klinecharts 9.7.2/9.8.12 compatibility adapter cancels native click/tap
interpretation and the 500 ms touch long-press timer when a hold arms, while
letting physical release clean up the peer's pressed state and listeners. A
peer without that verified internal seam leaves hold drawing disabled, so
ordinary chart interaction continues. Non-browser tests exercise both shipped
peer implementations; physical hand-drawn timing needs browser/device QA.

Click a drawing you made with the drawing bar and a floating toolbar opens over the chart (TradingView-style). It opens near the top centre, or elsewhere when that spot would cover the drawing, including lines the drawing extends across the chart, such as a horizontal line or a pitchfork's prongs:

- **Drag grip:** moves the toolbar anywhere inside the chart. The position is kept while that chart lives. The arrow keys move it too when the grip has focus.
- **Line colour:** a palette that starts with the theme's default drawing colour, plus an opacity slider and a hex field. Shapes keep the opacity of their fill, which takes the new colour.
- **Text colour:** only shown for drawings that render text, such as Fibonacci levels, wave labels, notes and callouts.
- **Line width:** 1 to 4 px. The button shows the current width.
- **Line style:** solid, dashed or dotted.
- The highlighter offers only its colour and opacity: its broad band is not a 1 to 4 px line. Its stroke can be clicked anywhere across its width.
- **Lock / unlock:** a locked drawing cannot be moved, its points cannot be dragged, and right-click does not delete it.
- **Delete.**
- **More (…):**
  - **Clone** makes a copy three bars to the right and 16 px lower, and selects it. Points that land past the latest candle go into the empty area on the right, as when you drag a drawing there. The price offset is measured at each point, so it works on a log scale too. A drawing finished early with a double-click, such as Any Waves, is copied as a finished drawing.
  - **Bring to front** and **Send to back** change the drawing order.
  - **Hide** hides the drawing. To get it back, click the drawing bar's eye button, which then shows every hidden drawing.

Keyboard: **Delete** or **Backspace** deletes the selected drawing and **Escape** deselects it (if a popover is open, Escape closes that first, also from its opacity slider). Keys are ignored while you type in an input, textarea or contenteditable, and while focus is in host UI outside the chart. To close the toolbar, click empty chart space, press Escape or delete the drawing. Switching symbol (from the symbol search or the host's `setSymbol`) closes it too, because drawings keep the old symbol's prices.

Only drawings made from the drawing bar (including brush and highlighter strokes) can be edited. Overlays a host creates through `getChart().createOverlay(...)` never open the toolbar, and nothing in the toolbar or the drawing bar changes or removes them. Some tools draw colours that carry meaning: long/short position, the measure tools, forecast, the volume profiles, anchored VWAP, regression trend and image. For those the toolbar offers only lock, delete and the "more" menu.

Price alerts and style templates are not included, because Super Chart has nothing to back them yet.

