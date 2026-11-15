# @supersolutions/super-chart-react

The [Super Chart](https://github.com/Super-Solution/super-chart) workspace as a React component.

```tsx
import { SuperChart } from '@supersolutions/super-chart-react'

// Create the datafeed once, outside the component (or useMemo it): a new datafeed mounts a new chart.
const datafeed = createMyDatafeed()

export function Market ({ ticker, period }: { ticker: string, period: string }) {
  return (
    <div style={{ height: 520 }}>
      <SuperChart
        datafeed={datafeed}
        symbol={{ ticker, exchange: 'XNAS' }}
        period={period}              // '15m', or a Period object; compared by value
        theme="dark"
        locale="en"
        onMarketChange={event => console.log(event.requested)}
      />
    </div>
  )
}
```

- **Lifecycle.** The workspace is created in an effect and disposed on unmount, so it is safe to server-render and under
  React Strict Mode (development mounts, disposes and mounts again; no request or subscription outlives its chart).
- **Props that follow.** `symbol`, `period`, `theme`, `locale` and `ui` update the mounted chart. A market switch is
  `setMarket`: the previous request is superseded, the drawings of the previous market are saved, and nothing is remounted.
- **Props read once.** `chart`, `loader`, `search`, `commands`, `contextMenu`, `drawingCache`, `countdown` and `periods` are
  read when the chart mounts. `datafeed` is a new source of data: changing its identity mounts a new chart.
- **The workspace.** The ref and `onReady` give the `ChartWorkspace`, for everything imperative: `annotations`,
  `registerCommand`, `exportDocument`, `restoreDocument`, `chart.setDrawByHolding`, replay.
- **Events.** `onMarketChange`, `onLoadState`, `onLoadResult`, `onDataChange`, `onReplayChange`, `onAnnotationIntent`.
  Handlers may change on every render; the latest one is always called. `useWorkspaceEvent(workspace, type, listener)`
  does the same from a component that holds the workspace.
- **Size the container.** The chart fills its parent; give the parent a height.

React 18 or newer is a peer dependency; nothing else is bundled. GPL-3.0-or-later.
