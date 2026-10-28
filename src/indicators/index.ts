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

/**
 * Barrel for the SC_* indicator pack: registration, name aliasing, the
 * indicator/drawing-tool catalogue, reference levels and the tail-update
 * helper. ChartProComponent and the widget layer import from here, not from
 * the individual template files.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
export { registerScIndicators, SC_INDICATOR_NAMES } from './register'
export { resolveIndicatorName, isAliasTarget, INDICATOR_ALIASES, INDICATOR_ALIAS_SOURCE } from './aliases'
export { levelsFor, INDICATOR_LEVELS } from './levels'
export type { LevelLine } from './levels'
export {
  getIndicatorCatalog, addIndicatorCatalogEntries, setIndicatorCatalog, resetIndicatorCatalog,
  catalogEntryFor, isScReplacement, registerCatalogedScriptIndicator, getDrawingToolCatalog
} from './catalog'
export type {
  IndicatorCatalogEntry, IndicatorCatalogParam, IndicatorCatalogPreset, IndicatorCategory, IndicatorPane, IndicatorSource,
  DrawingToolCatalogEntry
} from './catalog'
