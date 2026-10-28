/**
 * SUPer-Chart — lightweight entry (`@zzyzxlabs/super-chart/lite`).
 *
 * The framework-agnostic surface of SUPer-Chart: the chart theme, the SuperScript
 * indicator/strategy engine, and the AI layer — WITHOUT the Solid.js KLineChartPro
 * UI bundle. Import from here when you drive a `klinecharts` instance yourself (e.g.
 * an embedded chart) and only want Super Chart's theme / SuperScript / AI, so you
 * don't pull the full Pro chrome into your bundle.
 *
 * Maintained by ZzyzxLabs. Apache-2.0.
 */
import { registerExtensions } from "./extension/register";
import { registerScIndicators } from "./indicators/register";

export { chartStyles, canvasTheme, canvasFontStyles } from "./chart-theme";
export { CANVAS_FONT, ICON_FONT_FAMILY } from "./theme/tokens";
export { enableCrispLines } from "./canvas/crispLines";
export { parsePeriod, periodKey } from "./period/parsePeriod";
// The command registry's DOM-free descriptors (SC-123) — same module as the
// `./commands` subpath, re-exported here too so a host already importing
// `./lite` (e.g. an embedded chart with no Solid UI) does not need a second
// import for tool schemas.
export { COMMAND_DESCRIPTORS, getCommandDescriptors, findCommandDescriptor, validateAgainstSchema } from "./commands/schema";
export type { CommandDescriptor, JSONSchema, JSONSchemaType } from "./commands/schema";
export * from "./superscript";
export * from "./superscript/indicator";
export * from "./ai";
export * from "./indicators";

/**
 * Opt-in registration of SUPer-Chart's extension overlays (fibonacci variants,
 * elliott waves, gann box, …) and the figures they draw with onto KLineChart.
 * The full (`.`) entry registers these automatically; from the lite entry call
 * this once before creating those overlays. Importing lite registers nothing.
 */
export function registerExtensionOverlays(): void {
  registerExtensions();
}

/**
 * Opt-in registration of the SC_* indicator pack (SC-155/160/167/168/169/170/171)
 * on your own klinecharts instance. Never touches klinecharts' own built-in
 * names ('RSI', 'MACD', 'SMA', …); see the `indicators` alias/catalog exports
 * from this entry for how to route a plain name to its SC_ replacement on your
 * own UI paths. The full (`.`) entry registers this automatically.
 */
export function registerIndicatorPack(): void {
  registerScIndicators();
}
