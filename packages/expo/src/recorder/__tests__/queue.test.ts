/**
 * Source-level tests for the vitrinka recorder's durable queue + session
 * semantics: single-flight flushing, permanent-vs-transient
 * error classification, sequence gap-fill, pending eviction/session binding,
 * pause bookkeeping and the offline-Stop refusal.
 *
 * These are the pure-logic behaviors the recorder's correctness rests on — the
 * device/native layer (captureRef, real MMKV, real uploads) is out of scope and
 * is covered by the on-sim journey QA.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// -- module mocks (must be registered before the SUT is imported) ------------

const fsCalls: { deleted: string[]; moved: { from: string; to: string }[] } = {
  deleted: [],
  moved: [],
};

/**
 * Durable storage for the SUT: the package's own memory driver, injected
 * through configureRecorderStorage — the same seam a consuming app uses for
 * MMKV. rawStorage() reads/writes the SUT's store through the SAME driver
 * instance, which is what these durability tests need.
 */
import {
  __resetStorageForTests,
  configureRecorderStorage,
  memoryRecorderStorage,
  type RecorderStorage,
} from '../storage';

let memStore: RecorderStorage = memoryRecorderStorage();
// The preload (test/setup.ts) already configured a driver; reset its
// first-use latch before installing the observable instance this file owns.
__resetStorageForTests();
configureRecorderStorage(memStore);

function rawStorage(): RecorderStorage {
  return memStore;
}


mock.module('expo-file-system/legacy', () => ({
  documentDirectory: '/docs/',
  getInfoAsync: async () => ({ exists: true }),
  makeDirectoryAsync: async () => undefined,
  deleteAsync: async (uri: string) => {
    fsCalls.deleted.push(uri);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    fsCalls.moved.push({ from, to });
  },
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  uploadAsync: async () => ({ status: 200, body: '{}' }),
}));

/** Scripted transport: each queued outcome applies to the next api()/upload. */
type Outcome = { ok: true } | { ok: false; status: number };

const transport: {
  events: Outcome[];
  shots: Outcome[];
  /** Scripted GET /sessions/:id responses for the reconcile poll. */
  sessions: (Outcome & { body?: Record<string, unknown> })[];
  eventBatches: unknown[][];
  shotSeqs: number[];
  /** When set, the events POST parks here until the test releases it. */
  gate: Promise<void> | null;
} = { events: [], shots: [], sessions: [], eventBatches: [], shotSeqs: [], gate: null };

class TestApiError extends Error {
  constructor(readonly status: number) {
    super(`status ${status}`);
  }
}

// The REAL predicate — re-implementing it here would make the
// "permanent vs transient" tests validate the test's own copy of the rule
// rather than the shipped one.
const { permanentStatus: realPermanentStatus } = (await import(
  '../api-status'
)) as typeof import('../api-status');

mock.module('../api', () => ({
  VitrinkaApiError: TestApiError,
  permanentStatus: realPermanentStatus,
  vitrinkaConfigured: () => true,
  isVitrinkaUrl: (u: string) => u.startsWith('https://vitrinka.test'),
  api: async (m: string, _p: string, body?: unknown) => {
    if (m === 'GET') {
      const res = transport.sessions.shift() ?? { ok: true as const, body: {} };
      if (!res.ok) throw new TestApiError(res.status);
      return res.body ?? {};
    }
    if (transport.gate) await transport.gate;
    const next = transport.events.shift() ?? { ok: true };
    if (body && typeof body === 'object' && 'events' in body) {
      // The real server rejects request BODIES over 4 MiB of UTF-8 with a 400
      // (MaxBytesReader) — enforce the same wall here in wire bytes, so a
      // batcher that counts UTF-16 code units cannot pass on multibyte text.
      if (new TextEncoder().encode(JSON.stringify(body)).length > 4 * 1024 * 1024) {
        throw new TestApiError(400);
      }
      const evs = (body as { events: unknown[] }).events;
      if (next.ok) transport.eventBatches.push(evs);
    }
    if (!next.ok) throw new TestApiError(next.status);
    return {};
  },
  uploadShot: async (_sid: string, seq: number) => {
    const next = transport.shots.shift() ?? { ok: true };
    if (!next.ok) throw new TestApiError(next.status);
    transport.shotSeqs.push(seq);
    return { blobKey: `blob-${seq}` };
  },
}));

