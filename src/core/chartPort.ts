import type { MarketBar } from './types'

/** Small renderer-owned data sink. The core owns no canvas or native view. */
export interface ChartDataPort<Bar = MarketBar> {
  applyNewData: (data: Bar[], more?: boolean) => void
  applyMoreData: (data: Bar[], more?: boolean) => void
  updateData: (data: Bar) => void
  getDataList: () => Bar[]
  loadMore?: (callback: (timestamp: number | null) => void) => void
  setLoadDataCallback?: (callback: (request: HistoryLoadRequest<Bar>) => void) => void
}

export interface HistoryLoadRequest<Bar = MarketBar> {
  type: string
  data: Bar | null
  callback: (data: Bar[], more?: boolean) => void
}
