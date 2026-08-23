/**
 * Default storage driver: expo-file-system's modern `File` API, whose reads and
 * writes are synchronous — the property the queue's ack bookkeeping requires.
 * One file per key under a dedicated directory in the app's document dir.
 *
 * Failure posture: reads treat any error as "no value" (a corrupt or missing
 * file behaves like a fresh install); writes and deletes surface loudly — the
 * queue treats storage as durable, so a silently failed write would lie to it.
 */
import { Directory, File, Paths } from 'expo-file-system';

import type { RecorderStorage } from './index';

const DIR_NAME = 'vitrinka-recorder-kv';

function keyFile(dir: Directory, key: string): File {
  // Keys are module-internal identifiers ([a-zA-Z0-9-]); guard anyway so a
  // future key can never traverse paths.
  return new File(dir, `${encodeURIComponent(key)}.json`);
}

export function fileRecorderStorage(): RecorderStorage {
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });
  return {
    getString(key) {
      const f = keyFile(dir, key);
      try {
        return f.exists ? f.textSync() : null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      keyFile(dir, key).write(value);
    },
    remove(key) {
      const f = keyFile(dir, key);
      if (f.exists) f.delete();
    },
  };
}