// Dynamic import: a static `import` is hoisted ABOVE the mock.module() calls
// above, which would load the real api/expo-file-system modules first.
//
// CACHE-BUSTED (?queue-test): net.test.ts mocks the SAME
// '../api' path with a transport that ignores
// this file's `transport` script. When file order runs net.test first (ext4
// runners — never APFS locally, hence green-local/red-CI), the plain-path SUT
// is already instantiated with net's api snapshot and re-mocking cannot
// retro-patch its transpiled bindings. The query string forces a FRESH SUT
// instance evaluated under THIS file's registrations.
const queue = (await import(
  '../queue?isolated=queue-test'
)) as typeof import('../queue');

const ROUTE = { tabId: 'home', tabHost: '/home' };

function liveSession(over: Partial<queue.SessionState> = {}): queue.SessionState {
  return {
    sessionId: 'sess-1',
    project: 'example',
    environment: 'development',
    title: '',
    seq: 0,
    paused: false,
    activeMs: 0,
    resumeAt: new Date().toISOString(),
    shots: 0,
    ...over,
  };
}

beforeEach(async () => {
  queue.__resetForTests();
  transport.events = [];
  transport.shots = [];
  transport.sessions = [];
  transport.eventBatches = [];
  transport.shotSeqs = [];
  transport.gate = null;
  fsCalls.deleted = [];
  fsCalls.moved = [];
  queue.setState(liveSession());
  await queue.resetQueues();
});

afterEach(() => {
  // Cancels the 2s flush + persist timers and clears caches, so a timer armed
  // by this test cannot fire inside the next one and eat its scripted
  // transport outcomes.
  queue.__resetForTests();
});

describe('pushEvent', () => {
  it('assigns monotonically increasing seqs and stamps the route', async () => {
    queue.pushEvent('click', { x: 1 }, ROUTE);
    queue.pushEvent('nav', { route: '/x' }, ROUTE);
    await queue.flush();
    const batch = transport.eventBatches[0] as queue.RecorderEvent[];
    expect(batch.map((e) => e.seq)).toEqual([1, 2]);
    expect(batch[0].tabId).toBe('home');
    expect(batch[0].tabHost).toBe('/home');
    expect(queue.getState()?.seq).toBe(2);
  });

  it('drops events while paused', async () => {
    queue.setState(liveSession({ paused: true }));
    queue.pushEvent('click', { x: 1 }, ROUTE);
    expect(queue.queuedCount()).toBe(0);
  });

  it('drops events with no live session', () => {
    queue.setState(null);
    queue.pushEvent('click', { x: 1 }, ROUTE);
    expect(queue.queuedCount()).toBe(0);
  });
});

