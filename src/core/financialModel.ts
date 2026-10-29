/** Extracted from SupWallet Mobile model.ts at de693554a; renderer/gesture independent. */
/** Pure measured-dp chart geometry, scaling and hit testing. Hosts own feeds. */
export type ChartX = string | number;
export type ChartAxis = 'left' | 'right';
export interface FinancialSeries { id: string; name: string; type: 'line' | 'area' | 'bar' | 'scatter'; points: ReadonlyArray<readonly [ChartX, number]>; color?: string; axis?: ChartAxis }
export interface FinancialCandle { t: ChartX; o: number; h: number; l: number; c: number; v?: number }
export interface FinancialAnnotation { id: string; type: 'hline' | 'vline' | 'band' | 'marker'; value: ChartX; to?: ChartX; label?: string; color?: string; axis?: ChartAxis }
export interface FinancialChartData { xType: 'category' | 'number' | 'time'; series?: readonly FinancialSeries[]; candles?: readonly FinancialCandle[]; annotations?: readonly FinancialAnnotation[]; scale?: 'auto' | 'zero' | 'tight'; stacked?: boolean }
export interface FinancialViewport { start: number; end: number }
export interface FinancialGeometry { width: number; height: number; left: number; right: number; top: number; bottom: number; plotWidth: number; plotHeight: number }
export interface ChartPoint { x: number; y: number; value: number; key: ChartX; index: number }
export type ChartCandlePoint = FinancialCandle & { x: number; bodyTop: number; bodyBottom: number; wickTop: number; wickBottom: number; index: number };
export interface FinancialChartModel { geometry: FinancialGeometry; min: number; max: number; yTicks: number[]; rightMin: number; rightMax: number; rightTicks: number[]; hasRightAxis: boolean; xKeys: ChartX[]; allKeys: ChartX[]; start: number; end: number; xPositions: number[]; xTickIndices: number[]; plottedSeries: Array<{ source: FinancialSeries; points: ChartPoint[] }>; plottedCandles: ChartCandlePoint[]; x: (key: ChartX, index: number) => number; y: (value: number, axis?: ChartAxis) => number }

/**
 * What the x axis IS, when the caller did not say.
 *
 * Both adapters guessed, and they guessed differently. `ChartCard` read
 * `xKind ?? (bar ? 'category' : 'number')`; `ChartCardView` sniffed the points
 * for a string. A legacy line chart carrying category labels (`'Mon'`) and
 * no `xKind` therefore resolved to `'number'` — and `chartKeys` drops every
 * key whose `numericX` is not finite, so the card rendered "No chart data"
 * over a complete series. One resolver, so the two cannot drift again.
 *
 * The order is what the data can actually prove:
 *
 * 1. A DECLARED type always wins — it is the only statement of intent here.
 * 2. Candles are stamped in time.
 * 3. A string x is a label. Not "a string that fails to parse as a number":
 *    `Date.parse` is generous enough to turn some labels into a timestamp, and
 *    a plot placed by an accidental date is worse than one placed by order.
 * 4. All-bar series have no continuum to sit on, so they sit in slots.
 * 5. Otherwise the keys are numbers and belong on a numeric line.
 */
export function resolveXType(
  declared: FinancialChartData['xType'] | undefined,
  source: {
    candles?: readonly unknown[];
    series?: ReadonlyArray<{ type?: string; points: ReadonlyArray<readonly [ChartX, number]> }>;
  },
): FinancialChartData['xType'] {
  if (declared) return declared;
  if (source.candles?.length) return 'time';
  const series = source.series ?? [];
  if (series.some(item => item.points.some(point => typeof point[0] === 'string'))) return 'category';
  if (series.length > 0 && series.every(item => item.type === 'bar')) return 'category';
  return 'number';
}

