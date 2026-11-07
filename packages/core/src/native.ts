/** React Native entry: shared core plus opt-in native lifecycle wiring; rendering stays in the host. */
export * from '.'
export { ta, nativeIndicatorSeries } from '.'
export { createNativeEnvironment, createNativeDataLoader } from './platform/native'
export type { NativeAppStateSource, NativeEnvironmentOptions, NativeLoaderOptions } from './platform/native'