describe('flush', () => {
  it('removes exactly the sent seqs, keeping events pushed mid-flight', async () => {
    // The batch is snapshotted before the POST; an event captured while that
    // POST is in flight must SURVIVE the post-success removal.
    let release: (() => void) | undefined;
    transport.gate = new Promise<void>((res) => {
      release = res;
    });
    queue.pushEvent('click', {}, ROUTE);
    const inFlight = queue.flush();
    await Promise.resolve(); // let flush reach the parked POST (batch = [seq 1])
    queue.pushEvent('nav', {}, ROUTE);
    release?.();
    await inFlight;
    expect(queue.queuedCount()).toBe(1); // seq 2 kept
    transport.gate = null;
    await queue.flush();
    expect(queue.queuedCount()).toBe(0);
    expect(transport.eventBatches.map((b) => b.length)).toEqual([1, 1]);
  });

  it('keeps the batch on a TRANSIENT failure (retryable)', async () => {
    transport.events = [{ ok: false, status: 503 }];
    queue.pushEvent('click', {}, ROUTE);
    expect(await queue.flush()).toBe(false);
    expect(queue.queuedCount()).toBe(1);
  });

  it('keeps the batch on 429 / 408 (rate-limit + timeout are transient)', async () => {
    transport.events = [
      { ok: false, status: 429 },
      { ok: false, status: 408 },
    ];
    queue.pushEvent('click', {}, ROUTE);
    expect(await queue.flush()).toBe(false);
    expect(queue.queuedCount()).toBe(1);
    expect(await queue.flush()).toBe(false);
    expect(queue.queuedCount()).toBe(1);
  });

  it('marks the SESSION dead on a PERMANENT verdict (extension D9) and stops POSTing', async () => {
    // Supersedes the old per-batch drop: a permanent
    // events rejection (revoked token, deleted session) is terminal for the
    // whole session — dropping just the batch would silently record into a
    // void. The buffer is KEPT for Stop to settle; no further POST happens.
    transport.events = [{ ok: false, status: 400 }];
    queue.pushEvent('click', {}, ROUTE);
    expect(await queue.flush()).toBe(false);
    const rec = queue.getState();
    expect(rec?.dead).toBe(true);
    expect(rec?.deadReason).toContain('400');
    expect(queue.queuedCount()).toBe(1); // kept, not dropped
    expect(await queue.flush()).toBe(false); // dead: no POST attempted
    expect(transport.eventBatches).toHaveLength(0);
  });

  it('a dead session refuses new capture (pushEvent + nextSeq)', async () => {
    transport.events = [{ ok: false, status: 401 }];
    queue.pushEvent('click', {}, ROUTE);
    await queue.flush();
    expect(queue.getState()?.dead).toBe(true);
    const before = queue.queuedCount();
    queue.pushEvent('click', {}, ROUTE);
    expect(queue.queuedCount()).toBe(before);
    expect(queue.nextSeq()).toBeNull();
  });

  it('drainBuffer bails out fast on a dead session, keeping the tail', async () => {
    transport.events = [{ ok: false, status: 403 }];
    queue.pushEvent('click', {}, ROUTE);
    const t0 = Date.now();
    expect(await queue.drainBuffer(30_000)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2000); // no 30s retry loop
    expect(queue.queuedCount()).toBe(1);
  });

  it('splits a byte-heavy backlog across POSTs instead of busting the server 4 MiB cap', async () => {
    // vitrinka rejects events bodies over 4 MiB of UTF-8 with a 400
    // (MaxBytesReader) — a PERMANENT verdict. The payload is MULTIBYTE on
    // purpose: '❄' is 1 UTF-16 code unit but 3 UTF-8 bytes, so a batcher
    // counting .length undercounts the wire size 3× and assembles a doomed
    // POST (the mocked transport enforces the 4 MiB wall in wire bytes).
    // 60 events × ~40 KiB units ≈ 120 KiB wire each ≈ 7 MiB total.
    const fat = '❄'.repeat(40 * 1024);
    for (let i = 0; i < 60; i++) queue.pushEvent('request', { resBody: fat }, ROUTE);
    await queue.drainBuffer(10_000);
    expect(queue.queuedCount()).toBe(0);
    expect(queue.getState()?.dead).toBeUndefined();
    expect(transport.eventBatches.length).toBeGreaterThan(1); // actually split
    const seqs = transport.eventBatches.flat().map((e) => (e as queue.RecorderEvent).seq);
    expect(seqs).toEqual(Array.from({ length: 60 }, (_, i) => i + 1)); // in order, none lost
    for (const b of transport.eventBatches) {
      expect(new TextEncoder().encode(JSON.stringify(b)).length).toBeLessThan(4 * 1024 * 1024);
    }
  });

  it('ships a pack-margin-busting but deliverable event ALONE instead of dropping it', async () => {
    // 3 MiB is the pack margin, 4 MiB the server wall — an event between the
    // two is valid cargo and must ride solo, in order.
    queue.pushEvent('click', { x: 1 }, ROUTE);
    queue.pushEvent('note', { text: '❄'.repeat(1200 * 1024) }, ROUTE); // ~3.5 MiB wire
    queue.pushEvent('click', { x: 2 }, ROUTE);
    await queue.drainBuffer(10_000);
    expect(queue.getState()?.dead).toBeUndefined();
    expect(queue.queuedCount()).toBe(0); // everything delivered
    const seqs = transport.eventBatches.map((b) => b.map((e) => (e as queue.RecorderEvent).seq));
    expect(seqs).toEqual([[1], [2], [3]]); // fat one solo, FIFO preserved
  });

  it('drops a single event beyond the WIRE cap instead of dooming the session', async () => {
    // No producer should build one, but a single event past the 4 MiB wall
    // can NEVER upload — solo-POSTing it hits the permanent-400/dead path.
    // Extension precedent (splitRRWebEvents): report it dropped, keep going.
    queue.pushEvent('note', { text: '❄'.repeat(1500 * 1024) }, ROUTE); // ~4.4 MiB wire
    queue.pushEvent('click', { x: 1 }, ROUTE);
    await queue.drainBuffer(10_000);
    expect(queue.getState()?.dead).toBeUndefined(); // session survives
    expect(queue.queuedCount()).toBe(0); // nothing wedged at the head
    const kinds = transport.eventBatches.flat().map((e) => (e as queue.RecorderEvent).kind);
    expect(kinds).toEqual(['click']); // the deliverable event still shipped
  });

  it('is single-flight — concurrent calls do not double-POST', async () => {
    queue.pushEvent('click', {}, ROUTE);
    const [a, b] = await Promise.all([queue.flush(), queue.flush()]);
    expect([a, b].filter(Boolean).length).toBe(1);
    expect(transport.eventBatches.length).toBe(1);
  });
});

