/**
 * Session lifecycle tests: the ordering guarantee that
 * matters is `stopSession()` awaiting the in-flight keyframe BEFORE draining
 * and PATCHing done. Testing `shotSettled()` in isolation (as the first round
 * did) would still pass if that await were deleted — so these call the real
 * `stopSession` and assert the observed call ORDER.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const calls: string[] = [];

/** Scripted failures (null = succeed). */
const script: { eventsError: number | null; tagsError: number | null } = {
  eventsError: null,
  tagsError: null,
};

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

/** Transport that records WHEN each call happened, relative to the shot settle. */
const api = mock(async (_method: string, path: string, body?: unknown) => {
  if (path.endsWith('/events')) {
    if (script.eventsError !== null) {
      throw new apiStatus.VitrinkaApiError(`status ${script.eventsError}`, script.eventsError);
    }
    calls.push('drain:events');
  } else if (path.endsWith('/tags')) {
    if (script.tagsError !== null) {
      throw new apiStatus.VitrinkaApiError(`status ${script.tagsError}`, script.tagsError);
    }
    calls.push('tags');
  } else if (path === '/api/v1/sessions') {
    // Create echoes back what the SERVER resolved — including the environment,
    // which is the field the sim lane rides on.
    calls.push('create');
    const b = (body ?? {}) as { environment?: string; title?: string };
    return {
      id: 'sess-new',
      project: 'example',
      environment: b.environment || 'development',
      title: b.title ?? '',
    };
  } else if (typeof body === 'object' && body !== null && 'status' in body) {
    calls.push(`patch:${(body as { status: string }).status}`);
  }
  return { boardSlug: 'example-session-1', board: { url: 'https://vitrinka.test/b/1' } };
});

// Real status vocabulary (native-import-free), so the mocked transport keeps
// the shipped permanent/transient classification.
const apiStatus = (await import(
  '../api-status'
)) as typeof import('../api-status');

// Scripted workspace policy for the fetchPolicy mock (null = fetch failed /
// server too old ⇒ the engine's safe defaults).
type PolicyResult = import('@vitrinka/redact').RedactionPolicy | null;
let policyScript: PolicyResult | Promise<PolicyResult> = null;

mock.module('../api', () => ({
  api,
  // Awaited so a test can hand it a pending Promise (slow-policy scenarios).
  fetchPolicy: async () => await policyScript,
  uploadShot: async () => ({ blobKey: 'b1' }),
  permanentStatus: apiStatus.permanentStatus,
  VitrinkaApiError: apiStatus.VitrinkaApiError,
  isVitrinkaUrl: (u: string) => u.startsWith('https://vitrinka.test'),
  vitrinkaConfigured: () => true,
}));

const queue = (await import(
  '../queue'
)) as typeof import('../queue');
const session = (await import(
  '../session'
)) as typeof import('../session');
const redact = (await import(
  '../capture/redact'
)) as typeof import('../capture/redact');

beforeEach(() => {
  calls.length = 0;
  script.eventsError = null;
  script.tagsError = null;
  session.__setIdleTickForTests();
  session.disarmIdleStop();
  api.mockClear();
  queue.__resetForTests();
  queue.setState({
    sessionId: 'sess-1',
    project: 'example',
    environment: 'development',
    title: '',
    seq: 0,
    paused: false,
    activeMs: 0,
    resumeAt: new Date().toISOString(),
    shots: 0,
  });
});

