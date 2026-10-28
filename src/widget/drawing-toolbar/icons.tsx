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

// Inline SVG icons for the drawing toolbar. They draw with currentColor so the
// toolbar's CSS variables theme them. Part of SUPer-Chart (Apache-2.0).
//
// LockIcon / UnlockIcon / TrashIcon and MoreIcon come from the shared icon
// registry (src/icons, SC-074) instead of being drawn here or reused from the
// rail's filled 22-grid glyphs (SC-058): one 18-grid, stroke-based source for
// every small chrome icon.

import { Component, JSX } from 'solid-js'

import type { LineStyleKind } from '../../drawing-editor/styles'
import { LockIcon, UnlockIcon, TrashIcon, MoreIcon } from '../../icons'

export { LockIcon, UnlockIcon, TrashIcon, MoreIcon }

const Svg: Component<{ children: JSX.Element, viewBox?: string }> = props => (
  <svg class="toolbar-icon" viewBox={props.viewBox ?? '0 0 18 18'} aria-hidden="true">
    {props.children}
  </svg>
)

export const GripIcon: Component = () => (
  <Svg viewBox="0 0 10 18">
    <circle cx="3" cy="4" r="1.3" fill="currentColor"/>
    <circle cx="7" cy="4" r="1.3" fill="currentColor"/>
    <circle cx="3" cy="9" r="1.3" fill="currentColor"/>
    <circle cx="7" cy="9" r="1.3" fill="currentColor"/>
    <circle cx="3" cy="14" r="1.3" fill="currentColor"/>
    <circle cx="7" cy="14" r="1.3" fill="currentColor"/>
  </Svg>
)

export const PencilIcon: Component = () => (
  <Svg>
    <path d="M11.8 2.6l3.6 3.6-8.6 8.6H3.2v-3.6z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M10.2 4.2l3.6 3.6" fill="none" stroke="currentColor" stroke-width="1.3"/>
  </Svg>
)

export const TextIcon: Component = () => (
  <Svg>
    <path d="M3.5 4h11M9 4v11M6.5 15h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </Svg>
)

export const CloneIcon: Component = () => (
  <Svg>
    <rect x="6" y="6" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <path d="M12 6V4.5A1.5 1.5 0 0 0 10.5 3h-6A1.5 1.5 0 0 0 3 4.5v6A1.5 1.5 0 0 0 4.5 12H6" fill="none" stroke="currentColor" stroke-width="1.3"/>
  </Svg>
)

export const FrontIcon: Component = () => (
  <Svg>
    <rect x="3" y="7" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5"/>
    <rect x="7" y="3" width="8" height="8" rx="1" fill="currentColor"/>
  </Svg>
)

export const BackIcon: Component = () => (
  <Svg>
    <rect x="7" y="3" width="8" height="8" rx="1" fill="currentColor"/>
    <rect x="3" y="7" width="8" height="8" rx="1" fill="var(--klinecharts-pro-popover-background-color)" stroke="currentColor" stroke-width="1.2"/>
  </Svg>
)

export const HideIcon: Component = () => (
  <Svg>
    <path d="M2 9s2.6-4.5 7-4.5S16 9 16 9s-2.6 4.5-7 4.5S2 9 2 9z" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <circle cx="9" cy="9" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <path d="M3 15L15 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  </Svg>
)

/** A short horizontal line of the given thickness (width picker). */
export const WidthGlyph: Component<{ width: number }> = props => (
  <svg class="toolbar-glyph" viewBox="0 0 24 12" aria-hidden="true">
    <line x1="2" y1="6" x2="22" y2="6" stroke="currentColor" stroke-width={Math.min(4, Math.max(1, props.width))} stroke-linecap="butt"/>
  </svg>
)

const DASH: Record<LineStyleKind, string | undefined> = {
  solid: undefined,
  dashed: '5 3',
  dotted: '1.5 2'
}

/** A short line in the given style (style picker and its button). */
export const StyleGlyph: Component<{ style: LineStyleKind }> = props => (
  <svg class="toolbar-glyph" viewBox="0 0 24 12" aria-hidden="true">
    <line x1="2" y1="6" x2="22" y2="6" stroke="currentColor" stroke-width="2" stroke-dasharray={DASH[props.style]}/>
  </svg>
)
