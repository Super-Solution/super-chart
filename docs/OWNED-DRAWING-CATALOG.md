# Owned drawing catalog

All **65 tools advertised by the previous drawing rail** have an owned tool in
`DRAWING_TYPES`. This table maps functional tools, not the retired upstream
overlay API or its CSS. The former source remains available for review. No
upstream renderer, overlay registry, figure type or runtime import is required.

| Previous tool | Owned tool | Anchors | Behavior |
| --- | --- | ---: | --- |
| segment | segment | 2 | Bounded trend segment |
| rayLine | ray | 2 | Ray from A through B |
| straightLine | trend-line | 2 | Line extended in both directions |
| horizontalStraightLine | horizontal | 1 | Horizontal price level |
| horizontalRayLine | horizontal-ray | 1 | Price level extending right |
| horizontalSegment | horizontal-segment | 2 | Bounded level; equal retained prices |
| verticalStraightLine | vertical | 1 | Vertical time level |
| verticalRayLine | vertical-ray | 2 | Vertical ray toward B |
| verticalSegment | vertical-segment | 2 | Bounded vertical; equal retained timestamps |
| arrow | arrow | 2 | Directional segment |
| arrowUp | arrow-up | 1 | Up-pointing marker at the anchor |
| arrowDown | arrow-down | 1 | Down-pointing marker at the anchor |
| priceLine | price-line | 1 | Rightward level with actual anchor price |
| curve | curve | 3 | Quadratic curve with B as control |
| arc | arc | 3 | Quadratic curve passing through B at its midpoint |
| doubleCurve | double-curve | 4 | Cubic curve with B/C controls |
| flag | flag | 1 | Flag and post |
| priceChannelLine | price-channel | 3 | A/B center line, C boundary, symmetric opposite boundary |
| parallelStraightLine | parallel-channel | 3 | A/B boundary, C parallel boundary and center line |
| pitchfork | pitchfork | 3 | Andrews median and parallel prongs |
| schiff | schiff-pitchfork | 3 | Handle shifted halfway toward B in screen price |
| modifiedSchiff | modified-schiff-pitchfork | 3 | Handle shifted halfway toward B in time and screen price |
| regressionTrend | regression-trend | 2 | Least-squares close regression and two-standard-deviation channel |
| disjointChannel | disjoint-channel | 3 | Bounded parallel channel filled between A/B and C/D |
| circle | circle | 2 | Center A and radius through B |
| ellipse | ellipse | 2 | Ellipse in the A/B bounding box |
| rect | rectangle | 2 | Bounded rectangle |
| rotatedRect | rotated-rectangle | 3 | A/B edge; perpendicular width set by C |
| parallelogram | parallelogram | 3 | Three corners and the implied fourth corner |
| triangle | triangle | 3 | Filled triangle |
| fibonacciLine | fibonacci-line | 2 | Full-width retracement levels |
| fibonacciSegment | fibonacci | 2 | Bounded retracement levels |
| fibonacciCircle | fibonacci-circle | 2 | Six concentric Fibonacci rings |
| fibonacciSpiral | fibonacci-spiral | 2 | Nine Fibonacci quarter-circle arcs and direction ray |
| fibonacciSpeedResistanceFan | fibonacci-fan | 2 | Resistance grid and paired fan rays |
| fibonacciExtension | fibonacci-extension | 3 | Trend extension targets, including 161.8–423.6% |
| fibonacciTimeZone | fibonacci-time-zone | 2 | Time lines at 0/1/2/3/5/8/13/21/34 base spans |
| gannBox | gann-box | 2 | Box, diagonals and proportional internal lines |
| gannFan | gann-fan | 2 | Nine ratios relative to the A/B slope |
| gannSquare | gann-square | 2 | Box, diagonals and midpoint cross |
| fibonacciSpeedResistanceArc | fibonacci-arcs | 2 | Four resistance quarter arcs in the selected quadrant |
| xabcd | xabcd | 5 | Labeled harmonic path, cross-lines and paired triangles |
| abcd | abcd | 4 | Labeled path and cross-lines |
| threeWaves | three-waves | 4 | Three connected legs, numbered vertices |
| fiveWaves | five-waves | 6 | Five connected legs, numbered vertices |
| eightWaves | eight-waves | 9 | Eight connected legs, numbered vertices |
| anyWaves | any-waves | 2–256 | Variable numbered path; Enter/double-click completes |
| positionLong | position-long | 3 | Entry, higher target, lower stop and actual reward/risk |
| positionShort | position-short | 3 | Entry, lower target, higher stop and actual reward/risk |
| priceRange | price-range | 2 | Price delta and percentage |
| dateRange | time-range | 2 | Time duration and timestamp-resolved bar count |
| priceDateRange | price-time-range | 2 | Price delta, percentage and bar count |
| forecast | forecast | 2 | Projection arrow and actual percentage move |
| text | text | 1 | Plain text without a filled box |
| note | note | 1 | Text inside a note box |
| callout | callout | 2 | Text box at B with leader to A |
| priceLabel | price-label | 1 | Numeric label derived from the anchored price |
| signpost | signpost | 1 | Editable text on a post |
| pin | pin | 1 | Pin marker |
| image | image | 2 | Bounded local raster image |
| anchoredVWAP | anchored-vwap | 1 | Volume-weighted typical price from the anchor |
| fixedRangeVolumeProfile | fixed-range-volume-profile | 2 | Selected-range profile, POC and value area |
| anchoredVolumeProfile | anchored-volume-profile | 1 | Profile from the anchor through revealed history |
| brush | brush | 2–2048 | Retained freehand timestamp/price path |
| highlighter | highlighter | 2–2048 | Wide translucent retained path |

