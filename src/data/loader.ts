/** Web compatibility adapter: all request/replay/cache state lives in core. */
import { DataLoader as CoreDataLoader } from '../core/dataLoader'
import type { LoaderOptions as CoreLoaderOptions } from '../core/dataLoader'
import { browserEnvironment } from '../platform/browser'
import type { LoaderEnv } from '../platform/browser'

export * from '../core/dataLoader'
export type { LoaderEnv } from '../platform/browser'
export interface LoaderOptions extends Omit<CoreLoaderOptions, 'env'> { env?: Partial<LoaderEnv> }

export class DataLoader extends CoreDataLoader {
  constructor (options: LoaderOptions) {
    const env = { ...browserEnvironment(), ...options.env }
    super({ ...options, env: { ...env, visibility: env.document, connectivity: env.window } })
  }
}
