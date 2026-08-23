/**
 * Network capture tests:
 * the capture gate (zero work when not recording), the HARD body bound in every
 * path — including length-less/chunked responses — and pass-through fidelity
 * (the app's own response must never be disturbed).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

/** Recorded events, read from the REAL queue buffer. */
function recorded(): { kind: string; payload: Record<string, unknown> }[] {
  return queue
    .__bufferForTests()
    .map((e) => ({ kind: e.kind, payload: (e.payload ?? {}) as Record<string, unknown> }));
}

function liveSession(paused = false) {
  return {
    sessionId: 's1',
    project: 'example',
    environment: 'development',
    title: '',
    seq: 0,
    paused,
    activeMs: 0,
    resumeAt: new Date().toISOString(),
    shots: 0,
  };
}

// NOTE: deliberately NO mock of the queue/session modules — `mock.module` is
// process-wide in bun test, and stubbing them here silently broke session.test.ts
// in a full-suite run. This suite drives the REAL queue instead.
mock.module('expo-constants', () => ({
  default: { expoConfig: { ios: { bundleIdentifier: 'com.example.app.dev' }, version: '9.9.9' } },
}));

mock.module('expo-file-system/legacy', () => ({
  documentDirectory: '/docs/',
  getInfoAsync: async () => ({ exists: true }),
  makeDirectoryAsync: async () => undefined,
  deleteAsync: async () => undefined,
  moveAsync: async () => undefined,
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  uploadAsync: async () => ({ status: 200, body: '{}' }),
}));

const apiStatus = (await import(
  '../api-status'
)) as typeof import('../api-status');

mock.module('../api', () => ({
  api: async () => ({}),
  uploadShot: async () => ({ blobKey: 'b1' }),
  isVitrinkaUrl: (u: string) => u.startsWith('https://vitrinka.test'),
  vitrinkaConfigured: () => true,
  permanentStatus: apiStatus.permanentStatus,
  VitrinkaApiError: apiStatus.VitrinkaApiError,
}));

const queue = (await import(
  '../queue'
)) as typeof import('../queue');

/**
 * The fetch patch records OFF the caller's critical path (so the app is never
 * blocked on the recorder), so assertions must settle the capture first.
 */
async function settled() {
  await queue.capturesSettled();
}

const { patchNetwork, __readBoundedTextForTests, __setBodyReadDeadlineForTests } = (await import(
  '../capture/net'
)) as typeof import('../capture/net');

const LIMIT = 512 * 1024;

/** Build a Response whose body is only available as a stream (no content-length). */
function chunkedResponse(totalBytes: number): Response {
  const chunk = new TextEncoder().encode('x'.repeat(1024));
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      sent += chunk.byteLength;
    },
  });
  return new Response(stream, { status: 200, headers: {} }); // no content-length
}

/**
 * Minimal XHR stub: Bun has no XMLHttpRequest, and the patch must both survive
 * its absence and correctly wrap it when present.
 */
function makeStubXHR() {
  return class StubXHR {
    responseType = '';
    responseText = '';
    status = 200;
    private listeners: Record<string, (() => void)[]> = {};
    open(_m: string, _u: string) {}
    send(_b?: unknown) {}
    addEventListener(ev: string, fn: () => void) {
      (this.listeners[ev] ??= []).push(fn);
    }
    fire(ev: string) {
      for (const fn of this.listeners[ev] ?? []) fn();
    }
  };
}
type StubXHR = InstanceType<ReturnType<typeof makeStubXHR>>;

/**
 * The PRISTINE fetch, captured once at module load — before any test patches it.
 * Capturing inside beforeEach saved an already-patched stub, and restoring only
 * on process `exit` left globalThis.fetch wrapped for every later suite in the
 * bun process.
 */
const pristineFetch = globalThis.fetch;
let served: Response;
let fetchCalls = 0;