## Placement, editing and persistence

One-anchor tools use a click. Two-anchor tools use a drag. Fixed tools with three
or more anchors accept sequential clicks, or an initial A/B drag followed by
the remaining clicks. Variable waves finish with Enter or double-click. Escape,
pointer cancellation, blur and market changes discard incomplete drawings.
Only completed user operations enter shared undo history.

Text, note, callout and signpost use an inline plain-text editor on creation or
double-click. No HTML is inserted. Text is bounded to 512 characters and eight
explicit lines. Drawing snapshots retain immutable timestamp/price coordinates;
selected handles and body movement use the same projected geometry as painting.
Locked drawings can be selected, hidden or explicitly unlocked, but cannot be
moved, edited or deleted. Geometry and data-analysis failure states remain
available rather than substituting invented financial values.

Images are selected from a local file. Only static PNG, JPEG and WebP are accepted;
remote URLs and SVG are rejected. Encoded sources are bounded to 512 KiB,
dimensions to 4096 per axis and four million decoded pixels. Per-chart decoding
has a bounded cache, releases unused bitmaps and is disposed with the chart.
The complete drawing document is bounded to 8 MiB before mutation as well as on
import, preserving its own export/import contract. Unknown fields and invalid
metadata reject the entire import before it changes retained state.

## Numeric and rendering semantics

Retracement 100% is the first anchor and 0% the second. Extension values are
`C.price + (B.price - A.price) * ratio`. Those prices are projected through the
active price scale, including logarithmic scales; pixel interpolation never
substitutes a different financial price. The geometric Fibonacci circle/spiral/
fan/arcs and Gann constructions instead intentionally use screen distances and
angles, as the earlier tools did. Curves and arcs are bounded sampled paths,
and those same segments are used for hit detection. They are not a promise of
pixel-identical upstream rasterization.

Bar counts resolve timestamps against the current revealed history, so prepends
do not invalidate stored indices. Data-driven calculations use revealed bars
only; replay does not expose later bars. Missing volume, unavailable history,
invalid long/short ordering and bounded-work limits produce explicit analysis
statuses. A wrong-side stop is not silently converted into a valid position.

Visual changes are deliberate: the owned tools use one configurable drawing
palette instead of the old upstream style objects. Up/down markers point in
their named direction; the previous template's shaft signs were reversed.
Native integrations consume the pure retained model and projected primitives
with their own renderer; the browser workspace supplies Canvas2D and DOM input.

## Verification boundary

A temporary local Chrome observation created all 65 tools through their actual
pointer, text, local-file or freehand inputs. The document round-tripped and a
PNG snapshot completed without a page error. Generic position coordinates first
returned `invalid-position`; correctly ordered long/short placements then returned
`ready`, with the separate numeric 100/120/90 and 100/80/110 observations each
reporting reward/risk 2. Fibonacci, Gann slopes, time zones, selected third-handle
editing, cancellation, locked editing and observer isolation were observed
separately. These are bounded observations, not newly installed test cases or
an assertion of full visual parity. Existing browser tests remain separately
accounted in `e2e/MIGRATION.md`.
