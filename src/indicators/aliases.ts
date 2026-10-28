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
 * Name aliasing for the SC_* indicator pack (SC-155/SC-160/SC-167).
 *
 * klinecharts' indicator registry is a peer singleton shared with a host's own
 * raw charts (SupWallet's LiveChart/TAChart). Super Chart never overwrites the
 * built-ins 'RSI', 'MACD' or 'SMA' there: it registers namespaced templates
 * (SC_RSI, SC_MACD, SC_SMA) with corrected math, and resolves the plain name to
 * the SC_ one only on paths the engine owns — the indicator picker, the
 * mainIndicators/subIndicators options, and the v2 addIndicator/updateIndicator
 * API. A host that calls `getChart().createIndicator('RSI')` directly still
 * gets klinecharts' own (Cutler, zero-on-flat-losses) built-in, unchanged,
 * until it moves to the SC_ name or the v2 API itself.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */

/** Plain klinecharts name -> the SC_* template that replaces it on engine paths. */
export const INDICATOR_ALIASES: Readonly<Record<string, string>> = {
  RSI: 'SC_RSI',
  MACD: 'SC_MACD',
  SMA: 'SC_SMA'
}

/** The reverse of INDICATOR_ALIASES, for UI that needs to show the public name for an SC_ one. */
export const INDICATOR_ALIAS_SOURCE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(INDICATOR_ALIASES).map(([from, to]) => [to, from])
)

/**
 * The name an engine-owned path should create/read instead of `name`. Anything
 * not in the table (including 'MA', 'EMA', 'BOLL', 'VOL', 'COMPARE', and any
 * host or script indicator) passes through unchanged.
 */
export function resolveIndicatorName (name: string): string {
  return INDICATOR_ALIASES[name] ?? name
}

/** True when `name` is one of the SC_ replacement templates this module aliases to. */
export function isAliasTarget (name: string): boolean {
  return name in INDICATOR_ALIAS_SOURCE
}
