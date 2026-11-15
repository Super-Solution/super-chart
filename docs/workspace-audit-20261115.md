# Workspace UI audit — 2026-11-15

Scope: the owned Web workspace shell. The changes below are implemented in
`packages/bindings/web/src/workspace.ts` and `workspaceStyle.ts`; the new
`WorkspaceAppearanceOptions` type is also exported from the Web entry. Existing
feed, chart, drawing and replay APIs remain in use. Nothing is mirrored into the
SupWallet monorepo. This is not a publication or deployment record.

The table records 15 substantive areas and 30 concrete interface details. It is
an implementation inventory, not 30 added tests or a performance score.

| Area | Detail A implemented | Detail B implemented | Source evidence |
| --- | --- | --- | --- |
| 1. Market-first layout | Symbol and interval remain immediately available in the first row. | Advanced chart controls move out of the always-expanded toolbar. | Constructor: `toolbar`, `presentation`; `.sc-marketbar` |
| 2. Presentation panels | Chart type, price mode and scale are grouped in an overlay panel rather than taking chart height. | Panels close on Escape/outside click and close other open settings; Escape restores summary focus. | `menu()`, document pointer handler; `.sc-menu-panel` |
| 3. Indicator management | Indicator controls live in a dedicated panel with the active indicator count. | The no-indicator state is explicit and Remove no longer repeats the entire indicator description. | `refreshIndicators`, `indicatorAdd`, `.sc-indicator-list` |
| 4. Indicator editing | Enter applies comma-separated parameter edits using the existing chart validation. | Pane-group editing is enabled only for separate panes; price-pane apply clears the irrelevant group. | `params.onkeydown`, `pane.onchange`, apply action |
| 5. Editor continuity | Expanded indicator editors survive their own updates. | Apply/show/hide preserve editor focus; removal returns focus to the Indicators summary. | `refreshIndicators` expanded/focus capture and restoration |
| 6. Drawing-tool navigation | All drawing types are organised into nine native optgroups. | The drawing row scrolls horizontally instead of stacking multiple rows over the chart. | `toolGroups`; `.sc-drawingbar` |
| 7. Drawing state feedback | Lock/Unlock exposes its pressed state and requires a selection. | A locked drawing's disabled Delete action explains that it must first be unlocked. | `updateDrawingControls` |
| 8. Replay transport | Advanced playback controls appear only while replay is active. | Previous and next disable at their corresponding replay bounds; replay cannot start with fewer than three bars. | `replayControls`, `updateReplay` |
| 9. Replay orientation and keyboard focus | Replay shows the current index, total bars and UTC timestamp. | When a focused replay control hides, focus moves to an available transport/start control without stealing focus on ordinary updates. | `updateReplay` entering/leaving logic |
| 10. Symbol-search readability | Search has a full-width input, clear heading and close control. | Results separate ticker from name/exchange, with explicit busy/empty/retry feedback. | Search construction, `queueSearch`, `search`; `.sc-search-result` |
| 11. Load-state visibility | Loading, empty and failed loads are visible in the chart stage instead of leaving unexplained blank space. | The status announcement and existing Retry operation remain available while chart interactions are hidden/inert. | `stageStatus`, `updateStatus`; `.sc-stage-status` |
| 12. Live-update DOM work | Unchanged load-state UI is skipped using a presentation-state signature. | Repeated identical status/countdown/replay text is not rewritten through `setText`. | `reportedStatusUI`, `setText`, countdown callback |
| 13. Export and fullscreen feedback | A pending PNG export disables repeated clicks, displays progress and restores its control on success/failure. | Fullscreen updates both its action label and pressed state. | `download()`, fullscreen-change handler |
| 14. Host customisation | Hosts can add root classes or inherit/set scoped `--sc-*` variables without a UI framework. | Compact/comfortable density and coarse-pointer control sizes are separate from Canvas presentation settings. | `WorkspaceAppearanceOptions`, constructor; stylesheet density/pointer selectors |
| 15. Consistent control affordances | Keyboard focus rings and pressed-state treatments are visible across buttons, selects and settings summaries. | Disabled controls avoid hover affordances; forced-colour mode retains disabled/pressed distinctions. | `.sc-button`, `.sc-select`, `:focus-visible`, forced-colours rules |

## Review and validation

Independent source review found and fixed a replay keyboard-focus regression:
hiding the entry/exit control previously left focus on the document body. The
implementation now checks the transition and the affected focused control before
moving focus. A Windows text-encoding mistake in one edit was also corrected
without reverting the implementation.

A TypeScript compiler check over the existing core, Web and SuperScript runtime
files succeeded with 76 files and zero diagnostics. The final check after the
review corrections is reported in the task result. The repository's ordinary
`node_modules` TypeScript/ESLint entrypoints are absent; no dependencies were
installed. The check used the already-cached TypeScript 4.9.5 compiler. Chat-plugin
is excluded from this scoped compiler run because its super-protocol dependency
is not installed; this is not a claim that the entire repository typecheck passed.

No test cases, assertions, fixtures, visual snapshots or CI workflows were added.
No tests were created merely to enforce these labels, classes or visual choices.
Browser observations and renderer timings belong to the integration report;
these shell changes do not establish a renderer speedup by themselves.

## Remaining work / limitations

- Native screen-reader and device touch ergonomics still need user-facing manual
  evaluation; this source review is not a WCAG certification.
- Workspace tokens style DOM chrome only. A light Canvas theme must be configured
  through the existing chart rendering options as well.
- Settings are local runtime presentation. Exported documents do not persist
  arbitrary host CSS classes or CSS-variable values.
- Very short embed heights and host-driven resizes while a settings panel is
  already open merit manual layout checks. No universal minimum usable viewport
  is claimed from a desktop side-by-side preview.
- This round does not add order entry, real-account controls or trading actions.

See [Workspace interface](WORKSPACE-UI.md) for the theme API and supported tokens.
