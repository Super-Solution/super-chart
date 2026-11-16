# React example

`SuperChart` under React Strict Mode: market and interval from state, theme toggle, an event hook, a host-owned
take-profit level the person can drag (a request, not a change), hold-to-draw, and Save/Restore through
[`../workspace-persistence`](../workspace-persistence/README.md).

**Target:** react. **Run:** `npm run examples` at the repository root and pick *React* (or `npm run dev`, then open
`/examples/react/index.html`). The root Vite config resolves the package sources, so no build is needed. Data comes
from [`../_shared/feed.ts`](../_shared/feed.ts).

What it demonstrates:

- the datafeed is created once at module level; a new feed would mount a new chart;
- `symbol`, `period` and `theme` are props and the mounted chart follows them (`setMarket` underneath, no remount);
- `onReady` hands over the `ChartWorkspace`; `useWorkspaceEvent(workspace, 'loadResult', …)` listens from outside;
- host marks go through `workspace.annotations.setAnnotations` after each `dataChange` reset, and a drag arrives as
  `onAnnotationIntent` with `phase: 'commit'`; refusing it means not writing the price;
- Strict Mode is on, so development mounts, disposes and mounts again, and the page must still show one chart.