describe('stopSession ordering', () => {
  it('settles the in-flight capture BEFORE draining and patching done', async () => {
    // A capture that is mid-flight when Stop is pressed — exactly the Stop-tap
    // screenshot whose seq used to land after the drain snapshot.
    let finishShot: (() => void) | undefined;
    const shot = new Promise<void>((res) => {
      finishShot = () => {
        calls.push('shot:settled');
        // The keyframe's own event joins the buffer as it completes.
        queue.pushRawEvent({
          seq: 99,
          ts: new Date().toISOString(),
          tabId: 'home',
          tabHost: '/home',
          kind: 'shot',
          blobKey: 'b1',
        });
        res();
      };
    });
    void queue.trackCapture(shot);

    const stopping = session.stopSession();
    await Promise.resolve();
    expect(calls).toEqual([]); // parked on the shot — nothing drained yet
    finishShot?.();
    await stopping;

    expect(calls[0]).toBe('shot:settled');
    expect(calls).toContain('drain:events');
    expect(calls.indexOf('shot:settled')).toBeLessThan(calls.indexOf('drain:events'));
    expect(calls[calls.length - 1]).toBe('patch:done');
  });

  it('uploads the Stop-tap keyframe rather than orphaning it', async () => {
    let finishShot: (() => void) | undefined;
    const shot = new Promise<void>((res) => {
      finishShot = () => {
        queue.pushRawEvent({
          seq: 42,
          ts: new Date().toISOString(),
          tabId: 'home',
          tabHost: '/home',
          kind: 'shot',
          blobKey: 'b42',
        });
        res();
      };
    });
    void queue.trackCapture(shot);
    const stopping = session.stopSession();
    await Promise.resolve();
    finishShot?.();
    await stopping;

    const sentSeqs = api.mock.calls
      .filter((c) => String(c[1]).endsWith('/events'))
      .flatMap((c) => (c[2] as { events: { seq: number }[] }).events.map((e) => e.seq));
    expect(sentSeqs).toContain(42);
    expect(queue.getState()).toBeNull(); // session cleared after a successful stop
  });

  it('clears the local session and queues after a successful stop', async () => {
    queue.pushEvent('click', {}, { tabId: 'home', tabHost: '/home' });
    const done = await session.stopSession();
    expect(done?.board?.url).toBe('https://vitrinka.test/b/1');
    expect(queue.getState()).toBeNull();
    expect(queue.queuedCount()).toBe(0);
  });

  it('is a no-op with no live session', async () => {
    queue.setState(null);
    expect(await session.stopSession()).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });
});

describe('terminal verdict mid-drain', () => {
  it('a permanent rejection discovered MID-DRAIN still completes the stop in ONE press', async () => {
    // The permanent events rejection surfaces inside the drain that Stop
    // itself started — the stop must complete locally right there, not tell
    // the tester to press Stop again.
    script.eventsError = 400;
    queue.pushEvent('click', {}, { tabId: 'home', tabHost: '/home' });
    await expect(session.stopSession()).rejects.toThrow(/ended locally/);
    expect(queue.getState()).toBeNull(); // one press, session gone
    expect(queue.queuedCount()).toBe(0);
    expect(calls).not.toContain('patch:done'); // dead session is never PATCHed
  });
});

describe('dead session (extension D9 — the server refused it)', () => {
  beforeEach(() => {
    queue.markSessionDead('session was closed on the server');
  });

  it('Stop completes locally with the reason instead of draining into a void', async () => {
    queue.pushRawEvent({
      seq: 1,
      ts: new Date().toISOString(),
      tabId: 'home',
      tabHost: '/home',
      kind: 'click',
    });
    await expect(session.stopSession()).rejects.toThrow(/closed on the server/);
    expect(queue.getState()).toBeNull(); // local session cleared
    expect(queue.queuedCount()).toBe(0); // tail settled (discarded with the reason)
    // Neither a drain POST nor a done PATCH ever left the device.
    expect(calls).toEqual([]);
  });

  it('the thrown reason reports how many undelivered items were discarded', async () => {
    queue.pushRawEvent({
      seq: 1,
      ts: new Date().toISOString(),
      tabId: 'home',
      tabHost: '/home',
      kind: 'click',
    });
    await expect(session.stopSession()).rejects.toThrow(/1 undelivered item/);
  });

  it('togglePause is a no-op on a dead session (no PATCH, no state change)', async () => {
    expect(await session.togglePause()).toBe(false);
    expect(queue.getState()?.paused).toBeFalsy();
    expect(calls).toEqual([]);
  });

  it('markSessionDead froze the clock', () => {
    const rec = queue.getState();
    expect(rec?.dead).toBe(true);
    expect(rec?.resumeAt).toBeNull();
    const at = session.elapsedOf(rec);
    expect(session.elapsedOf(queue.getState())).toBe(at);
  });
});

