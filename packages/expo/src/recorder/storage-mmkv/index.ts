/**
 * Opt-in MMKV storage driver — `@vitrinka/expo/recorder/storage-mmkv`.
 *
 * `react-native-mmkv` is an OPTIONAL peer: it is only resolved when an app
 * imports this subpath, so apps on the default file-system driver never need
 * it installed. Use when you already ship MMKV and want the recorder's queue
 * in the same store (memory-mapped writes, marginally tighter crash window).
 *
 *   // index.js — before the app mounts
 *   import { configureRecorderStorage } from '@vitrinka/expo/recorder/storage';
 *   import { mmkvRecorderStorage } from '@vitrinka/expo/recorder/storage-mmkv';
 *   configureRecorderStorage(mmkvRecorderStorage());
 */
import { createMMKV } from 'react-native-mmkv';

import type { RecorderStorage } from '../storage';

export function mmkvRecorderStorage(id = 'vitrinka-recorder'): RecorderStorage {
  const store = createMMKV({ id });
  return {
    getString: (key) => store.getString(key) ?? null,
    set: (key, value) => store.set(key, value),
    remove: (key) => store.remove(key),
  };
}