describe('pending shots', () => {
  it('gap-fills the stream: a retried shot keeps its originally allocated seq', async () => {
    const seq = queue.nextSeq();
    expect(seq).toBe(1);
    queue.pushEvent('click', {}, ROUTE); // takes seq 2
    await queue.queuePendingShot({
      seq: seq as number,
      ts: new Date().toISOString(),
      tabId: 'home',
      tabHost: '/home',
      sessionId: 'sess-1',
      fileUri: '/docs/vitrinka-recorder/pend-1.jpg',
    });
    await queue.flush(); // pending drains first, then the events batch
    const sent = transport.eventBatches.flat() as queue.RecorderEvent[];
    const shot = sent.find((e) => e.kind === 'shot');
    expect(shot?.seq).toBe(1);
    expect(shot?.blobKey).toBe('blob-1');
    expect(sent.map((e) => e.seq).sort()).toEqual([1, 2]);
  });

  it('drops a pending shot belonging to an ENDED session (never crosses sessions)', async () => {
    await queue.queuePendingShot({
      seq: 1,
      ts: new Date().toISOString(),
      tabId: 'home',
      tabHost: '/home',
      sessionId: 'OLD-session',
      fileUri: '/docs/vitrinka-recorder/pend-old.jpg',
    });
    await queue.flush();
    expect(queue.queuedCount()).toBe(0);
    expect(fsCalls.deleted).toContain('/docs/vitrinka-recorder/pend-old.jpg');
    expect(transport.shotSeqs).toEqual([]);
  });

  it('drops a pending shot on a permanent upload verdict', async () => {
    transport.shots = [{ ok: false, status: 413 }];
    await queue.queuePendingShot({
      seq: 1,
      ts: new Date().toISOString(),
      tabId: 'home',
      tabHost: '/home',
      sessionId: 'sess-1',
      fileUri: '/docs/vitrinka-recorder/pend-1.jpg',
    });
    await queue.flush();
    expect(queue.queuedCount()).toBe(0);
    expect(fsCalls.deleted).toContain('/docs/vitrinka-recorder/pend-1.jpg');
  });

  it('keeps a pending shot on a transient upload failure', async () => {
    transport.shots = [{ ok: false, status: 500 }];
    await queue.queuePendingShot({
      seq: 1,
      ts: new Date().toISOString(),
      tabId: 'home',
      tabHost: '/home',
      sessionId: 'sess-1',
      fileUri: '/docs/vitrinka-recorder/pend-1.jpg',
    });
    await queue.flush();
    expect(queue.queuedCount()).toBe(1);
    expect(fsCalls.deleted).not.toContain('/docs/vitrinka-recorder/pend-1.jpg');
  });
});

describe('countShot', () => {
  it('increments the DURABLE session counter (survives a state reload)', () => {
    queue.countShot();
    queue.countShot();
    expect(queue.getState()?.shots).toBe(2);
  });

  it('is a no-op with no live session', () => {
    queue.setState(null);
    queue.countShot();
    expect(queue.getState()).toBeNull();
  });
});

