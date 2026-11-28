// SPDX-License-Identifier: GPL-3.0-or-later
import type { DrawingType } from '@supersolutions/super-chart-core'

/** What a hotkey does: arm a drawing tool, or run one of the workspace's own actions. */
export type HotkeyAction = { readonly tool: DrawingType } | { readonly action: 'resetView' | 'screenshot' | 'goToDate' }
export interface Hotkey { readonly code: string, readonly shift: boolean, readonly action: HotkeyAction, readonly label: string }

const hotkey = (code: string, action: HotkeyAction, shift = false): Hotkey => Object.freeze({ code, shift, action, label: `Alt+${shift ? 'Shift+' : ''}${code.replace(/^Key/, '')}` })

/** The Alt shortcuts, the same letters other charting tools use for the same drawings. They go by physical key (`code`), so a layout or the Option key on a Mac does not change them. */
export const HOTKEYS: readonly Hotkey[] = Object.freeze([
  hotkey('KeyT', { tool: 'segment' }),
  hotkey('KeyH', { tool: 'horizontal' }),
  hotkey('KeyJ', { tool: 'horizontal-ray' }),
  hotkey('KeyV', { tool: 'vertical' }),
  hotkey('KeyF', { tool: 'fibonacci' }),
  hotkey('KeyI', { tool: 'pitchfork' }),
  hotkey('KeyR', { tool: 'rectangle' }, true),
  hotkey('KeyR', { action: 'resetView' }),
  hotkey('KeyS', { action: 'screenshot' }),
  hotkey('KeyG', { action: 'goToDate' })
])

/** The hotkey for a key event (Alt held, no Ctrl or Meta), or null. */
export function hotkeyFor (event: { readonly code: string, readonly altKey: boolean, readonly ctrlKey: boolean, readonly metaKey: boolean, readonly shiftKey: boolean }): Hotkey | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null
  return HOTKEYS.find(item => item.code === event.code && item.shift === event.shiftKey) ?? null
}

/** The shortcut label of the hotkey that arms this drawing tool, if it has one. */
export function toolHotkey (tool: DrawingType): string | undefined {
  return HOTKEYS.find(item => 'tool' in item.action && item.action.tool === tool)?.label
}