beforeEach(() => {
  queue.__resetForTests();
  queue.setState(liveSession());
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return served;
  }) as typeof globalThis.fetch;
  // Fresh patch per test: clear the globalThis mark the patch sets, and give
  // the XHR half a stub to wrap.
  (globalThis as Record<string, unknown>).__vitrinkaRecorderNetPatched = undefined;
  (globalThis as Record<string, unknown>).XMLHttpRequest = makeStubXHR();
  patchNetwork();
});

describe('fetch capture gate', () => {
  it('passes through untouched when no session is capturing', async () => {
    queue.setState(null);
    served = new Response('{"a":1}', { status: 200, headers: { 'content-length': '7' } });
    const res = await fetch('https://api.test/x');
    await settled();
    expect(await res.text()).toBe('{"a":1}'); // body still readable by the app
    expect(recorded()).toHaveLength(0); // nothing recorded, nothing read
  });

  it('never records the recorder‘s own vitrinka traffic', async () => {
    served = new Response('ok', { status: 200, headers: { 'content-length': '2' } });
    await fetch('https://vitrinka.test/api/v1/sessions');
    await settled();
    expect(recorded()).toHaveLength(0);
  });

  it('records method, status and duration while capturing', async () => {
    served = new Response('{"ok":true}', { status: 201, headers: { 'content-length': '11' } });
    await fetch('https://api.test/inquiries', { method: 'POST', body: '{"x":1}' });
    await settled();
    expect(recorded()).toHaveLength(1);
    const p = recorded()[0].payload;
    expect(recorded()[0].kind).toBe('net');
    expect(p.method).toBe('POST');
    expect(p.status).toBe(201);
    expect(typeof p.ms).toBe('number');
  });

  it('leaves the app‘s response consumable (reads only a clone)', async () => {
    served = new Response('{"payload":"mine"}', {
      status: 200,
      headers: { 'content-length': '18' },
    });
    const res = await fetch('https://api.test/x');
    await settled();
    expect(await res.json()).toEqual({ payload: 'mine' });
    expect(fetchCalls).toBe(1); // request issued exactly once
  });
});

describe('body bound', () => {
  it('omits a body whose DECLARED length exceeds the limit, without reading it', async () => {
    served = new Response('y'.repeat(64), {
      status: 200,
      headers: { 'content-length': String(LIMIT + 1) },
    });
    await fetch('https://api.test/big');
    await settled();
    expect(String(recorded()[0].payload.resBody)).toContain('[body omitted:');
  });

  it('BOUNDS a length-less (chunked) response instead of buffering it whole', async () => {
    // Regression: with no content-length the old code did res.clone().text()
    // with no bound at all.
    served = chunkedResponse(LIMIT * 3);
    await fetch('https://api.test/stream');
    await settled();
    const body = String(recorded()[0].payload.resBody);
    expect(body.length).toBeLessThan(LIMIT + 4096); // bounded, not 1.5 MB
    expect(body).toContain('truncated');
  });

  it('reads a small chunked response in full', async () => {
    served = chunkedResponse(2048);
    await fetch('https://api.test/small-stream');
    await settled();
    const body = String(recorded()[0].payload.resBody);
    expect(body.length).toBe(2048);
    expect(body).not.toContain('truncated');
  });

  it('caps a recorded body at BODY_CAP', async () => {
    const big = 'z'.repeat(100 * 1024);
    served = new Response(big, { status: 200, headers: { 'content-length': String(big.length) } });
    await fetch('https://api.test/med');
    await settled();
    expect(String(recorded()[0].payload.resBody)).toContain('[truncated]');
  });
});