describe('pause bookkeeping', () => {
  it('freezes elapsed time on pause and resumes from the frozen value', async () => {
    const rec = queue.getState();
    if (rec) {
      rec.activeMs = 5000;
      rec.resumeAt = new Date(Date.now() - 1000).toISOString();
      queue.setState(rec);
    }
    await session.togglePause(); // → paused
    const frozen = queue.getState();
    expect(frozen?.paused).toBe(true);
    expect(frozen?.resumeAt).toBeNull();
    expect(frozen?.activeMs).toBeGreaterThanOrEqual(6000); // 5s + the ~1s running
    const atPause = session.elapsedOf(frozen);

    await new Promise((r) => setTimeout(r, 30));
    expect(session.elapsedOf(queue.getState())).toBe(atPause); // clock does not advance

    await session.togglePause(); // → recording
    expect(queue.getState()?.paused).toBe(false);
    expect(queue.getState()?.resumeAt).not.toBeNull();
  });

  it('reports the pause/resume status to the server', async () => {
    await session.togglePause();
    expect(calls).toContain('patch:paused');
    await session.togglePause();
    expect(calls).toContain('patch:recording');
  });
});

describe('addAnnotation (region annotate)', () => {
  const heldMock = (scale = 2) => {
    const h = { commits: [] as string[], discards: 0 };
    return {
      h,
      held: {
        scale,
        commit: (ts: string) => h.commits.push(ts),
        discard: () => h.discards++,
      },
    };
  };

  it('emits the extension-shaped annotate-note and commits the held frame with its ts', () => {
    const { h, held } = heldMock();
    session.addAnnotation('broken padding', { x: 10, y: 20.4, w: 100, h: 50 }, held);
    const notes = queue.__bufferForTests().filter((e) => e.kind === 'note');
    expect(notes).toHaveLength(1);
    // Rect scaled to image px (PixelRatio 2 in the test preload), rounded.
    expect(notes[0]?.payload).toEqual({
      text: 'broken padding',
      rect: { x: 20, y: 41, w: 200, h: 100 },
      annotate: true,
    });
    expect(h.commits).toEqual([notes[0]?.ts]); // shot anchors to THIS note's ts
    expect(h.discards).toBe(0);
  });

  it('scales the rect by the HELD FRAME’s capture scale, not the screen density', () => {
    // A blurred keyframe (maskAllText) is 96px wide — rects converted at
    // PixelRatio would land far outside the image.
    const { held } = heldMock(96 / 390);
    session.addAnnotation('tiny', { x: 39, y: 78, w: 195, h: 390 }, held);
    const notes = queue.__bufferForTests().filter((e) => e.kind === 'note');
    expect(notes[0]?.payload).toEqual({
      text: 'tiny',
      rect: { x: 10, y: 19, w: 48, h: 96 },
      annotate: true,
    });
  });

  it('an empty note is still a valid annotation', () => {
    const { h, held } = heldMock();
    session.addAnnotation('', { x: 0, y: 0, w: 40, h: 40 }, held);
    expect(queue.__bufferForTests().filter((e) => e.kind === 'note')).toHaveLength(1);
    expect(h.commits).toHaveLength(1);
  });

  it('discards the held frame when the note is dropped (paused session)', async () => {
    await session.togglePause();
    const { h, held } = heldMock();
    session.addAnnotation('late', { x: 0, y: 0, w: 40, h: 40 }, held);
    expect(queue.__bufferForTests().filter((e) => e.kind === 'note')).toHaveLength(0);
    expect(h.commits).toHaveLength(0);
    expect(h.discards).toBe(1); // no orphan keyframe without its note
  });
});

