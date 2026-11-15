/** Web chart and workspace. Renderer-free models live in `@supersolutions/super-chart-core`. */
export { EngineChart } from './chart'
export type { EngineChartOptions, EngineConfiguration } from './chart'
export { paintEngineFrame, paintEngineCursor } from './canvasRenderer'
export { ChartWorkspace, ChartWorkspace as SuperChart } from './workspace'
export type { ChartWorkspaceOptions, WorkspaceSearchOptions } from './workspace'
export { DrawingImageRenderer, createDrawingImage } from './drawingMedia'
export type { EngineLayer } from './layer'
export { SUPER_CHART_COLORS, FONT_SANS, FONT_MONO } from './tokens'
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