describe('stream chunk bound', () => {
  // Asserting on the RECORDED body is vacuous: redactAndCap(BODY_CAP) caps it to
  // 64 KiB no matter how much was read. These call the reader directly so the
  // bound on the READ itself is what's under test.
  it('slices an oversized SINGLE chunk to the remaining allowance', async () => {
    const big = new TextEncoder().encode('q'.repeat(2 * 1024 * 1024));
    const res = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(big);
          c.close();
        },
      }),
      { status: 200 },
    );
    const out = (await __readBoundedTextForTests(res, res.headers)) as string;
    // Pre-cap output: bounded by BODY_READ_LIMIT (+ the truncation marker),
    // NOT by the 2 MB the stream offered in one chunk.
    expect(out.length).toBeLessThan(LIMIT + 200);
    expect(out).toContain('truncated');
  });

  it('reads many small chunks up to the bound and no further', async () => {
    let enqueued = 0;
    const chunk = new TextEncoder().encode('r'.repeat(64 * 1024));
    const res = new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          enqueued += chunk.byteLength;
          c.enqueue(chunk);
          if (enqueued > 4 * LIMIT) c.close();
        },
      }),
      { status: 200 },
    );
    const out = (await __readBoundedTextForTests(res, res.headers)) as string;
    // BOTH bounds: an implementation that read nothing, bailed after one chunk,
    // or returned undefined would satisfy the upper bound alone an earlier review.
    expect(out.length).toBeGreaterThanOrEqual(LIMIT);
    expect(out.length).toBeLessThan(LIMIT + 200);
    expect(out).toContain('truncated');
  });

  it('gives up on a stalled stream instead of parking forever', async () => {
    // Inject a short deadline: the real 3s burned wall clock and forced a 2x
    // slack assertion wide enough to hide a regression.
    const restore = __setBodyReadDeadlineForTests(120);
    try {
      const res = new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            return new Promise<void>(() => undefined); // never yields
          },
        }),
        { status: 200 },
      );
      const started = Date.now();
      const out = (await __readBoundedTextForTests(res, res.headers)) as string;
      const elapsed = Date.now() - started;
      expect(out).toContain('timed out');
      expect(elapsed).toBeGreaterThanOrEqual(110); // waited for the deadline
      expect(elapsed).toBeLessThan(600); // and not much past it
    } finally {
      restore();
    }
  });

  it('does not strand a deadline timer per chunk', async () => {
    // COUNT the timers, do not time the run: 8000 pending-but-harmless timeouts
    // don't slow Bun measurably, so a wall-clock assertion passed with the leak
    // present. Each read-vs-deadline race
    // creates one timer, and the fix clears it when the read wins.
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    let created = 0;
    let cleared = 0;
    const live = new Set<unknown>();
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      created++;
      const id = realSetTimeout(fn, ms);
      live.add(id);
      return id;
    }) as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((id: Parameters<typeof globalThis.clearTimeout>[0]) => {
      if (live.delete(id)) cleared++;
      return realClearTimeout(id);
    }) as typeof globalThis.clearTimeout;
    try {
      const one = new TextEncoder().encode('z');
      let sent = 0;
      const res = new Response(
        new ReadableStream<Uint8Array>({
          pull(c) {
            sent++;
            if (sent > 2000) return c.close();
            c.enqueue(one);
          },
        }),
        { status: 200 },
      );
      const out = (await __readBoundedTextForTests(res, res.headers)) as string;
      expect(out.length).toBe(2000);
      expect(created).toBeGreaterThanOrEqual(2000); // one race per chunk
      expect(live.size).toBe(0); // NONE left pending
      expect(cleared).toBe(created);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  });

  it('cancels a clone it decides not to read (declared length over the limit)', async () => {
    let cancelled = false;
    const res = new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(new TextEncoder().encode('x'));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200, headers: { 'content-length': String(LIMIT + 1) } },
    );
    const out = (await __readBoundedTextForTests(res, res.headers)) as string;
    expect(out).toContain('[body omitted:');
    await new Promise((r) => setTimeout(r, 10));
    expect(cancelled).toBe(true); // tee branch released, not left buffering
  });
});

describe('session binding', () => {
  it('drops a request that completes after its session ended', async () => {
    served = new Response('{"a":1}', { status: 200, headers: { 'content-length': '7' } });
    const inFlight = fetch('https://api.test/slow');
    queue.setState(null); // session A stopped while the request was in flight
    await inFlight;
    await settled();
    expect(recorded()).toHaveLength(0);
  });

  it('does not attribute session A‘s request to session B', async () => {
    served = new Response('{"a":1}', { status: 200, headers: { 'content-length': '7' } });
    const inFlight = fetch('https://api.test/slow');
    queue.setState(null);
    queue.setState({ ...liveSession(), sessionId: 'SESSION-B' }); // a new run starts
    await inFlight;
    await settled();
    expect(recorded()).toHaveLength(0); // belongs to A, which is gone — not B's stream
  });
});

