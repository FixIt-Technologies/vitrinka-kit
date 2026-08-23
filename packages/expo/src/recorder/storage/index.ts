/**
 * Pluggable durable KV storage for the recorder's queue and session state.
 *
 * The queue's correctness leans on SYNCHRONOUS reads/writes: every
 * read-modify-write completes in one JS tick, so no async mutex is needed and
 * delivery-ack bookkeeping stays race-free. Any driver plugged in here MUST be
 * synchronous.
 *
 * The default driver persists through expo-file-system's modern `File` API
 * (synchronous by design, available everywhere expo is) — zero extra installs.
 * Apps that prefer MMKV plug in the driver from
 * `@vitrinka/expo/recorder/storage-mmkv`, which keeps `react-native-mmkv` an
 * optional peer: it is only resolved when that subpath is imported.
 *
 * Storage is tiny and cold-path by construction: the queue caches everything
 * in memory and flushes on a debounce, so a driver sees a handful of writes
 * per second at most, at KB sizes.
 */

export interface RecorderStorage {
  /** Read a value; null/undefined when the key was never written. */
  getString(key: string): string | null | undefined;
  /** Write a value durably before returning. */
  set(key: string, value: string): void;
  /** Delete a key; a no-op when absent. */
  remove(key: string): void;
}

let current: RecorderStorage | null = null;

/**
 * Install a storage driver. Call before the recorder mounts (module top level
 * of your app entry is the natural place); calling after first use throws —
 * silently switching stores mid-session would strand the durable tail in the
 * old one.
 */
export function configureRecorderStorage(driver: RecorderStorage): void {
  if (used && current !== driver) {
    throw new Error(
      'vitrinka: configureRecorderStorage() must run before the recorder first touches storage',
    );
  }
  current = driver;
}

let used = false;

/** The active driver; lazily falls back to the file-system driver. */
export function getRecorderStorage(): RecorderStorage {
  if (!current) {
    // Deferred require keeps the fs driver out of the bundle when an app
    // configured its own driver (and out of test runs that inject memory).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    current = (require('./storage-file') as typeof import('./storage-file')).fileRecorderStorage();
  }
  used = true;
  return current;
}

/** In-memory driver — for tests and as a last-resort non-durable fallback. */
export function memoryRecorderStorage(): RecorderStorage {
  const m = new Map<string, string>();
  return {
    getString: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
  };
}

/** Test-only: forget the configured driver and the first-use latch. */
export function __resetStorageForTests(): void {
  current = null;
  used = false;
}