export function financialGeometry(width: number, height: number, axisGutter = 52, rightGutter = 12): FinancialGeometry {
  const w = Math.max(1, width), h = Math.max(1, height);
  const left = Math.max(52, Math.min(axisGutter, w * 0.34));
  const right = Math.max(left + 1, w - Math.max(12, Math.min(rightGutter, w * 0.34)));
  const top = 12, bottom = Math.max(top + 1, h - 34);
  return { width: w, height: h, left, right, top, bottom, plotWidth: right - left, plotHeight: bottom - top };
}
function numericX(key: ChartX): number { if (typeof key === 'number') return key; const parsed = Number(key); return Number.isFinite(parsed) ? parsed : Date.parse(key); }
function keyId(key: ChartX, xType: FinancialChartData['xType']): string { return xType === 'category' ? String(key) : String(numericX(key)); }
function validCandle(c: FinancialCandle): boolean { return [c.o, c.h, c.l, c.c].every(Number.isFinite) && c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c); }
export function chartKeys(data: FinancialChartData): ChartX[] {
  // Scope date parsing to this call. Never retain history by array identity:
  // callers may edit points between builds, and returned models keep no cache.
  const dates = new Map<string, number>();
  const numeric = (key: ChartX): number => {
    if (typeof key === 'number') return key;
    const parsed = Number(key);
    if (Number.isFinite(parsed)) return parsed;
    let date = dates.get(key);
    if (date === undefined) { date = Date.parse(key); dates.set(key, date); }
    return date;
  };
  const sources = data.series ?? [];
  const longest = sources.reduce<FinancialSeries | null>((best, s) => (best == null) || s.points.length > best.points.length ? s : best, null);
  const seen = new Set<string>();
  const keys: ChartX[] = [];
  const add = (key: ChartX) => {
    if (data.xType !== 'category' && !Number.isFinite(numeric(key))) return;
    const id = data.xType === 'category' ? String(key) : String(numeric(key));
    if (!seen.has(id)) { seen.add(id); keys.push(key); }
  };
  // Preserve category ordering: candles, longest series, then the other series.
  for (const candle of data.candles ?? []) if (validCandle(candle)) add(candle.t);
  if (longest != null) for (const point of longest.points) if (Number.isFinite(point[1])) add(point[0]);
  for (const source of sources) for (const point of source.points) if (Number.isFinite(point[1])) add(point[0]);
  return data.xType === 'category' ? keys : keys.sort((a, b) => numeric(a) - numeric(b));
}
function niceTicks(min: number, max: number, count = 3): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(n => n * mag).find(n => n >= raw) ?? 10 * mag;
  const result: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 0.001; v += step) result.push(Number(v.toFixed(10)));
  return (result.length > 0) ? result : [min, max];
}
function domain(values: number[], zero: boolean): [number, number] {
  if (values.length === 0) return [0, 1];
  let rawMin = Infinity, rawMax = -Infinity;
  for (const value of values) { rawMin = Math.min(rawMin, value); rawMax = Math.max(rawMax, value); }
  const padding = rawMax > rawMin ? (rawMax - rawMin) * 0.12 : Math.max(Math.abs(rawMax) * 0.05, 0.01);
  return [zero ? Math.min(0, rawMin) : rawMin - padding, zero ? Math.max(0.01, rawMax + padding) : rawMax + padding];
}
export function buildFinancialChartModel(data: FinancialChartData, width: number, height: number, axisGutter = 52, viewport?: FinancialViewport, rightGutter = 52): FinancialChartModel {
  const allKeys = chartKeys(data);
  const start = Math.max(0, Math.min(viewport?.start ?? 0, Math.max(0, allKeys.length - 1)));
  const end = Math.max(start + 1, Math.min(viewport?.end ?? allKeys.length, allKeys.length));
  const xKeys = allKeys.slice(start, end), visibleIds = new Set(xKeys.map(key => keyId(key, data.xType)));
  const sources = data.series ?? [], candles = (data.candles ?? []).filter(c => validCandle(c) && visibleIds.has(keyId(c.t, data.xType)));
  const hasRightAxis = sources.some(s => s.axis === 'right');
  const geometry = financialGeometry(width, height, axisGutter, hasRightAxis ? rightGutter : 12);
  const indexByKey = new Map(xKeys.map((key, i) => [keyId(key, data.xType), i]));
  const visibleSeries = sources.map(source => ({ source, points: source.points.filter(p => visibleIds.has(keyId(p[0], data.xType)) && Number.isFinite(p[1])) }));
  const leftValues = candles.flatMap(c => [c.h, c.l]).filter(Number.isFinite), rightValues: number[] = [];
  for (const { source, points } of visibleSeries) {
    const target = source.axis === 'right' ? rightValues : leftValues;
    for (const point of points) target.push(point[1]);
  }
  if (data.stacked) { for (const axis of ['left', 'right'] as const) {
    const totals = new Map<string, [number, number]>();
    for (const { source, points } of visibleSeries) {
      if (source.type !== 'bar' || (source.axis ?? 'left') !== axis) continue;
      for (const point of points) {
        const id = keyId(point[0], data.xType);
        let total = totals.get(id);
        if (total == null) { total = [0, 0]; totals.set(id, total); }
        total[point[1] >= 0 ? 0 : 1] += point[1];
      }
    }
    const target = axis === 'right' ? rightValues : leftValues;
    for (const key of xKeys) {
      const total = totals.get(keyId(key, data.xType));
      target.push(total?.[0] ?? 0, total?.[1] ?? 0);
    }
  } }
  const useZero = data.scale === 'zero' || (data.scale !== 'tight' && sources.length > 0 && sources.every(s => s.type === 'bar'));
  const [min, max] = domain(leftValues, useZero || sources.some(s => s.type === 'bar' && (s.axis ?? 'left') === 'left'));
  const [rightMin, rightMax] = domain(rightValues, useZero || sources.some(s => s.type === 'bar' && s.axis === 'right'));
  const xNumbers = data.xType === 'category' ? [] : xKeys.map(numericX), xMin = xNumbers[0] ?? 0, xMax = xNumbers[xNumbers.length - 1] ?? 1;
  const x = (key: ChartX, index: number) => data.xType === 'category'
    ? geometry.left + (xKeys.length < 2 ? geometry.plotWidth / 2 : index / (xKeys.length - 1) * geometry.plotWidth)
    : geometry.left + (xMax === xMin ? geometry.plotWidth / 2 : (numericX(key) - xMin) / (xMax - xMin) * geometry.plotWidth);
  const y = (value: number, axis: ChartAxis = 'left') => { const lo = axis === 'right' ? rightMin : min, hi = axis === 'right' ? rightMax : max; return geometry.bottom - (value - lo) / (hi - lo) * geometry.plotHeight; };
  const xPositions = xKeys.map((key, i) => x(key, i));
  const xTickIndices = xKeys.length < 3 ? xKeys.map((_, i) => i) : [...new Set([0, Math.floor((xKeys.length - 1) / 2), xKeys.length - 1])];
  const plottedSeries = visibleSeries.map(({ source, points }) => ({ source, points: points.map(([key, value]) => { const index = indexByKey.get(keyId(key, data.xType)) ?? 0; return { x: x(key, index), y: y(value, source.axis), value, key, index }; }).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)) }));
  const plottedCandles = candles.map(k => { const index = indexByKey.get(keyId(k.t, data.xType)) ?? 0; return { ...k, x: x(k.t, index), bodyTop: y(Math.max(k.o, k.c)), bodyBottom: y(Math.min(k.o, k.c)), wickTop: y(k.h), wickBottom: y(k.l), index }; });
  return { geometry, min, max, yTicks: niceTicks(min, max), rightMin, rightMax, rightTicks: hasRightAxis ? niceTicks(rightMin, rightMax) : [], hasRightAxis, xKeys, allKeys, start, end, xPositions, xTickIndices, plottedSeries, plottedCandles, x, y };
}
export function nearestChartIndex(model: FinancialChartModel, touchX: number): number | null {
  if (model.xPositions.length === 0) return null;
  const positions = model.xPositions;
  // Preserve the original first-point result for non-finite touch coordinates.
  if (!Number.isFinite(touchX)) return 0;
  if (!Number.isFinite(positions[0]) || !Number.isFinite(positions[positions.length - 1])) {
    let nearest = 0;
    for (let i = 1; i < positions.length; i++) if (Math.abs(positions[i] - touchX) < Math.abs(positions[nearest] - touchX)) nearest = i;
    return nearest;
  }
  const lowerBound = (value: number) => {
    let lo = 0, hi = positions.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (positions[mid] < value) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const right = lowerBound(touchX);
  const left = Math.max(0, right - 1);
  const nearest = right < positions.length && Math.abs(positions[right] - touchX) < Math.abs(positions[left] - touchX) ? right : left;
  // Several very close numeric keys can round to the same pixel. First tie wins.
  return lowerBound(positions[nearest]);
}
export function valueAtChartIndex(series: FinancialSeries, data: FinancialChartData, model: FinancialChartModel, index: number): number | null {
  const key = model.xKeys[index];
  if (key == null) return null;
  const id = keyId(key, data.xType);
  return series.points.find(p => keyId(p[0], data.xType) === id)?.[1] ?? null;
}