describe('non-blocking record', () => {
  it('resolves the caller‘s fetch WITHOUT waiting for the body read', async () => {
    let released: (() => void) | undefined;
    const gate = new Promise<void>((res) => {
      released = res;
    });
    served = new Response(
      new ReadableStream<Uint8Array>({
        async pull(c) {
          await gate; // the recorder's read parks here
          c.enqueue(new TextEncoder().encode('done'));
          c.close();
        },
      }),
      { status: 200 },
    );
    const res = await fetch('https://api.test/slow-body'); // must NOT hang
    expect(res.status).toBe(200);
    released?.();
    await settled();
  });
});

describe('redaction integration', () => {
  it('redacts credentials out of recorded request bodies', async () => {
    served = new Response('{"ok":true}', { status: 200, headers: { 'content-length': '11' } });
    await fetch('https://api.test/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.cz', password: 'hunter2' }),
    });
    await settled();
    const req = String(recorded()[0].payload.reqBody);
    expect(req).not.toContain('hunter2');
    expect(req).toContain('a@b.cz');
  });

  it('redacts token query params out of the recorded URL', async () => {
    served = new Response('ok', { status: 200, headers: { 'content-length': '2' } });
    await fetch('https://api.test/verify?token=supersecret&id=7');
    await settled();
    const url = String(recorded()[0].payload.url);
    expect(url).not.toContain('supersecret');
    expect(url).toContain('id=7');
  });
});

describe('XHR capture', () => {
  it('does NOT read the body when capture stopped while the request was in flight', () => {
    // Regression: capturing() was only checked at send(), so a pause/stop
    // mid-flight still read + capped responseText for a discarded event
    //.
    const XHRCls = (globalThis as unknown as { XMLHttpRequest: ReturnType<typeof makeStubXHR> })
      .XMLHttpRequest;
    const xhr = new XHRCls();
    xhr.open('GET', 'https://api.test/slow');
    xhr.send();
    let read = false;
    Object.defineProperty(xhr, 'responseText', {
      get() {
        read = true;
        return '{"big":"payload"}';
      },
    });
    queue.setState(null); // user pressed Stop while in flight
    xhr.fire('loadend');
    expect(read).toBe(false);
    expect(recorded()).toHaveLength(0);
  });

  it('records the request when capture is still active at completion', () => {
    const XHRCls = (globalThis as unknown as { XMLHttpRequest: ReturnType<typeof makeStubXHR> })
      .XMLHttpRequest;
    const xhr = new XHRCls();
    xhr.open('POST', 'https://api.test/inquiries');
    xhr.send('{"x":1}');
    xhr.responseText = '{"ok":true}';
    xhr.fire('loadend');
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0].payload.via).toBe('xhr');
    expect(recorded()[0].payload.method).toBe('POST');
  });

  it('survives a runtime with no XMLHttpRequest at all', () => {
    (globalThis as Record<string, unknown>).__vitrinkaRecorderNetPatched = undefined;
    (globalThis as Record<string, unknown>).XMLHttpRequest = undefined;
    expect(() => patchNetwork()).not.toThrow();
  });
});

describe('errors', () => {
  it('records a failed request and rethrows to the caller', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof globalThis.fetch;
    (globalThis as Record<string, unknown>).__vitrinkaRecorderNetPatched = undefined;
    patchNetwork();
    await expect(fetch('https://api.test/x')).rejects.toThrow('network down');
    expect(String(recorded()[0].payload.error)).toContain('network down');
  });
});

// Restore the pristine fetch after EVERY test, so no later suite in this bun
// process inherits the patched stub.
afterEach(() => {
  globalThis.fetch = pristineFetch;
  (globalThis as Record<string, unknown>).__vitrinkaRecorderNetPatched = undefined;
  (globalThis as Record<string, unknown>).XMLHttpRequest = undefined;
});
