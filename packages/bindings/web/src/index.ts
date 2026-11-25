/** Web chart and workspace. Renderer-free models live in `@supersolutions/super-chart-core`. */
export { EngineChart } from './chart'
export type { EngineChartOptions, EngineConfiguration } from './chart'
export { paintEngineFrame, paintEngineCursor } from './canvasRenderer'
export { ChartWorkspace, ChartWorkspace as SuperChart } from './workspace'
export type { WorkspacePriceMode } from './workspace'
export { WORKSPACE_SLOTS, WORKSPACE_PARTS } from './workspace'
export type { ChartWorkspaceOptions, WorkspaceSearchOptions, SymbolSearchRequest, WorkspaceAppearanceOptions, WorkspaceSlotName, WorkspacePart, WorkspaceContextTarget, WorkspaceContextMenuOptions, WorkspaceCommandOptions } from './workspace'
export { WORKSPACE_THEMES, WORKSPACE_CHROME_VARS, registerWorkspaceTheme, getWorkspaceTheme, listWorkspaceThemes } from './theme'
export type { WorkspaceTheme, WorkspaceThemeName, WorkspaceChromeKey, WorkspaceThemeInput } from './theme'
export { registerLocale, listLocales, hasLocale, createTranslator } from './i18n'
export type { WorkspaceMessages, WorkspaceMessageKey, Translator } from './i18n'
export { LAYOUT_BREAKPOINTS, resolveLayout, resolveIntervalControl } from './layout'
export type { WorkspaceLayoutMode, WorkspaceLayoutClass, WorkspaceIntervalControl } from './layout'
export { filterCommands } from './commands'
export type { WorkspaceCommand } from './commands'
export type { ContextMenuItem } from './panels'
export { DrawingImageRenderer, createDrawingImage } from './drawingMedia'
export type { EngineLayer } from './layer'
export { SUPER_CHART_COLORS, FONT_SANS, FONT_MONO } from './tokens'
export type { ChartDescriptions, ChartSummaryText, BarReadoutText } from './a11y'
export type { SuperChartColors, ThemeName } from './tokens'

// Models the Web surface has always exposed from its main entry; they now live in core.
export { ENGINE_CHART_TYPES, EngineIndicators, DrawingStore, projectDrawing, hitTestDrawingGeometry, DRAWING_TYPES, drawingAnchorCount, createPriceScale, buildEngineFrame, parseWorkspaceDocument, WORKSPACE_DOCUMENT_LIMITS, validateDrawingImage, DRAWING_IMAGE_LIMITS } from '@supersolutions/super-chart-core'
export type {
  EngineRenderOptions, EngineChartType,
  EngineIndicatorSpec, EngineIndicatorInstance, EngineIndicatorResult, IndicatorDefinition, IndicatorFigure, IndicatorRow, IndicatorPane,
  Drawing, DrawingType, DrawingAnchor, DrawingGeometry, DrawingContext,
  PriceScaleOptions, PriceScaleMode,
  EngineFrame, EngineLayout, EngineInspection,
  WorkspaceDocumentV1, WorkspaceDocumentOptions, WorkspaceSavedRender,
  Datafeed, SymbolInfo, Period, Timespan, HistoryRequest, HistoryResult, SearchRequest, DatafeedSubscribeCallback, MarketBar,
  WorkspaceState, WorkspaceEvents, WorkspaceLoadState, WorkspaceLoadResult, WorkspaceMarket, WorkspaceReplayState
} from '@supersolutions/super-chart-core'

export type { WorkspaceDrawingStorage, WorkspaceDrawingCacheOptions } from './drawingDocuments'
export { EngineAnnotations, ENGINE_ANNOTATION_LIMITS, ANNOTATION_TEMPLATE_LIMITS, BUILT_IN_ANNOTATION_TEMPLATES, DEFAULT_FIBONACCI_LEVELS } from './annotations'
export type {
  EngineAnnotationSpec, EngineAnnotationKind, EngineAnnotationTone, EngineAnnotationAnchor, EngineAnnotationRange, EngineAnnotationSpan, EngineAnnotationSnapshot, EngineProjectedAnnotation, EngineSetAnnotationsResult,
  AnnotationTemplate, AnnotationTemplateInput, AnnotationFigure, AnnotationParams, AnnotationPoint, ProjectedAnchor
} from './annotations'
export { HOLD_DRAW_LIMITS } from './holdDraw'
export type { DrawByHoldingOptions, HoldDrawEvent } from './holdDraw'
