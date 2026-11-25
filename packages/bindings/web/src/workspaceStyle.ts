import { WORKSPACE_THEMES } from './theme'
import { FONT_SANS } from './tokens'
import { iconMask } from './icons'

/** Without a `theme` option the chrome falls back to the dark preset, the same values `setTheme('dark')` sets. */
const DARK = WORKSPACE_THEMES.dark.chrome

/** Scoped DOM chrome; host styles can override --sc-* tokens without changing Canvas. */
export const WORKSPACE_STYLE = `
.sc-workspace{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:280px;box-sizing:border-box;background:var(--sc-background,${DARK.background});color:var(--sc-text,${DARK.text});font:var(--sc-font-size,13px)/1.4 var(--sc-font,${FONT_SANS});color-scheme:var(--sc-color-scheme,${DARK.colorScheme});isolation:isolate}
.sc-workspace{--sc-search-icon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5'/%3E%3C/svg%3E")}
.sc-workspace{--sc-icon-chart:${iconMask('chart')};--sc-icon-indicators:${iconMask('indicators')};--sc-icon-objects:${iconMask('objects')};--sc-icon-more:${iconMask('more')}}
.sc-workspace *, .sc-workspace *::before, .sc-workspace *::after{box-sizing:border-box}
.sc-workspace [hidden]{display:none!important}
.sc-workspace button,.sc-workspace select,.sc-workspace input,.sc-workspace summary{text-transform:none;letter-spacing:normal;word-spacing:normal;text-indent:0;text-shadow:none;font-style:normal;font-family:inherit;-webkit-appearance:none;appearance:none}
.sc-workspace select{-webkit-appearance:auto;appearance:auto}
.sc-workspace .sc-icon{width:var(--sc-icon-size,18px);height:var(--sc-icon-size,18px);flex:none}
.sc-workspace .sc-row{display:flex;align-items:center;gap:2px;min-width:0;padding:4px 8px;flex-shrink:0;border-bottom:1px solid var(--sc-border,${DARK.divider});background:var(--sc-toolbar-background,${DARK.toolbar})}
.sc-workspace .sc-marketbar{flex-wrap:wrap;min-height:var(--sc-bar-height,44px)}
.sc-workspace .sc-drawingbar{overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;white-space:nowrap;min-height:var(--sc-bar-height,44px);gap:6px}
.sc-workspace .sc-button,.sc-workspace .sc-select,.sc-workspace .sc-input,.sc-workspace .sc-menu>summary{font:inherit;line-height:1.3;min-height:var(--sc-control-height,32px);border:1px solid var(--sc-control-border,${DARK.border});border-radius:var(--sc-radius,6px);background:var(--sc-control-background,${DARK.surface});color:var(--sc-text,${DARK.text});padding:4px 10px;margin:0}
.sc-workspace .sc-button,.sc-workspace .sc-menu>summary{border-color:var(--sc-button-border,transparent);background:var(--sc-button-background,transparent);font-weight:500}
.sc-workspace .sc-menu-panel .sc-button,.sc-workspace .sc-search .sc-button,.sc-workspace .sc-replay-controls .sc-button,.sc-workspace .sc-footer .sc-button,.sc-workspace .sc-indicator-entry .sc-button{border-color:var(--sc-control-border,${DARK.border});background:var(--sc-control-background,${DARK.surface})}
@media(prefers-reduced-motion:no-preference){.sc-workspace .sc-button,.sc-workspace .sc-menu>summary,.sc-workspace .sc-flyout-item{transition:background-color .12s,color .12s,border-color .12s}}
.sc-workspace .sc-button,.sc-workspace .sc-menu>summary{cursor:pointer;white-space:nowrap;flex-shrink:0;user-select:none;touch-action:manipulation}
.sc-workspace .sc-select{cursor:pointer;max-width:190px;min-width:0;accent-color:var(--sc-accent,${DARK.accent})}
.sc-workspace .sc-input{width:100%;min-width:0;outline-offset:2px}
.sc-workspace .sc-button:hover:not(:disabled),.sc-workspace .sc-menu>summary:hover,.sc-workspace .sc-select:hover:not(:disabled){background:var(--sc-hover-background,${DARK.hover});border-color:var(--sc-hover-border,${DARK.hoverBorder})}
.sc-workspace .sc-button:disabled,.sc-workspace .sc-select:disabled,.sc-workspace .sc-input:disabled{opacity:.4;cursor:not-allowed}
.sc-workspace .sc-button:focus-visible,.sc-workspace .sc-select:focus-visible,.sc-workspace .sc-input:focus-visible,.sc-workspace summary:focus-visible{outline:2px solid var(--sc-focus,${DARK.focus});outline-offset:2px}
.sc-workspace .sc-button[aria-pressed=true],.sc-workspace .sc-menu[open]>summary{color:var(--sc-accent,${DARK.accent});background:var(--sc-active-background,${DARK.active})}
.sc-workspace .sc-menu-panel .sc-button[aria-pressed=true],.sc-workspace .sc-footer .sc-button[aria-pressed=true],.sc-workspace .sc-replay-controls .sc-button[aria-pressed=true]{border-color:var(--sc-accent,${DARK.accent})}
.sc-workspace .sc-primary{border-color:var(--sc-accent,${DARK.accent});color:var(--sc-accent,${DARK.accent})}
.sc-workspace .sc-danger:hover:not(:disabled){color:var(--sc-danger,${DARK.danger});border-color:var(--sc-danger,${DARK.danger})}
.sc-workspace .sc-symbol{display:inline-flex;align-items:center;gap:8px;font-size:15px;font-weight:650;max-width:200px;overflow:hidden;text-overflow:ellipsis;text-align:left;margin-right:4px}
.sc-workspace .sc-symbol::before{content:'';flex:none;width:16px;height:16px;background:var(--sc-muted,${DARK.muted});-webkit-mask:var(--sc-search-icon) center/contain no-repeat;mask:var(--sc-search-icon) center/contain no-repeat}
.sc-workspace .sc-field{display:flex;align-items:center;gap:6px;min-width:0;margin:0}
.sc-workspace .sc-field-label{font-size:11px;color:var(--sc-muted,${DARK.muted});white-space:nowrap}
.sc-workspace .sc-marketbar>.sc-field>.sc-field-label,.sc-workspace .sc-drawingbar>.sc-field>.sc-field-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.sc-workspace .sc-menu{position:static;flex-shrink:0}
.sc-workspace .sc-menu>summary{display:flex;align-items:center;gap:6px;list-style:none}
.sc-workspace .sc-menu>summary::-webkit-details-marker{display:none}
.sc-workspace .sc-menu>summary::after{content:'⌄';font-size:11px;color:var(--sc-muted,${DARK.muted})}
.sc-workspace .sc-menu-panel,.sc-workspace .sc-search{position:absolute;z-index:8;top:46px;left:8px;right:8px;max-width:520px;max-height:calc(100% - 58px);overflow:auto;overscroll-behavior:contain;border:1px solid var(--sc-panel-border,${DARK.panelBorder});border-radius:var(--sc-panel-radius,6px);background:var(--sc-panel-background,${DARK.panel});box-shadow:var(--sc-panel-shadow,${DARK.panelShadow});padding:12px}
.sc-workspace .sc-menu:not([open])>.sc-menu-panel{display:none}
.sc-workspace .sc-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sc-workspace .sc-settings-grid>.sc-field,.sc-workspace .sc-indicator-editor>.sc-field{flex-direction:column;align-items:stretch;gap:5px}
.sc-workspace .sc-settings-grid .sc-select,.sc-workspace .sc-indicator-editor .sc-select{max-width:none;width:100%}
.sc-workspace .sc-indicator-add{display:flex;align-items:end;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--sc-border,${DARK.divider})}
.sc-workspace .sc-indicator-add>.sc-field{flex:1;align-items:stretch;flex-direction:column}
.sc-workspace .sc-indicator-add .sc-select{max-width:none;width:100%}
.sc-workspace .sc-indicator-list{display:flex;flex-direction:column;gap:8px;padding-top:10px}
.sc-workspace .sc-indicator-entry{display:flex;align-items:flex-start;gap:8px;padding:8px;border:1px solid var(--sc-border,${DARK.divider});border-radius:var(--sc-radius,4px)}
.sc-workspace .sc-indicator{flex:1;min-width:0}
.sc-workspace .sc-indicator>summary{cursor:pointer;padding:5px 0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.sc-workspace .sc-indicator-editor{display:grid;gap:10px;margin-top:10px;grid-template-columns:1fr 1fr}
.sc-workspace .sc-indicator-editor>.sc-field:first-child,.sc-workspace .sc-actions{grid-column:1/-1}
.sc-workspace .sc-actions{display:flex;gap:6px;flex-wrap:wrap}
.sc-workspace .sc-hint{color:var(--sc-muted,${DARK.muted});margin:4px 0}
.sc-workspace .sc-body{position:relative;display:flex;flex:1;min-height:160px;min-width:0}
.sc-workspace .sc-stage{position:relative;flex:1;min-height:160px;min-width:0}
.sc-workspace .sc-rail{display:flex;flex-direction:column;justify-content:space-between;gap:4px;flex:none;width:var(--sc-rail-width,48px);padding:4px;border-right:1px solid var(--sc-border,${DARK.divider});background:var(--sc-toolbar-background,${DARK.toolbar});overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--sc-border,${DARK.divider}) transparent}
.sc-workspace .sc-rail{--sc-rail-fade:var(--sc-toolbar-background,${DARK.toolbar});background:linear-gradient(var(--sc-rail-fade) 30%,transparent) top/100% 28px no-repeat local,linear-gradient(transparent,var(--sc-rail-fade) 70%) bottom/100% 28px no-repeat local,radial-gradient(farthest-side at 50% 0,rgba(128,128,128,.45),transparent) top/100% 8px no-repeat scroll,radial-gradient(farthest-side at 50% 100%,rgba(128,128,128,.45),transparent) bottom/100% 8px no-repeat scroll,var(--sc-toolbar-background,${DARK.toolbar})}
.sc-workspace .sc-rail-list,.sc-workspace .sc-rail-foot{display:flex;flex-direction:column;align-items:center;gap:2px}
.sc-workspace .sc-rail-foot{padding-top:6px;border-top:1px solid var(--sc-border,${DARK.divider})}
.sc-workspace .sc-rail-foot:not(:has(*)){display:none}
.sc-workspace .sc-rail-modes{display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:auto;padding-top:6px;border-top:1px solid var(--sc-border,${DARK.divider})}
.sc-workspace .sc-rail-modes:not(:has(*)){display:none}
.sc-workspace .sc-rail-modes .sc-history{flex-direction:column}
.sc-workspace .sc-rail-modes .sc-button{width:var(--sc-rail-button,38px);height:var(--sc-rail-button,38px);min-height:0}
.sc-workspace .sc-rail{justify-content:flex-start}
.sc-workspace .sc-rail-foot{margin-top:0}
.sc-workspace .sc-rail-foot .sc-history{flex-direction:column}
.sc-workspace .sc-rail-foot .sc-button{width:var(--sc-rail-button,38px);height:var(--sc-rail-button,38px);min-height:0}
.sc-workspace .sc-rail-group{position:relative;display:flex}
.sc-workspace .sc-rail-group::after{content:'';position:absolute;right:3px;bottom:3px;border:3px solid transparent;border-right-color:var(--sc-muted,${DARK.muted});border-bottom-color:var(--sc-muted,${DARK.muted});pointer-events:none}
.sc-workspace .sc-rail-tool{display:inline-flex;align-items:center;justify-content:center;width:var(--sc-rail-button,38px);height:var(--sc-rail-button,38px);min-height:0;padding:0}
.sc-workspace .sc-rail-tool .sc-icon{width:var(--sc-rail-icon-size,22px);height:var(--sc-rail-icon-size,22px)}
.sc-workspace .sc-rail-more{position:absolute;top:0;right:0;bottom:0;width:14px;min-height:0;padding:0;display:flex;align-items:center;justify-content:center;border-radius:0 var(--sc-radius,6px) var(--sc-radius,6px) 0;opacity:0;color:var(--sc-muted,${DARK.muted})}
.sc-workspace .sc-rail-more .sc-icon{width:12px;height:12px}
.sc-workspace .sc-rail-group:hover .sc-rail-more,.sc-workspace .sc-rail-group:focus-within .sc-rail-more,.sc-workspace .sc-rail-more[aria-expanded=true]{opacity:1;background:var(--sc-hover-background,${DARK.hover})}
.sc-workspace .sc-rail-group:hover::after,.sc-workspace .sc-rail-group:focus-within::after{display:none}
.sc-workspace .sc-flyout{position:absolute;z-index:9;min-width:220px;max-width:min(300px,calc(100% - 64px));overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:4px;border:1px solid var(--sc-panel-border,${DARK.panelBorder});border-radius:var(--sc-panel-radius,8px);background:var(--sc-panel-background,${DARK.panel});box-shadow:var(--sc-panel-shadow,${DARK.panelShadow})}
.sc-workspace .sc-flyout-title{padding:6px 8px 4px;font-size:11px;font-weight:600;color:var(--sc-muted,${DARK.muted})}
.sc-workspace .sc-flyout-item{display:flex;align-items:center;gap:10px;width:100%;min-height:34px;padding:4px 8px;border:0;border-radius:var(--sc-radius-small,4px);background:transparent;color:var(--sc-text,${DARK.text});font:inherit;text-align:left;cursor:pointer}
.sc-workspace .sc-flyout-item:hover,.sc-workspace .sc-flyout-item:focus-visible{background:var(--sc-hover-background,${DARK.hover})}
.sc-workspace .sc-flyout-item:focus-visible{outline:2px solid var(--sc-focus,${DARK.focus});outline-offset:-2px}
.sc-workspace .sc-flyout-item[aria-checked=true]{color:var(--sc-accent,${DARK.accent});background:var(--sc-active-background,${DARK.active})}
.sc-workspace .sc-history{display:flex;align-items:center;gap:2px;flex:none}
.sc-workspace .sc-marketbar>.sc-history{margin-left:auto}
.sc-workspace .sc-marketbar>.sc-history,.sc-workspace .sc-marketbar>.sc-secondary{padding-left:6px}
.sc-workspace .sc-marketbar>.sc-history+.sc-secondary{padding-left:0}
@media(hover:none){.sc-workspace .sc-rail-more{opacity:.7}}
.sc-workspace .sc-chart{position:absolute;inset:0}
.sc-workspace .sc-mark-tip{position:absolute;z-index:6;max-width:min(320px,calc(100% - 8px));padding:6px 8px;border:1px solid var(--sc-panel-border,${DARK.panelBorder});border-radius:var(--sc-panel-radius,6px);background:var(--sc-panel-background,${DARK.panel});color:var(--sc-text,${DARK.text});box-shadow:var(--sc-panel-shadow,${DARK.panelShadow});font-size:12px;line-height:1.35;pointer-events:none;overflow-wrap:anywhere}
.sc-workspace .sc-mark-tip-time{color:var(--sc-muted,${DARK.muted});font-size:11px;margin-bottom:2px}
.sc-workspace .sc-mark-tip-row+.sc-mark-tip-row{margin-top:3px}
.sc-workspace .sc-stage-status{position:absolute;inset:0;display:grid;place-content:center;padding:24px;color:var(--sc-muted,${DARK.muted});text-align:center;overflow-wrap:anywhere;pointer-events:none}
.sc-workspace[data-state=error] .sc-stage-status{color:var(--sc-danger,${DARK.danger})}
.sc-workspace .sc-notice{flex-shrink:0;padding:8px 12px;color:var(--sc-danger,${DARK.danger});background:var(--sc-error-background,${DARK.error});border-bottom:1px solid var(--sc-border,${DARK.divider});overflow-wrap:anywhere}
.sc-workspace .sc-notice:empty{display:none}
.sc-workspace .sc-holdnote{flex-shrink:0;padding:4px 12px;font-size:12px;color:var(--sc-muted,${DARK.muted});border-bottom:1px solid var(--sc-border,${DARK.divider})}
.sc-workspace .sc-holdnote:empty{display:none}
.sc-workspace [data-hold-draw=armed]{cursor:crosshair}
.sc-workspace .sc-footer{flex-wrap:wrap;border-top:1px solid var(--sc-border,${DARK.divider});border-bottom:0;min-height:34px;font-size:12px}
.sc-workspace .sc-status{flex:1;min-width:120px;display:flex;align-items:center;flex-wrap:wrap;gap:8px;overflow-wrap:anywhere;color:var(--sc-muted,${DARK.muted})}
.sc-workspace .sc-ticker{font-weight:600;color:var(--sc-text,${DARK.text});white-space:nowrap;overflow-wrap:normal}
.sc-workspace .sc-menu-panel .sc-history{flex:none;margin-bottom:6px}
.sc-workspace .sc-interval,.sc-workspace .sc-count,.sc-workspace .sc-venue{padding:1px 6px;border-radius:var(--sc-radius,4px);background:var(--sc-hover-background,${DARK.hover});color:var(--sc-text,${DARK.text});font-variant-numeric:tabular-nums;line-height:16px}
.sc-workspace .sc-status .sc-interval{white-space:nowrap;overflow-wrap:normal}
.sc-workspace .sc-countdown{font-variant-numeric:tabular-nums;color:var(--sc-muted,${DARK.muted});white-space:nowrap}
.sc-workspace .sc-countdown:empty{display:none}
.sc-workspace .sc-replay-controls{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 8px;border-top:1px solid var(--sc-border,${DARK.divider});background:var(--sc-toolbar-background,${DARK.toolbar})}
.sc-workspace .sc-replay-info{display:inline-flex;flex-wrap:wrap;gap:8px;font-variant-numeric:tabular-nums;color:var(--sc-muted,${DARK.muted});font-size:11px;overflow-wrap:anywhere}
.sc-workspace .sc-panel-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
.sc-workspace .sc-panel-header h2{font:inherit;font-size:14px;font-weight:600;margin:0}
.sc-workspace .sc-search{z-index:10}
.sc-workspace .sc-search-input{width:100%;font-size:14px;min-height:36px}
.sc-workspace .sc-search-status{font-size:11px;color:var(--sc-muted,${DARK.muted});padding:9px 0;min-height:32px}
.sc-workspace .sc-search-results{list-style:none;margin:0;padding:0;max-height:260px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
.sc-workspace .sc-search-results li+li{margin-top:4px}
.sc-workspace .sc-search-result{display:flex;align-items:center;gap:12px;width:100%;text-align:left;min-height:38px;white-space:normal}
.sc-workspace .sc-search-result strong{min-width:70px;flex-shrink:0}
.sc-workspace .sc-search-result span{color:var(--sc-muted,${DARK.muted});font-size:11px;overflow-wrap:anywhere}
.sc-workspace .sc-search-result .sc-venue{margin-left:auto;flex-shrink:0}
.sc-workspace[data-density=comfortable] .sc-button,.sc-workspace[data-density=comfortable] .sc-select,.sc-workspace[data-density=comfortable] .sc-input,.sc-workspace[data-density=comfortable] .sc-menu>summary{min-height:var(--sc-control-height,38px)}
.sc-workspace:fullscreen{min-height:0;background:var(--sc-background,${DARK.background})}
@media(pointer:coarse){.sc-workspace .sc-button,.sc-workspace .sc-select,.sc-workspace .sc-menu>summary{min-height:var(--sc-touch-target,40px)}.sc-workspace .sc-rail-tool{min-height:0}}
@media(forced-colors:active){.sc-workspace .sc-button[aria-pressed=true],.sc-workspace .sc-menu[open]>summary{outline:2px solid Highlight}.sc-workspace .sc-button:disabled{opacity:1;color:GrayText}}

.sc-workspace .sc-slot{display:flex;align-items:center;gap:6px;min-width:0;flex:none}
.sc-workspace .sc-slot:empty{display:none}
.sc-workspace .sc-drawingbar>*{flex:none}
.sc-workspace .sc-drawingbar>.sc-field{min-width:max-content}
.sc-workspace .sc-drawingbar .sc-select{min-width:96px}
.sc-workspace .sc-secondary{display:flex;align-items:center;gap:6px;flex:none}
.sc-workspace .sc-menu-panel .sc-secondary{flex-wrap:wrap}
.sc-workspace .sc-intervals{display:flex;align-items:center;gap:2px;min-width:0;max-width:100%;overflow-x:auto;scrollbar-width:none}
.sc-workspace .sc-intervals::-webkit-scrollbar{display:none}
.sc-workspace .sc-interval-button{flex:none;padding:4px 9px;color:var(--sc-text,${DARK.text})}
.sc-workspace .sc-interval-button[aria-pressed=true]{font-weight:650}
.sc-workspace .sc-icon-button .sc-icon{display:none;flex:none}
.sc-workspace .sc-icon-button{display:inline-flex;align-items:center;justify-content:center;gap:6px}
.sc-workspace .sc-icon-only{padding:0;min-width:var(--sc-control-height,32px)}
.sc-workspace .sc-icon-only .sc-icon,.sc-workspace:not([data-layout=regular]) .sc-icon-button .sc-icon{display:block}
.sc-workspace .sc-icon-only .sc-label,.sc-workspace:not([data-layout=regular]) .sc-drawingbar>.sc-icon-button .sc-label,.sc-workspace:not([data-layout=regular]) .sc-tools-toggle .sc-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.sc-workspace .sc-scalebar{margin-left:auto;padding:0;border:0;min-height:0;background:transparent;gap:4px}
.sc-workspace .sc-scalebar .sc-button{padding:2px 8px;min-height:24px}
.sc-workspace .sc-scalebar .sc-select{padding:2px 6px;min-height:24px;font-size:12px}
.sc-workspace .sc-zone-select{width:150px;max-width:240px;field-sizing:content}
.sc-workspace .sc-menu-panel .sc-scalebar{grid-column:1/-1;width:100%;margin:0;gap:8px}
.sc-workspace .sc-menu-panel .sc-scalebar .sc-select{flex:1;width:auto;max-width:none;field-sizing:fixed}
.sc-workspace .sc-palette .sc-search-results{max-height:320px}
.sc-workspace .sc-palette-group{margin:8px 0 2px;font-size:11px;color:var(--sc-muted,${DARK.muted});text-transform:uppercase;letter-spacing:.04em}
.sc-workspace .sc-palette-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 8px;border-radius:var(--sc-radius,4px);cursor:pointer}
.sc-workspace .sc-palette-item[aria-selected=true],.sc-workspace .sc-palette-item:hover{background:var(--sc-hover-background,${DARK.hover});outline:1px solid var(--sc-hover-border,${DARK.hoverBorder})}
.sc-workspace .sc-palette-item kbd{font:inherit;font-size:11px;color:var(--sc-muted,${DARK.muted})}
.sc-workspace .sc-context-menu{position:absolute;z-index:12;min-width:200px;max-width:min(320px,100%);padding:4px;border:1px solid var(--sc-panel-border,${DARK.panelBorder});border-radius:var(--sc-panel-radius,6px);background:var(--sc-panel-background,${DARK.panel});box-shadow:var(--sc-panel-shadow,${DARK.panelShadow})}
.sc-workspace .sc-menu-item{display:block;width:100%;text-align:left;border-color:transparent;background:transparent;white-space:normal}
.sc-workspace .sc-menu-item[data-separator=true]{margin-top:5px;position:relative}
.sc-workspace .sc-menu-item[data-separator=true]::before{content:'';position:absolute;left:4px;right:4px;top:-4px;border-top:1px solid var(--sc-border,${DARK.divider})}
.sc-workspace .sc-object-list{display:flex;flex-direction:column;gap:4px;max-height:320px;overflow:auto;overscroll-behavior:contain}
.sc-workspace .sc-object-heading{margin:8px 0 2px;font-size:11px;font-weight:600;color:var(--sc-muted,${DARK.muted});text-transform:uppercase;letter-spacing:.04em}
.sc-workspace .sc-object-row{display:flex;align-items:center;gap:4px}
.sc-workspace .sc-object-row .sc-button{padding:2px 8px;min-height:24px}
.sc-workspace .sc-mark-row{flex:1;min-width:0;padding:3px 8px;font-size:12px;line-height:1.35;overflow-wrap:anywhere;color:var(--sc-muted,${DARK.muted});border-radius:4px}
.sc-workspace .sc-mark-row:focus-visible{outline:2px solid var(--sc-focus,${DARK.focus});outline-offset:-2px}
.sc-workspace .sc-object-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;text-align:left;border-color:transparent}
.sc-workspace[data-headless=true] .sc-marketbar,.sc-workspace[data-headless=true] .sc-drawingbar,.sc-workspace[data-headless=true] .sc-footer,.sc-workspace[data-headless=true] .sc-notice,.sc-workspace[data-headless=true] .sc-holdnote,.sc-workspace[data-headless=true] .sc-replay-controls,.sc-workspace[data-headless=true] .sc-stage-status{display:none!important}
.sc-workspace[data-layout=compact] .sc-row,.sc-workspace[data-layout=narrow] .sc-row{padding:4px 6px;gap:4px}
.sc-workspace[data-layout=compact] .sc-marketbar{flex-wrap:nowrap}
.sc-workspace[data-layout=compact] .sc-intervals{flex:0 1 auto}
.sc-workspace[data-layout=narrow] .sc-marketbar{flex-wrap:wrap;gap:2px}
.sc-workspace[data-layout=narrow] .sc-symbol{display:block;flex:1 1 56px;min-width:44px;max-width:110px;margin-right:0;padding:4px 4px;white-space:nowrap}
.sc-workspace[data-layout=narrow] .sc-symbol::before{display:inline-block;vertical-align:-3px;margin-right:4px}
.sc-workspace[data-layout=narrow] .sc-marketbar .sc-select{padding:4px 2px;min-width:0}
.sc-workspace[data-layout=narrow] .sc-marketbar{container-type:inline-size}
@container (max-width:340px){.sc-workspace[data-layout=narrow] .sc-symbol::before{display:none}}
.sc-workspace[data-layout=narrow] .sc-menu[data-icon]>summary{min-width:var(--sc-control-height,32px)}
.sc-workspace[data-layout=narrow] .sc-tools-toggle{padding:0;min-width:var(--sc-control-height,32px)}
.sc-workspace .sc-menu-panel .sc-palette-button .sc-label{position:static;width:auto;height:auto;overflow:visible;clip-path:none}
.sc-workspace .sc-menu-panel .sc-palette-button{width:100%;justify-content:flex-start;padding:4px 10px}
.sc-workspace[data-layout=narrow] .sc-menu>summary{padding:5px 6px}
.sc-workspace[data-layout=narrow] .sc-menu[data-icon]>summary{font-size:0;gap:0;padding:0;justify-content:center;position:relative}
.sc-workspace[data-layout=narrow] .sc-menu[data-icon]>summary::before{content:'';width:18px;height:18px;background:currentColor;-webkit-mask:var(--sc-icon) center/contain no-repeat;mask:var(--sc-icon) center/contain no-repeat}
.sc-workspace[data-layout=narrow] .sc-menu[data-icon]>summary::after{display:none}
.sc-workspace[data-layout=narrow] .sc-menu[data-icon]>summary .sc-count{position:absolute;top:0;right:0;min-width:14px;padding:0 3px;font-size:10px;line-height:14px;text-align:center}
.sc-workspace[data-layout=narrow] .sc-menu[data-icon=chart]{--sc-icon:var(--sc-icon-chart)}
.sc-workspace[data-layout=narrow] .sc-menu[data-icon=indicators]{--sc-icon:var(--sc-icon-indicators)}
.sc-workspace[data-layout=narrow] .sc-menu[data-icon=objects]{--sc-icon:var(--sc-icon-objects)}
.sc-workspace[data-layout=narrow] .sc-menu[data-icon=more]{--sc-icon:var(--sc-icon-more)}
.sc-workspace[data-layout=narrow] .sc-status{min-width:0;flex:1 1 auto;max-width:100%}
.sc-workspace[data-layout=narrow] .sc-footer{gap:4px;min-height:0}
.sc-workspace[data-layout=narrow] .sc-footer .sc-button{padding:2px 8px;min-height:28px}
.sc-workspace .sc-dt{position:absolute;left:0;top:0;z-index:7;display:flex;align-items:center;gap:2px;padding:4px;max-width:calc(100% - 8px);border:1px solid var(--sc-panel-border,${DARK.panelBorder});border-radius:var(--sc-panel-radius,8px);background:var(--sc-panel-background,${DARK.panel});box-shadow:var(--sc-panel-shadow,${DARK.panelShadow});color:var(--sc-text,${DARK.text});touch-action:none;will-change:transform}
.sc-workspace .sc-dt[data-busy=true]{opacity:0;pointer-events:none}
.sc-workspace .sc-dt-grip{display:flex;align-items:center;justify-content:center;width:16px;height:30px;color:var(--sc-muted,${DARK.muted});cursor:grab}
.sc-workspace .sc-dt-grip:active{cursor:grabbing}
.sc-workspace .sc-dt-grip .sc-icon{width:14px;height:14px;stroke-width:2.6}
.sc-workspace .sc-dt-sep{align-self:stretch;width:1px;margin:3px 3px;background:var(--sc-border,${DARK.divider})}
.sc-workspace .sc-dt-button{position:relative;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:32px;height:32px;padding:0 6px;border:0;border-radius:var(--sc-radius-small,6px);background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer;touch-action:manipulation}
.sc-workspace .sc-dt-button:hover:not(:disabled){background:var(--sc-hover-background,${DARK.hover})}
.sc-workspace .sc-dt-button:focus-visible,.sc-workspace .sc-dt-item:focus-visible,.sc-workspace .sc-dt-chip:focus-visible,.sc-workspace .sc-dt-wide:focus-visible{outline:2px solid var(--sc-focus,${DARK.focus});outline-offset:1px}
.sc-workspace .sc-dt-button:disabled{opacity:.4;cursor:not-allowed}
.sc-workspace .sc-dt-button[aria-pressed=true],.sc-workspace .sc-dt-button[aria-expanded=true]{background:var(--sc-active-background,${DARK.active});color:var(--sc-accent,${DARK.accent})}
.sc-workspace .sc-dt-button.sc-danger:hover:not(:disabled){color:var(--sc-danger,${DARK.danger})}
.sc-workspace .sc-dt-swatch{display:block;width:18px;height:4px;border-radius:2px;border:1px solid var(--sc-border,${DARK.divider})}
.sc-workspace .sc-dt-swatch[data-empty=true]{background:linear-gradient(135deg,transparent 45%,var(--sc-muted,${DARK.muted}) 45% 55%,transparent 55%)!important}
.sc-workspace .sc-dt-text{font-variant-numeric:tabular-nums}
.sc-workspace .sc-dt-preview{display:inline-block;width:22px;flex:none}
.sc-workspace .sc-dt-pop{position:absolute;z-index:1;top:calc(100% + 8px);min-width:150px;padding:6px;border:1px solid var(--sc-panel-border,${DARK.panelBorder});border-radius:var(--sc-panel-radius,8px);background:var(--sc-panel-background,${DARK.panel});box-shadow:var(--sc-panel-shadow,${DARK.panelShadow})}
.sc-workspace .sc-dt-pop[data-side=top]{top:auto;bottom:calc(100% + 8px)}
.sc-workspace .sc-dt-button{position:relative}
.sc-workspace .sc-dt-swatches{display:grid;grid-template-columns:repeat(8,22px);gap:4px;margin-bottom:6px}
.sc-workspace .sc-dt-chip{width:22px;height:22px;padding:0;border:1px solid var(--sc-border,${DARK.divider});border-radius:4px;cursor:pointer}
.sc-workspace .sc-dt-chip[aria-selected=true]{outline:2px solid var(--sc-accent,${DARK.accent});outline-offset:1px}
.sc-workspace .sc-dt-wide{display:flex;align-items:center;gap:6px;width:100%;margin-top:4px;padding:5px 8px;border:0;border-radius:var(--sc-radius-small,4px);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;white-space:nowrap}
.sc-workspace .sc-dt-wide:hover{background:var(--sc-hover-background,${DARK.hover})}
.sc-workspace .sc-dt-wide input[type=color]{width:22px;height:22px;padding:0;border:0;background:none}
.sc-workspace .sc-dt-wide input[type=range]{flex:1;min-width:90px;accent-color:var(--sc-accent,${DARK.accent})}
.sc-workspace .sc-dt-list{display:flex;flex-direction:column;gap:1px}
.sc-workspace .sc-dt-item{display:flex;align-items:center;gap:10px;width:100%;min-height:30px;padding:4px 10px;border:0;border-radius:var(--sc-radius-small,4px);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;white-space:nowrap}
.sc-workspace .sc-dt-item:hover:not(:disabled){background:var(--sc-hover-background,${DARK.hover})}
.sc-workspace .sc-dt-item:disabled{opacity:.4;cursor:not-allowed}
.sc-workspace .sc-dt-item[aria-selected=true]{color:var(--sc-accent,${DARK.accent});background:var(--sc-active-background,${DARK.active})}
.sc-workspace[data-headless=true] .sc-dt{display:none!important}
`