describe('cornersToRect', () => {
  it('normalizes drags in every direction to a positive-size rect', () => {
    const expected = { x: 10, y: 20, w: 30, h: 40 };
    expect(session.cornersToRect(10, 20, 40, 60)).toEqual(expected); // ↘
    expect(session.cornersToRect(40, 60, 10, 20)).toEqual(expected); // ↖
    expect(session.cornersToRect(40, 20, 10, 60)).toEqual(expected); // ↙
    expect(session.cornersToRect(10, 60, 40, 20)).toEqual(expected); // ↗
  });

  it('a zero drag yields a zero rect (the overlay treats it as no-op)', () => {
    expect(session.cornersToRect(5, 5, 5, 5)).toEqual({ x: 5, y: 5, w: 0, h: 0 });
  });
});

// -- machine-driven sessions (AI-sim decisions #3 and #5) --------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The body of the Nth `POST /api/v1/sessions` the transport saw. */
function createBody(): Record<string, unknown> {
  const call = api.mock.calls.find((c) => c[1] === '/api/v1/sessions');
  return (call?.[2] ?? {}) as Record<string, unknown>;
}

describe('redaction policy at session start', () => {
  it('stores the fetched workspace policy on the session and applies it', async () => {
    policyScript = { maskAllText: true, extraBodyKeys: ['internalId'] };
    try {
      await session.startSession();
      expect(queue.getState()?.policy).toEqual(policyScript);
      expect(redact.currentRules().maskAllText).toBe(true);
    } finally {
      policyScript = null;
      redact.setRedactionPolicy(null);
    }
  });

  it('FAIL CLOSED: a failed policy fetch means the safe defaults, never full fidelity', async () => {
    policyScript = null; // fetchPolicy resolved null — fetch failed / old server
    await session.startSession();
    expect(queue.getState()?.policy).toBeNull();
    const rules = redact.currentRules();
    expect(rules.full).toBe(false);
    expect(redact.redactHeaders({ Authorization: 'Bearer x' })?.Authorization).toBe('[redacted]');
  });

  it('does NOT block session start on a slow policy fetch — defaults capture until it lands', async () => {
    let release: (p: PolicyResult) => void = () => undefined;
    policyScript = new Promise<PolicyResult>((res) => {
      release = res;
    });
    try {
      // startSession must resolve while the policy fetch is still pending —
      // a stalled policy endpoint must never leave capture unstarted (and the
      // server session orphaned). Defaults apply meanwhile.
      const rec = await session.startSession();
      expect(rec.sessionId).toBe('sess-new');
      expect(redact.currentRules().maskAllText).toBe(false);
      // The policy lands later and applies to the STILL-CURRENT session.
      release({ maskAllText: true });
      await new Promise((r) => setTimeout(r, 0));
      expect(redact.currentRules().maskAllText).toBe(true);
      expect(queue.getState()?.policy).toEqual({ maskAllText: true });
    } finally {
      policyScript = null;
      redact.setRedactionPolicy(null);
    }
  });

  it('recovery REFETCHES a policy whose start-time fetch never settled (JS reload)', async () => {
    // policy === undefined on the recovered session ⇒ the fetch promise died
    // with the old runtime — without a refetch the session would run on the
    // defaults forever and workspace extras/maskAllText would never apply.
    policyScript = { maskAllText: true };
    try {
      const rec = queue.getState();
      if (rec) queue.setState({ ...rec, policy: undefined });
      redact.setRedactionPolicy(null);
      session.recoverRedactionPolicy();
      await new Promise((r) => setTimeout(r, 0));
      expect(redact.currentRules().maskAllText).toBe(true);
      expect(queue.getState()?.policy).toEqual({ maskAllText: true });
    } finally {
      policyScript = null;
      redact.setRedactionPolicy(null);
    }
  });

  it('recovery does NOT refetch when the original fetch completed (null = failed ⇒ defaults)', async () => {
    policyScript = { maskAllText: true }; // would flip the rules IF a refetch ran
    try {
      const rec = queue.getState();
      if (rec) queue.setState({ ...rec, policy: null });
      redact.setRedactionPolicy(null);
      session.recoverRedactionPolicy();
      await new Promise((r) => setTimeout(r, 0));
      expect(redact.currentRules().maskAllText).toBe(false);
      expect(queue.getState()?.policy).toBeNull();
    } finally {
      policyScript = null;
      redact.setRedactionPolicy(null);
    }
  });

  it('stopSession resets the active rules to the defaults', async () => {
    policyScript = { fullFidelity: true };
    try {
      await session.startSession();
      expect(redact.currentRules().full).toBe(true);
      await session.stopSession();
      expect(redact.currentRules().full).toBe(false);
    } finally {
      policyScript = null;
      redact.setRedactionPolicy(null);
    }
  });
});

