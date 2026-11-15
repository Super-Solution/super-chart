/** Scoped DOM chrome; host styles can override --sc-* tokens without changing Canvas. */
export const WORKSPACE_STYLE = `
.sc-workspace{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:280px;box-sizing:border-box;background:var(--sc-background,#10151d);color:var(--sc-text,#d6deea);font:var(--sc-font-size,12px)/1.4 var(--sc-font,system-ui,-apple-system,"Segoe UI",sans-serif);color-scheme:var(--sc-color-scheme,dark);isolation:isolate}
.sc-workspace *, .sc-workspace *::before, .sc-workspace *::after{box-sizing:border-box}
.sc-workspace [hidden]{display:none!important}
.sc-workspace .sc-row{display:flex;align-items:center;gap:6px;min-width:0;padding:5px 8px;flex-shrink:0;border-bottom:1px solid var(--sc-border,#27313e);background:var(--sc-toolbar-background,#131b25)}
.sc-workspace .sc-marketbar{flex-wrap:wrap;min-height:42px}
.sc-workspace .sc-drawingbar{overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;white-space:nowrap;min-height:39px}
.sc-workspace .sc-button,.sc-workspace .sc-select,.sc-workspace .sc-input,.sc-workspace .sc-menu>summary{font:inherit;line-height:1.3;min-height:var(--sc-control-height,28px);border:1px solid var(--sc-control-border,#344150);border-radius:var(--sc-radius,4px);background:var(--sc-control-background,#19232f);color:var(--sc-text,#d6deea);padding:5px 8px;margin:0}
.sc-workspace .sc-button,.sc-workspace .sc-menu>summary{cursor:pointer;white-space:nowrap;flex-shrink:0;user-select:none;touch-action:manipulation}
.sc-workspace .sc-select{cursor:pointer;max-width:190px;min-width:0;accent-color:var(--sc-accent,#77b6f5)}
.sc-workspace .sc-input{width:100%;min-width:0;outline-offset:2px}
.sc-workspace .sc-button:hover:not(:disabled),.sc-workspace .sc-menu>summary:hover,.sc-workspace .sc-select:hover:not(:disabled){background:var(--sc-hover-background,#253444);border-color:var(--sc-hover-border,#596b80)}
.sc-workspace .sc-button:disabled,.sc-workspace .sc-select:disabled,.sc-workspace .sc-input:disabled{opacity:.4;cursor:not-allowed}
.sc-workspace .sc-button:focus-visible,.sc-workspace .sc-select:focus-visible,.sc-workspace .sc-input:focus-visible,.sc-workspace summary:focus-visible{outline:2px solid var(--sc-focus,#77b6f5);outline-offset:2px}
.sc-workspace .sc-button[aria-pressed=true],.sc-workspace .sc-menu[open]>summary{border-color:var(--sc-accent,#77b6f5);color:var(--sc-accent,#77b6f5);background:var(--sc-active-background,#203146)}
.sc-workspace .sc-primary{border-color:var(--sc-accent,#77b6f5);color:var(--sc-accent,#77b6f5)}
.sc-workspace .sc-danger:hover:not(:disabled){color:var(--sc-danger,#f6a69e);border-color:var(--sc-danger,#f6a69e)}
.sc-workspace .sc-symbol{font-weight:650;background:transparent;border-color:transparent;max-width:180px;overflow:hidden;text-overflow:ellipsis;text-align:left}
.sc-workspace .sc-symbol::after{content:'⌕';margin-left:10px;color:var(--sc-muted,#94a3b8)}
.sc-workspace .sc-field{display:flex;align-items:center;gap:6px;min-width:0;margin:0}
.sc-workspace .sc-field-label{font-size:11px;color:var(--sc-muted,#94a3b8);white-space:nowrap}
.sc-workspace .sc-marketbar>.sc-field>.sc-field-label,.sc-workspace .sc-drawingbar>.sc-field>.sc-field-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.sc-workspace .sc-menu{position:static;flex-shrink:0}
.sc-workspace .sc-menu>summary{display:flex;align-items:center;gap:8px;list-style:none}
.sc-workspace .sc-menu>summary::-webkit-details-marker{display:none}
.sc-workspace .sc-menu>summary::after{content:'⌄';font-size:11px;color:var(--sc-muted,#94a3b8)}
.sc-workspace .sc-menu-panel,.sc-workspace .sc-search{position:absolute;z-index:8;top:46px;left:8px;right:8px;max-width:520px;max-height:calc(100% - 58px);overflow:auto;overscroll-behavior:contain;border:1px solid var(--sc-panel-border,#43546a);border-radius:var(--sc-panel-radius,6px);background:var(--sc-panel-background,#17212d);box-shadow:var(--sc-panel-shadow,0 10px 30px #0005);padding:12px}
.sc-workspace .sc-menu:not([open])>.sc-menu-panel{display:none}
.sc-workspace .sc-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sc-workspace .sc-settings-grid>.sc-field,.sc-workspace .sc-indicator-editor>.sc-field{flex-direction:column;align-items:stretch;gap:5px}
.sc-workspace .sc-settings-grid .sc-select,.sc-workspace .sc-indicator-editor .sc-select{max-width:none;width:100%}
.sc-workspace .sc-indicator-add{display:flex;align-items:end;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--sc-border,#344150)}
.sc-workspace .sc-indicator-add>.sc-field{flex:1;align-items:stretch;flex-direction:column}
.sc-workspace .sc-indicator-add .sc-select{max-width:none;width:100%}
.sc-workspace .sc-indicator-list{display:flex;flex-direction:column;gap:8px;padding-top:10px}
.sc-workspace .sc-indicator-entry{display:flex;align-items:flex-start;gap:8px;padding:8px;border:1px solid var(--sc-border,#344150);border-radius:var(--sc-radius,4px)}
.sc-workspace .sc-indicator{flex:1;min-width:0}
.sc-workspace .sc-indicator>summary{cursor:pointer;padding:5px 0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.sc-workspace .sc-indicator-editor{display:grid;gap:10px;margin-top:10px;grid-template-columns:1fr 1fr}
.sc-workspace .sc-indicator-editor>.sc-field:first-child,.sc-workspace .sc-actions{grid-column:1/-1}
.sc-workspace .sc-actions{display:flex;gap:6px;flex-wrap:wrap}
.sc-workspace .sc-hint{color:var(--sc-muted,#94a3b8);margin:4px 0}
.sc-workspace .sc-stage{position:relative;flex:1;min-height:160px;min-width:0}
.sc-workspace .sc-chart{position:absolute;inset:0}
.sc-workspace .sc-stage-status{position:absolute;inset:0;display:grid;place-content:center;padding:24px;color:var(--sc-muted,#94a3b8);text-align:center;overflow-wrap:anywhere;pointer-events:none}
.sc-workspace[data-state=error] .sc-stage-status{color:var(--sc-danger,#f6a69e)}
.sc-workspace .sc-notice{flex-shrink:0;padding:8px 12px;color:var(--sc-danger,#f6a69e);background:var(--sc-error-background,#301e25);border-bottom:1px solid var(--sc-border,#344150);overflow-wrap:anywhere}
.sc-workspace .sc-notice:empty{display:none}
.sc-workspace .sc-footer{flex-wrap:wrap;border-top:1px solid var(--sc-border,#27313e);border-bottom:0;min-height:36px;font-size:11px}
.sc-workspace .sc-status{flex:1;min-width:120px;overflow-wrap:anywhere;color:var(--sc-muted,#94a3b8)}
.sc-workspace .sc-countdown{font-variant-numeric:tabular-nums;color:var(--sc-muted,#94a3b8);white-space:nowrap}
.sc-workspace .sc-countdown:empty{display:none}
.sc-workspace .sc-replay-controls{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 8px;border-top:1px solid var(--sc-border,#344150);background:var(--sc-toolbar-background,#131b25)}
.sc-workspace .sc-replay-info{font-variant-numeric:tabular-nums;color:var(--sc-muted,#94a3b8);font-size:11px;overflow-wrap:anywhere}
.sc-workspace .sc-panel-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
.sc-workspace .sc-panel-header h2{font:inherit;font-size:14px;font-weight:600;margin:0}
.sc-workspace .sc-search{z-index:10}
.sc-workspace .sc-search-input{width:100%;font-size:14px;min-height:36px}
.sc-workspace .sc-search-status{font-size:11px;color:var(--sc-muted,#94a3b8);padding:9px 0;min-height:32px}
.sc-workspace .sc-search-results{list-style:none;margin:0;padding:0;max-height:260px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
.sc-workspace .sc-search-results li+li{margin-top:4px}
.sc-workspace .sc-search-result{display:flex;align-items:center;gap:12px;width:100%;text-align:left;min-height:38px;white-space:normal}
.sc-workspace .sc-search-result strong{min-width:70px;flex-shrink:0}
.sc-workspace .sc-search-result span{color:var(--sc-muted,#94a3b8);font-size:11px;overflow-wrap:anywhere}
.sc-workspace[data-density=comfortable] .sc-button,.sc-workspace[data-density=comfortable] .sc-select,.sc-workspace[data-density=comfortable] .sc-input,.sc-workspace[data-density=comfortable] .sc-menu>summary{min-height:var(--sc-control-height,36px)}
.sc-workspace:fullscreen{min-height:0;background:var(--sc-background,#10151d)}
@media(pointer:coarse){.sc-workspace .sc-button,.sc-workspace .sc-select,.sc-workspace .sc-menu>summary{min-height:var(--sc-touch-target,36px)}}
@media(forced-colors:active){.sc-workspace .sc-button[aria-pressed=true],.sc-workspace .sc-menu[open]>summary{outline:2px solid Highlight}.sc-workspace .sc-button:disabled{opacity:1;color:GrayText}}
`
