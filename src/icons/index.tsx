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

// A shared icon registry (SC-074), started here and grown by later PRs. Chrome
// icons (period bar, drawing-editor toolbar, the drawing rail's chevron) are
// meant to move here one surface at a time — the drawing rail's own 65 tool
// glyphs stay a 22-grid, filled set in widget/drawing-bar/icons (SC-193 rounds
// their path data, but a full 28-grid redraw is future work, tracked with
// SC-074) because that is a large, purely visual redraw with no behaviour
// change, out of proportion to this PR's remaining scope.
//
// What actually lands now:
// - One 18x18, stroke/currentColor tier (`Svg`) for small chrome icons — the
//   same convention widget/drawing-toolbar/icons.tsx already established.
// - LockIcon / UnlockIcon / TrashIcon, on that tier, so the drawing-editor
//   toolbar (SC-058) stops reusing the rail's filled 22-grid lock/unlock/
//   remove glyphs at the wrong size and weight.
// - One MoreIcon (three dots), reused by the drawing-editor toolbar and the
//   top bar's overflow button instead of two near-identical hand-drawn copies
//   at different grids.
// - One CaretIcon (chevron), reused by the drawing rail's flyout affordance
//   instead of an inline one-off <path>.
//
// Every icon here is decorative: the control that shows it carries its own
// name in aria-label/title, so the svg is aria-hidden.
//
// Part of SUPer-Chart (Apache-2.0).

import type { Component, JSX } from 'solid-js'

/** The 18x18 chrome tier: small controls (toolbar buttons, overflow menus, the rail's flyout chevron). */
export const Svg: Component<{ children: JSX.Element, viewBox?: string, class?: string }> = props => (
  <svg class={`sc-icon${props.class !== undefined ? ` ${props.class}` : ''}`} viewBox={props.viewBox ?? '0 0 18 18'} aria-hidden="true">
    {props.children}
  </svg>
)

export const LockIcon: Component = () => (
  <Svg>
    <rect x="4" y="8" width="10" height="7.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <path d="M6.2 8V5.8a2.8 2.8 0 0 1 5.6 0V8" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <circle cx="9" cy="11.6" r="0.9" fill="currentColor"/>
  </Svg>
)

export const UnlockIcon: Component = () => (
  <Svg>
    <rect x="4" y="8" width="10" height="7.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <path d="M6.2 8V5.8a2.8 2.8 0 0 1 5.5-0.7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    <circle cx="9" cy="11.6" r="0.9" fill="currentColor"/>
  </Svg>
)

export const TrashIcon: Component = () => (
  <Svg>
    <path d="M3.5 5.5h11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M7 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <path d="M5 5.5l0.6 9.2a1.2 1.2 0 0 0 1.2 1.1h4.4a1.2 1.2 0 0 0 1.2-1.1l0.6-9.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M7.3 8v5M9 8v5M10.7 8v5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
  </Svg>
)

export const MoreIcon: Component = () => (
  <Svg>
    <circle cx="4" cy="9" r="1.4" fill="currentColor"/>
    <circle cx="9" cy="9" r="1.4" fill="currentColor"/>
    <circle cx="14" cy="9" r="1.4" fill="currentColor"/>
  </Svg>
)

/** A small chevron, used by the drawing rail's flyout affordance (SC-011). */
export const CaretIcon: Component<{ class?: string }> = props => (
  <Svg class={props.class} viewBox="0 0 10 10">
    <path d="M3.2 1.6l3.6 3.4-3.6 3.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </Svg>
)

/** Every icon-class SVG the icons above can produce, for a viewBox contract test. */
export const KNOWN_VIEWBOXES = ['0 0 18 18', '0 0 10 10'] as const