describe('startSession lane + tagging', () => {
  it('a human HUD start stays on the app-id rule and attaches nothing', async () => {
    await session.startSession();
    const body = createBody();
    // Sending environment:'' would NOT fall through to the app rule — it would
    // create a session with a blank environment. The key must be ABSENT.
    expect('environment' in body).toBe(false);
    expect((body.meta as Record<string, unknown>).driver).toBeUndefined();
    expect(calls).not.toContain('tags');
    expect(queue.getState()?.driver).toBeUndefined();
    expect(queue.getState()?.environment).toBe('development');
  });

  it('a machine-driven start rides the sim lane and carries the ai tag', async () => {
    await session.startSession({
      title: 'offers flow',
      environment: 'sim',
      driver: 'ai',
      tags: ['ai', 'sim', 'branch-x'],
      idleStopMs: 600_000,
    });
    const body = createBody();
    expect(body.environment).toBe('sim');
    expect((body.meta as Record<string, unknown>).driver).toBe('ai');
    expect(calls).toContain('tags');

    const tagCall = api.mock.calls.find((c) => String(c[1]).endsWith('/tags'));
    expect(tagCall?.[1]).toBe('/api/v1/sessions/sess-new/tags');
    expect((tagCall?.[2] as { tags: string[] }).tags).toEqual(['ai', 'sim', 'branch-x']);

    const rec = queue.getState();
    expect(rec?.driver).toBe('ai');
    expect(rec?.idleStopMs).toBe(600_000);
    // The server's echo is what the HUD shows — not what we asked for.
    expect(rec?.environment).toBe('sim');
  });

  it('a failed tag attach does not fail the start (the lane is the environment)', async () => {
    script.tagsError = 500;
    const rec = await session.startSession({ environment: 'sim', driver: 'ai', tags: ['ai'] });
    expect(rec.sessionId).toBe('sess-new');
    expect(rec.environment).toBe('sim'); // separation survives a lost tag
    expect(queue.getState()).not.toBeNull();
  });
});

describe('idle auto-stop', () => {
  it('stops and patches done after the idle window elapses', async () => {
    session.__setIdleTickForTests(5);
    await session.startSession({ environment: 'sim', driver: 'ai', idleStopMs: 30 });
    expect(queue.getState()).not.toBeNull();

    await sleep(150);

    expect(queue.getState()).toBeNull(); // the session really ended
    expect(calls).toContain('patch:done');
  });

  it('does not stop while capture keeps producing events', async () => {
    session.__setIdleTickForTests(5);
    await session.startSession({ environment: 'sim', driver: 'ai', idleStopMs: 60 });

    // Busier than the idle window for well past it — a watchdog that ignored
    // activity would have fired several ticks ago.
    for (let i = 0; i < 8; i++) {
      queue.pushEvent('click', { x: i, y: i }, { tabId: 'home', tabHost: '/home' });
      await sleep(15);
    }
    expect(queue.getState()).not.toBeNull();
    expect(calls).not.toContain('patch:done');

    // Go quiet — now it must close on its own.
    await sleep(150);
    expect(queue.getState()).toBeNull();
  });

  it('is never armed for a session that did not ask for one', async () => {
    session.__setIdleTickForTests(5);
    await session.startSession(); // human start: no idleStopMs
    await sleep(120);
    expect(queue.getState()).not.toBeNull();
    expect(calls).not.toContain('patch:done');
  });
});
