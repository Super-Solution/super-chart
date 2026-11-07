/** React Native entry: shared core plus opt-in native lifecycle wiring; rendering stays in the host. */
export * from './core/index'
export { ta, nativeIndicatorSeries } from './core/index'
export * from './engine/model'
export { createNativeEnvironment, createNativeDataLoader } from './platform/native'
export type { NativeAppStateSource, NativeEnvironmentOptions, NativeLoaderOptions } from './platform/native'
