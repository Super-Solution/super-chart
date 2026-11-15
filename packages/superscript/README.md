# @supersolutions/super-chart-superscript

The SuperScript language (compile, check, run), host-supplied AI helpers, and
`/scripts`, which turns a compiled script into an indicator for a Super Chart.
Runs in plain Node, so an MCP tool or backend can compile and run scripts.

`buildChartContext(workspace)` turns a `ChartWorkspace` (super-chart-web) into the compact bar context for
`analyzeChart`: the bars on screen, aggregated when zoomed out, in the chart's display time zone.

Only SuperScript is evaluated by default; the JavaScript adapter evaluates source
with `new Function` and must not be registered for untrusted input.

License: GPL-3.0-or-later; commercial licence available from SUPER SOLUTION LABS INC.
