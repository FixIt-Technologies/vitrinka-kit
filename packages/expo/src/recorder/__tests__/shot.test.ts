/**
 * Keyframe capture session-binding.
 *
 * Stop's wait for in-flight captures is deadline-bounded, so a slow keyframe CAN
 * outlive its session. `doShoot` snapshots the session before its awaits
 * (paint wait → captureRef → uploadShot); without a re-check afterwards it
 * allocated a seq from whatever session was current, uploaded under the OLD
 * session's id, and pushed the event into the NEW session's stream.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

// The capture waits a frame before grabbing; Bun has no requestAnimationFrame.
(globalThis as { requestAnimationFrame?: (cb: () => void) => void }).requestAnimationFrame ??= (
  cb,
) => {
  setTimeout(cb, 0);
};

let captureGate: Promise<void> = Promise.resolve();
const uploads: string[] = [];
const deleted: string[] = [];
let failUploads = false;

const captureOpts: Record<string, unknown>[] = [];

mock.module('react-native-view-shot', () => ({
  captureRef: async (_ref: unknown, opts?: Record<string, unknown>) => {
    captureOpts.push(opts ?? {});
    await captureGate;
    return '/tmp/shot.jpg';
  },
}));

mock.module('expo-file-system/legacy', () => ({
  documentDirectory: '/docs/',
  getInfoAsync: async () => ({ exists: true }),
  makeDirectoryAsync: async () => undefined,
  deleteAsync: async (uri: string) => {
    deleted.push(uri);
  },
  moveAsync: async () => undefined,
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  uploadAsync: async () => ({ status: 200, body: '{}' }),
}));

const apiStatus = (await import(
  '../api-status'
)) as typeof import('../api-status');

mock.module('../api', () => ({
  fetchPolicy: async () => null,
  api: async () => ({}),
  uploadShot: async (sessionId: string) => {
    if (failUploads) throw new apiStatus.VitrinkaApiError('offline', 0);
    uploads.push(sessionId);
    return { blobKey: 'blob-1' };
  },
  isVitrinkaUrl: () => false,
  vitrinkaConfigured: () => true,
  permanentStatus: apiStatus.permanentStatus,
  VitrinkaApiError: apiStatus.VitrinkaApiError,
}));

const queue = (await import(
  '../queue'
)) as typeof import('../queue');
const shot = (await import(
  '../capture/shot'
)) as typeof import('../capture/shot');
const redact = (await import(
  '../capture/redact'
)) as typeof import('../capture/redact');

function session(id: string) {
  return {
    sessionId: id,
    project: 'example',
    environment: 'development',
    title: '',
    seq: 0,
    paused: false,
    activeMs: 0,
    resumeAt: new Date().toISOString(),
    shots: 0,
  };
}

beforeEach(() => {
  uploads.length = 0;
  deleted.length = 0;
  failUploads = false;
  captureGate = Promise.resolve();
  queue.__resetForTests();
  shot.__resetShotThrottleForTests(); // module-level throttle would skip later cases
  queue.setState(session('sess-A'));
  // A root the capture layer accepts; captureRef itself is mocked.
  shot.setShotRoot({ current: {} as never });
});

describe('keyframe session binding', () => {
  it('records the keyframe when its session is still current', async () => {
    await shot.shoot('nav');
    expect(uploads).toEqual(['sess-A']);
    const buffered = queue.__bufferForTests().filter((e) => e.kind === 'shot');
    expect(buffered).toHaveLength(1);
    expect(queue.getState()?.shots).toBe(1);
  });

  it('DROPS a keyframe whose session ended mid-capture', async () => {
    let release: (() => void) | undefined;
    captureGate = new Promise<void>((res) => {
      release = res;
    });
    const running = shot.shoot('touch');
    await Promise.resolve();
    queue.setState(null); // Stop completed while captureRef was still working
    release?.();
    await running;
    expect(uploads).toEqual([]); // never uploaded
    expect(queue.getState()).toBeNull();
  });

  it('does not attribute session A‘s keyframe to session B', async () => {
    let release: (() => void) | undefined;
    captureGate = new Promise<void>((res) => {
      release = res;
    });
    const running = shot.shoot('touch');
    await Promise.resolve();
    queue.setState(null);
    queue.setState(session('sess-B')); // a new run starts
    release?.();
    await running;
    expect(uploads).toEqual([]); // not uploaded under either id
    expect(queue.__bufferForTests().filter((e) => e.kind === 'shot')).toHaveLength(0);
    expect(queue.getState()?.sessionId).toBe('sess-B');
    expect(queue.getState()?.seq).toBe(0); // B's seq stream untouched
    expect(queue.getState()?.shots).toBe(0); // and B's frame count is honest
  });

  it('is tracked as a capture so Stop can settle it', async () => {
    let release: (() => void) | undefined;
    captureGate = new Promise<void>((res) => {
      release = res;
    });
    const running = shot.shoot('nav');
    await Promise.resolve();
    // Registered: a bounded settle must report that it did NOT drain.
    expect(await queue.capturesSettled(60)).toBe(false);
    release?.();
    // The bounded settle EVICTED the capture — settle again would return
    // immediately, so await the run itself or its upload leaks into the
    // next test's assertions.
    await running;
  });
});

describe('held keyframes (annotate flow)', () => {
  const NOTE_TS = '2026-07-27T10:00:00.000Z';

  it('commit emits the held frame at note-ts + 1ms with the seq allocated at capture', async () => {
    const held = await shot.captureHeldShot();
    expect(held).not.toBeNull();
    // Seq was claimed at drag-release; a note pushed while the composer is
    // open allocates a LATER seq.
    queue.pushEvent('note', { text: 'x' }, { tabId: 'root', tabHost: '/' });
    held?.commit(NOTE_TS);
    await queue.capturesSettled();
    expect(uploads).toEqual(['sess-A']);
    const shots = queue.__bufferForTests().filter((e) => e.kind === 'shot');
    expect(shots).toHaveLength(1);
    expect(shots[0]?.seq).toBe(1); // pre-allocated, below the note's seq 2
    expect(shots[0]?.ts).toBe('2026-07-27T10:00:00.001Z'); // ts-ordered right after the note
    expect(queue.getState()?.shots).toBe(1);
    // The blob is on the server — the temp JPEG must not outlive the commit
    // (review an earlier review: the success path leaked one file per annotation).
    expect(deleted).toContain('/tmp/shot.jpg');
  });

  it('a plain keyframe also releases its temp file after upload', async () => {
    await shot.shoot('nav');
    expect(uploads).toEqual(['sess-A']);
    expect(deleted).toContain('/tmp/shot.jpg');
  });

  it('discard emits nothing and keeps the frame count honest', async () => {
    const held = await shot.captureHeldShot();
    held?.discard();
    held?.commit(NOTE_TS); // settled handles ignore a late commit
    await queue.capturesSettled();
    expect(uploads).toEqual([]);
    expect(queue.__bufferForTests().filter((e) => e.kind === 'shot')).toHaveLength(0);
    expect(queue.getState()?.shots).toBe(0);
  });

  it('commit after the session ended drops the frame', async () => {
    const held = await shot.captureHeldShot();
    queue.setState(null); // Stop completed while the composer was open
    held?.commit(NOTE_TS);
    await queue.capturesSettled();
    expect(uploads).toEqual([]);
    expect(queue.__bufferForTests().filter((e) => e.kind === 'shot')).toHaveLength(0);
  });

  it('a failed upload rides the pending queue with its allocated seq', async () => {
    const held = await shot.captureHeldShot();
    failUploads = true;
    held?.commit(NOTE_TS);
    await queue.capturesSettled();
    expect(uploads).toEqual([]);
    // Not lost: exactly one pending item queued for oldest-first retry.
    expect(queue.queuedCount()).toBe(1);
    expect(queue.getState()?.shots).toBe(1); // captured, just not delivered yet
  });

  it('refuses to hold a frame while paused', async () => {
    const rec = queue.getState();
    if (rec) queue.setState({ ...rec, paused: true });
    expect(await shot.captureHeldShot()).toBeNull();
  });

  it('commit is idempotent — a double commit uploads once', async () => {
    const held = await shot.captureHeldShot();
    held?.commit(NOTE_TS);
    held?.commit(NOTE_TS);
    await queue.capturesSettled();
    expect(uploads).toEqual(['sess-A']);
    expect(queue.__bufferForTests().filter((e) => e.kind === 'shot')).toHaveLength(1);
  });
});

describe('pixel masking (maskAllText ⇒ blurred keyframes)', () => {
  beforeEach(() => {
    captureOpts.length = 0;
  });

  it('captures at full size under the default policy', async () => {
    redact.setRedactionPolicy(null);
    await shot.shoot('nav');
    await queue.capturesSettled();
    expect(captureOpts).toHaveLength(1);
    expect(captureOpts[0]?.width).toBeUndefined();
  });

  it('downscales the capture until text is unreadable under maskAllText', async () => {
    redact.setRedactionPolicy({ maskAllText: true });
    await shot.shoot('nav');
    await queue.capturesSettled();
    expect(captureOpts).toHaveLength(1);
    expect(captureOpts[0]?.width).toBe(96);
    // Aspect follows the (mocked 390×844) window.
    expect(captureOpts[0]?.height).toBe(Math.round(96 * (844 / 390)));
    redact.setRedactionPolicy(null);
  });

  it('fullFidelity restores full-size captures even with maskAllText set', async () => {
    redact.setRedactionPolicy({ maskAllText: true, fullFidelity: true });
    await shot.shoot('nav');
    await queue.capturesSettled();
    expect(captureOpts[0]?.width).toBeUndefined();
    redact.setRedactionPolicy(null);
  });

  it('a held keyframe carries its capture scale (image px per view pt)', async () => {
    // Default: captureRef records at screen density — scale = PixelRatio (2 in
    // the preload). Under blur the JPEG is only BLUR_WIDTH px wide, so the
    // scale annotation rects must use is BLUR_WIDTH / window width — the
    // full-density scale would land rects an order of magnitude outside the
    // image.
    const plain = await shot.captureHeldShot();
    expect(plain?.scale).toBe(2);
    plain?.discard();
    redact.setRedactionPolicy({ maskAllText: true });
    const blurred = await shot.captureHeldShot();
    expect(blurred?.scale).toBeCloseTo(96 / 390, 5);
    blurred?.discard();
    redact.setRedactionPolicy(null);
  });
});
