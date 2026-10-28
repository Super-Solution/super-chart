/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Every i18n key the drawing editor's UI shows — the floating toolbar, the
// right-click context menu (contextMenu.tsx), the inline text/image editor
// (textEditor.tsx) and the objects panel (objects-panel) — in one place so a
// test can check that each exists in every locale file.
// Part of SUPer-Chart (Apache-2.0).

import type { LineStyleKind } from './styles'

export const TOOLBAR_LABELS = {
  toolbar: 'drawing_toolbar',
  drag: 'drag_to_move',
  lineColor: 'line_color',
  textColor: 'text_color',
  lineWidth: 'line_width',
  lineStyle: 'line_style',
  color: 'color',
  opacity: 'opacity',
  customColor: 'custom_color',
  // SC-150: shown under the hex field when parseHexInput rejects the text.
  invalidHex: 'invalid_hex_color',
  lock: 'lock_drawing',
  unlock: 'unlock_drawing',
  remove: 'delete_drawing',
  more: 'more_actions',
  clone: 'clone_drawing',
  bringToFront: 'bring_to_front',
  sendToBack: 'send_to_back',
  hide: 'hide_drawing',
  // SC-090 (contextMenu.tsx)
  contextMenu: 'drawing_context_menu',
  // SC-093 (textEditor.tsx)
  editText: 'edit_drawing_text',
  imageUrl: 'image_url_label',
  imageUrlPlaceholder: 'image_url_placeholder',
  imageLoadError: 'image_load_error',
  // Localized default text per text-typed tool, prefilled and selected when
  // it is placed (SC-093).
  textDefaultText: 'text_tool_default_text',
  textDefaultNote: 'text_tool_default_note',
  textDefaultCallout: 'text_tool_default_callout',
  textDefaultSignpost: 'text_tool_default_signpost',
  // SC-151 (objects-panel)
  objectsPanelTitle: 'objects_panel_title',
  objectsPanelEmpty: 'objects_panel_empty',
  objectsPanelShow: 'objects_panel_show'
} as const

export const LINE_STYLE_LABELS: Record<LineStyleKind, string> = {
  solid: 'line_style_solid',
  dashed: 'line_style_dashed',
  dotted: 'line_style_dotted'
}
