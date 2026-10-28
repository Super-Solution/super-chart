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

// Small pure helpers for the chrome's popovers (menus, the select's list),
// kept apart from the components so they can be unit-tested.
//
// Part of SUPer-Chart (Apache-2.0).

/** Where a menu goes: under its trigger, inside the container's width (SC-064). */
export function placeMenu (anchor: { left: number, bottom: number, top: number }, menuWidth: number, containerWidth: number): { left: number, top: number } {
  const left = Math.max(0, Math.min(anchor.left, containerWidth - menuWidth))
  return { left, top: anchor.bottom }
}

/** The scrollTop that centres a row in a list, within the list's range (SC-060). */
export function centredScrollTop (rowTop: number, rowHeight: number, listHeight: number, scrollHeight: number): number {
  const top = rowTop - (listHeight - rowHeight) / 2
  return Math.max(0, Math.min(top, Math.max(0, scrollHeight - listHeight)))
}

/** Type-ahead: the text, or the text after a leading "(UTC+8) ", starts with what was typed. */
export function matchesTyped (text: string, typed: string): boolean {
  const t = text.toLowerCase()
  return t.startsWith(typed) || t.replace(/^\([^)]*\)\s*/, '').startsWith(typed)
}
