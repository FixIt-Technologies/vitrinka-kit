/**
 * @vitrinka/expo — the vitrinka toolkit for Expo apps.
 *
 * The root export carries only the wire protocol types; the tools live on
 * subpaths so an app bundles exactly what it imports:
 *
 *   @vitrinka/expo/recorder               journey recorder (gate components)
 *   @vitrinka/expo/recorder/expo-router   route adapter for expo-router apps
 *   @vitrinka/expo/recorder/storage       storage driver configuration
 *   @vitrinka/expo/recorder/storage-mmkv  opt-in MMKV driver
 *   @vitrinka/expo/recorder/metro         withRecorderStrip (metro.config.js)
 *   @vitrinka/expo/protocol               recorder↔server wire types
 */
export type * from './protocol';
