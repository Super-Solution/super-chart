import { WORKSPACE_THEMES } from './theme'
import { FONT_SANS } from './tokens'

/** Without a `theme` option the chrome falls back to the dark preset, the same values `setTheme('dark')` sets. */
const DARK = WORKSPACE_THEMES.dark.chrome

/** Scoped DOM chrome; host styles can override --sc-* tokens without changing Canvas. */
export const WORKSPACE_STYLE = `
.sc-workspace{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:280px;box-sizing:border-box;background:var(--sc-background,${DARK.background});color:var(--sc-text,${DARK.text});font:var(--sc-font-size,12px)/1.4 var(--sc-font,${FONT_SANS});color-scheme:var(--sc-color-scheme,${DARK.colorScheme});isolation:isolate}
.sc-workspace *, .sc-workspace *::before, .sc-workspace *::after{box-sizing:border-box}
.sc-workspace [hidden]{display:none!important}
.sc-workspace .sc-row{display:flex;align-items:center;gap:6px;min-width:0;padding:5px 8px;flex-shrink:0;border-bottom:1px solid var(--sc-border,${DARK.divider});background:var(--sc-toolbar-background,${DARK.toolbar})}
.sc-workspace .sc-marketbar{flex-wrap:wrap;min-height:42px}
.sc-workspace .sc-drawingbar{overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;white-space:nowrap;min-height:39px}
.sc-workspace .sc-button,.sc-workspace .sc-select,.sc-workspace .sc-input,.sc-workspace .sc-menu>summary{font:inherit;line-height:1.3;min-height:var(--sc-control-height,28px);border:1px solid var(--sc-control-border,${DARK.border});border-radius:var(--sc-radius,4px);background:var(--sc-control-background,${DARK.surface});color:var(--sc-text,${DARK.text});padding:5px 8px;margin:0}
.sc-workspace .sc-button,.sc-workspace .sc-menu>summary{cursor:pointer;white-space:nowrap;flex-shrink:0;user-select:none;touch-action:manipulation}
.sc-workspace .sc-select{cursor:pointer;max-width:190px;min-width:0;accent-color:var(--sc-accent,${DARK.accent})}
.sc-workspace .sc-input{width:100%;min-width:0;outline-offset:2px}
.sc-workspace .sc-button:hover:not(:disabled),.sc-workspace .sc-menu>summary:hover,.sc-workspace .sc-select:hover:not(:disabled){background:var(--sc-hover-background,${DARK.hover});border-color:var(--sc-hover-border,${DARK.hoverBorder})}
.sc-workspace .sc-button:disabled,.sc-workspace .sc-select:disabled,.sc-workspace .sc-input:disabled{opacity:.4;cursor:not-allowed}
.sc-workspace .sc-button:focus-visible,.sc-workspace .sc-select:focus-visible,.sc-workspace .sc-input:focus-visible,.sc-workspace summary:focus-visible{outline:2px solid var(--sc-focus,${DARK.focus});outline-offset:2px}
.sc-workspace .sc-button[aria-pressed=true],.sc-workspace .sc-menu[open]>summary{border-color:var(--sc-accent,${DARK.accent});color:var(--sc-accent,${DARK.accent});background:var(--sc-active-background,${DARK.active})}
.sc-workspace .sc-primary{border-color:var(--sc-accent,${DARK.accent});color:var(--sc-accent,${DARK.accent})}
.sc-workspace .sc-danger:hover:not(:disabled){color:var(--sc-danger,${DARK.danger});border-color:var(--sc-danger,${DARK.danger})}
.sc-workspace .sc-symbol{font-weight:650;background:transparent;border-color:transparent;max-width:180px;overflow:hidden;text-overflow:ellipsis;text-align:left}
.sc-workspace .sc-symbol::after{content:'⌕';margin-left:10px;color:var(--sc-muted,${DARK.muted})}
.sc-workspace .sc-field{display:flex;align-items:center;gap:6px;min-width:0;margin:0}
.sc-workspace .sc-field-label{font-size:11px;color:var(--sc-muted,${DARK.muted});white-space:nowrap}
.sc-workspace .sc-marketbar>.sc-field>.sc-field-label,.sc-workspace .sc-drawingbar>.sc-field>.sc-field-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.sc-workspace .sc-menu{position:static;flex-shrink:0}
.sc-workspace .sc-menu>summary{display:flex;align-items:center;gap:8px;list-style:none}
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
.sc-workspace .sc-stage{position:relative;flex:1;min-height:160px;min-width:0}
.sc-workspace .sc-chart{position:absolute;inset:0}
.sc-workspace .sc-stage-status{position:absolute;inset:0;display:grid;place-content:center;padding:24px;color:var(--sc-muted,${DARK.muted});text-align:center;overflow-wrap:anywhere;pointer-events:none}
.sc-workspace[data-state=error] .sc-stage-status{color:var(--sc-danger,${DARK.danger})}
.sc-workspace .sc-notice{flex-shrink:0;padding:8px 12px;color:var(--sc-danger,${DARK.danger});background:var(--sc-error-background,${DARK.error});border-bottom:1px solid var(--sc-border,${DARK.divider});overflow-wrap:anywhere}
.sc-workspace .sc-notice:empty{display:none}
.sc-workspace .sc-holdnote{flex-shrink:0;padding:4px 12px;font-size:12px;color:var(--sc-muted,${DARK.muted});border-bottom:1px solid var(--sc-border,${DARK.divider})}
.sc-workspace .sc-holdnote:empty{display:none}
.sc-workspace [data-hold-draw=armed]{cursor:crosshair}
.sc-workspace .sc-footer{flex-wrap:wrap;border-top:1px solid var(--sc-border,${DARK.divider});border-bottom:0;min-height:36px;font-size:11px}
.sc-workspace .sc-status{flex:1;min-width:120px;display:flex;align-items:center;flex-wrap:wrap;gap:8px;overflow-wrap:anywhere;color:var(--sc-muted,${DARK.muted})}
.sc-workspace .sc-ticker{font-weight:600;color:var(--sc-text,${DARK.text})}
.sc-workspace .sc-interval,.sc-workspace .sc-count,.sc-workspace .sc-venue{padding:1px 6px;border-radius:var(--sc-radius,4px);background:var(--sc-hover-background,${DARK.hover});color:var(--sc-text,${DARK.text});font-variant-numeric:tabular-nums;line-height:16px}
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
.sc-workspace[data-density=comfortable] .sc-button,.sc-workspace[data-density=comfortable] .sc-select,.sc-workspace[data-density=comfortable] .sc-input,.sc-workspace[data-density=comfortable] .sc-menu>summary{min-height:var(--sc-control-height,36px)}
.sc-workspace:fullscreen{min-height:0;background:var(--sc-background,${DARK.background})}
@media(pointer:coarse){.sc-workspace .sc-button,.sc-workspace .sc-select,.sc-workspace .sc-menu>summary{min-height:var(--sc-touch-target,36px)}}
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
.sc-workspace .sc-interval-button{flex:none;border-color:transparent;background:transparent;padding:4px 8px}
.sc-workspace .sc-icon-button .sc-icon{display:none;flex:none}
.sc-workspace .sc-icon-button{display:inline-flex;align-items:center;justify-content:center;gap:6px}
.sc-workspace .sc-icon-only .sc-icon,.sc-workspace:not([data-layout=regular]) .sc-icon-button .sc-icon{display:block}
.sc-workspace .sc-icon-only .sc-label,.sc-workspace:not([data-layout=regular]) .sc-drawingbar>.sc-icon-button .sc-label,.sc-workspace:not([data-layout=regular]) .sc-tools-toggle .sc-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.sc-workspace .sc-scalebar{margin-left:auto;padding:0;border:0;min-height:0;background:transparent;gap:4px}
.sc-workspace .sc-scalebar .sc-button{padding:2px 8px;min-height:24px}
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
.sc-workspace .sc-object-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;text-align:left;border-color:transparent}
.sc-workspace[data-headless=true] .sc-marketbar,.sc-workspace[data-headless=true] .sc-drawingbar,.sc-workspace[data-headless=true] .sc-footer,.sc-workspace[data-headless=true] .sc-notice,.sc-workspace[data-headless=true] .sc-holdnote,.sc-workspace[data-headless=true] .sc-replay-controls,.sc-workspace[data-headless=true] .sc-stage-status{display:none!important}
.sc-workspace[data-layout=compact] .sc-row,.sc-workspace[data-layout=narrow] .sc-row{padding:4px 6px;gap:4px}
.sc-workspace[data-layout=narrow] .sc-marketbar{flex-wrap:wrap}
.sc-workspace[data-layout=narrow] .sc-symbol{max-width:110px}
.sc-workspace[data-layout=narrow] .sc-menu>summary{padding:5px 6px}
.sc-workspace[data-layout=narrow] .sc-status{min-width:0}
`