describe('capturesSettled', () => {
  it('reports TRUE immediately when nothing is in flight', async () => {
    await expect(queue.capturesSettled()).resolves.toBe(true);
  });

  it('awaits a tracked in-flight capture', async () => {
    let done = false;
    void queue.trackCapture(
      new Promise<void>((res) =>
        setTimeout(() => {
          done = true;
          res();
        }, 20),
      ),
    );
    await queue.capturesSettled();
    expect(done).toBe(true);
  });

  it('awaits MULTIPLE concurrent captures (keyframe + async net read)', async () => {
    const finished: string[] = [];
    const mk = (label: string, ms: number) =>
      queue.trackCapture(
        new Promise<void>((res) =>
          setTimeout(() => {
            finished.push(label);
            res();
          }, ms),
        ),
      );
    void mk('net', 10);
    void mk('shot', 30);
    await queue.capturesSettled();
    expect(finished.sort()).toEqual(['net', 'shot']);
  });

  it('still settles when a capture rejects', async () => {
    void queue.trackCapture(Promise.reject(new Error('capture blew up')));
    await expect(queue.capturesSettled()).resolves.toBe(true);
  });

  it('reports FALSE on deadline instead of waiting forever', async () => {
    // A capture that never resolves — a long-lived stream body read. Stop must
    // not hang on it.
    void queue.trackCapture(new Promise<void>(() => undefined));
    const started = Date.now();
    const settled = await queue.capturesSettled(150);
    expect(settled).toBe(false);
    expect(Date.now() - started).toBeLessThan(1200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });

  it('waits for a slow-but-finite capture rather than timing out early', async () => {
    let done = false;
    void queue.trackCapture(
      new Promise<void>((res) =>
        setTimeout(() => {
          done = true;
          res();
        }, 80),
      ),
    );
    expect(await queue.capturesSettled(2000)).toBe(true);
    expect(done).toBe(true);
  });
});

describe('drainBuffer', () => {
  it('returns true once buffer and pending are both empty', async () => {
    queue.pushEvent('click', {}, ROUTE);
    expect(await queue.drainBuffer(5000)).toBe(true);
    expect(queue.queuedCount()).toBe(0);
  });

  it('gives up (false) while the server keeps failing transiently, keeping the tail', async () => {
    transport.events = Array.from({ length: 20 }, () => ({ ok: false as const, status: 503 }));
    queue.pushEvent('click', {}, ROUTE);
    expect(await queue.drainBuffer(1200)).toBe(false);
    expect(queue.queuedCount()).toBe(1); // NEVER deleted
  });
});

describe('debounced persistence (crash durability)', () => {
  // The buffer is an in-memory cache flushed to MMKV on a debounce. These pin
  // the paths that must NOT depend on that timer: the pre-upload write and the explicit persistNow().
  it('persists the batch to MMKV BEFORE the upload leaves', async () => {
    let onDiskDuringPost: string | undefined;
    transport.gate = Promise.resolve();
    queue.pushEvent('click', {}, ROUTE);
    // Read raw MMKV while the POST is parked: the batch must already be there.
    let release: (() => void) | undefined;
    transport.gate = new Promise<void>((res) => {
      release = res;
    });
    const inFlight = queue.flush();
    await Promise.resolve();
    onDiskDuringPost = rawStorage().getString('buffer');
    release?.();
    await inFlight;
    expect(onDiskDuringPost).toBeDefined();
    expect(JSON.parse(onDiskDuringPost as string)).toHaveLength(1);
  });

  it('persistNow() writes the pending tail immediately (AppState background path)', () => {
    queue.pushEvent('click', {}, ROUTE);
    queue.pushEvent('nav', {}, ROUTE);
    queue.persistNow();
    const onDisk = JSON.parse(rawStorage().getString('buffer') ?? '[]');
    expect(onDisk).toHaveLength(2);
    expect(onDisk[0].kind).toBe('click');
  });

  it('recovers the undelivered tail from MMKV after a cold start', async () => {
    queue.pushEvent('click', {}, ROUTE);
    queue.persistNow();
    const survived = rawStorage().getString('buffer');
    // Simulate a restart: caches dropped, MMKV intact.
    queue.__dropCachesForTests();
    rawStorage().set('buffer', survived as string);
    expect(queue.queuedCount()).toBe(1);
    await queue.flush();
    expect((transport.eventBatches[0] as queue.RecorderEvent[])[0].kind).toBe('click');
  });
});

describe('reconcile (extension D5/D9 — only the server may declare a session dead)', () => {
  it('adopts the server maxSeq; the session stays live while status is recording', async () => {
    transport.sessions = [{ ok: true, body: { maxSeq: 7, status: 'recording' } }];
    await queue.reconcile();
    expect(queue.getState()?.dead).toBeUndefined();
    expect(queue.health().serverMaxSeq).toBe(7);
  });

  it('marks the session dead on 404 (deleted underneath the recorder)', async () => {
    transport.sessions = [{ ok: false, status: 404 }];
    await queue.reconcile();
    const rec = queue.getState();
    expect(rec?.dead).toBe(true);
    expect(rec?.deadReason).toContain('no longer exists');
  });

  it('marks the session dead when the server closed it (status done)', async () => {
    transport.sessions = [{ ok: true, body: { maxSeq: 3, status: 'done' } }];
    await queue.reconcile();
    expect(queue.getState()?.dead).toBe(true);
    expect(queue.getState()?.deadReason).toContain('closed on the server');
  });

  it('marks the session dead when the server soft-deleted it', async () => {
    transport.sessions = [
      { ok: true, body: { maxSeq: 3, status: 'recording', deletedAt: '2026-07-27T00:00:00Z' } },
    ];
    await queue.reconcile();
    expect(queue.getState()?.deadReason).toContain('deleted');
  });

  it('a successful reconcile restores healthy state after transient failures', async () => {
    // Two failed POSTs push the HUD offline; the next 200 from the reconcile
    // GET proves the server reachable again and must reset the failure count —
    // with an empty upload queue nothing else ever would.
    queue.resetHealth();
    transport.events = [
      { ok: false, status: 503 },
      { ok: false, status: 503 },
    ];
    queue.pushEvent('click', {}, ROUTE);
    await queue.flush();
    await queue.flush();
    expect(queue.health().state).toBe('offline');
    transport.sessions = [{ ok: true, body: { maxSeq: 0, status: 'recording' } }];
    await queue.reconcile();
    expect(queue.health().state).toBe('ok');
    expect(queue.health().failures).toBe(0);
  });

  it('decides NOTHING while the server is unreachable (transient failure)', async () => {
    transport.sessions = [{ ok: false, status: 503 }];
    await queue.reconcile();
    expect(queue.getState()?.dead).toBeUndefined();
    expect(queue.health().failures).toBe(1);
  });

  it('freezes the HUD clock when a session dies mid-recording', async () => {
    transport.sessions = [{ ok: false, status: 404 }];
    await queue.reconcile();
    const rec = queue.getState();
    expect(rec?.resumeAt).toBeNull(); // elapsedOf() stops advancing
  });
});

describe('health (extension D4 — honest by construction)', () => {
  it('is idle with no session', () => {
    queue.setState(null);
    expect(queue.health().state).toBe('idle');
  });

  it('is ok + vacuously synced on a fresh session; capture desyncs until the POST lands', () => {
    queue.resetHealth();
    expect(queue.health().state).toBe('ok');
    expect(queue.health().synced).toBe(true); // nothing allocated — server has everything
    queue.pushEvent('click', {}, ROUTE);
    expect(queue.health().synced).toBe(false); // seq 1 allocated, server confirmed only 0
  });

  it('a successful events POST IS the server confirming those seqs → synced', async () => {
    queue.resetHealth();
    queue.pushEvent('click', {}, ROUTE);
    queue.pushEvent('nav', {}, ROUTE);
    await queue.flush();
    const h = queue.health();
    expect(h.serverMaxSeq).toBe(2);
    expect(h.synced).toBe(true);
  });

  it('goes offline after 2 consecutive failures and recovers on the next sync', async () => {
    queue.resetHealth();
    transport.events = [
      { ok: false, status: 503 },
      { ok: false, status: 503 },
    ];
    queue.pushEvent('click', {}, ROUTE);
    await queue.flush();
    expect(queue.health().state).toBe('ok'); // one failure is quiet
    await queue.flush();
    expect(queue.health().state).toBe('offline');
    expect(queue.health().error).toContain('503');
    await queue.flush(); // transport default: success
    expect(queue.health().state).toBe('ok');
    expect(queue.health().failures).toBe(0);
  });

  it('reports backlog when the queue outgrows the threshold', () => {
    queue.resetHealth();
    for (let i = 0; i < 41; i++) queue.pushEvent('click', { i }, ROUTE);
    expect(queue.health().state).toBe('backlog');
    expect(queue.health().queued).toBe(41);
  });

  it('reports dead with the reason once the server rejects the session', async () => {
    transport.events = [{ ok: false, status: 400 }];
    queue.pushEvent('click', {}, ROUTE);
    await queue.flush();
    const h = queue.health();
    expect(h.state).toBe('dead');
    expect(h.deadReason).toContain('rejected');
    expect(h.synced).toBe(false);
  });
});
