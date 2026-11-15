import { useEffect, useRef } from 'react'
import type { ChartWorkspace, WorkspaceEvents } from '@supersolutions/super-chart-web'

/**
 * Subscribe to a workspace event from a component that holds the workspace (for example from `SuperChart`'s `onReady`
 * or its ref). The listener may change every render without resubscribing; the subscription ends on unmount or when
 * the workspace changes. Pass `null` while there is no workspace yet.
 */
export function useWorkspaceEvent<K extends keyof WorkspaceEvents> (workspace: ChartWorkspace | null, type: K, listener: (event: WorkspaceEvents[K]) => void): void {
  const latest = useRef(listener)
  latest.current = listener
  useEffect(() => {
    if (workspace === null) return
    return workspace.on(type, event => { latest.current(event) })
  }, [workspace, type])
}
