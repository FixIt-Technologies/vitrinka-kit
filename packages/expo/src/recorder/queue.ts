/**
 * Durable event queue — a port of the browser extension's design
 * (this repo, apps/extension/background.js), adapted to RN:
 *
 * - A synchronous KV store (./storage — file-system-backed by default, MMKV
 *   opt-in) replaces chrome.storage.local: reads/writes complete in one JS
 *   tick, so the extension's async mutex is unnecessary. Only flush() needs single-flight guarding
 *   (its POST is async) and it removes exactly the sent seqs on return.
 * - Failed shot uploads persist as files on disk (documentDirectory) with a
 *   small pendIdx in the KV store — session-bound, retried oldest-first AHEAD of the
 *   event flush, keeping their originally allocated seq (gap-fill).
 * - A permanent server verdict (4xx minus 408/429) drops the item loudly;
 *   transient failures stop the pass and the next flush retries.
 * - App restarts keep the undelivered tail (KV store + disk are both durable).
 * - Reconciliation (extension D5/D9): a 10s poll asks the server what it
 *   actually holds (`serverMaxSeq`) and whether the session still exists.
 *   Only the SERVER's verdict (404 / done / deleted / permanent events
 *   rejection) marks a session dead — flushing then stops instead of
 *   retrying into a session that can never accept another event.
 * - health() (extension D4): honest by construction — "synced" means the
 *   server confirmed it holds everything this recorder allocated, not
 *   merely "my last POST returned 200".
 */
import {
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  moveAsync,
} from 'expo-file-system/legacy';

import type { RecorderEvent } from '../protocol';
import { api, permanentStatus, uploadShot, VitrinkaApiError } from './api';
import { getRecorderStorage } from './storage';
import { notify } from './state';

const FLUSH_MS = 2000;
const MAX_BUFFER = 20000;
const MAX_PENDING = 200; // JPEG keyframes on disk; oldest evicted loudly
/**
 * Byte budgets for ONE events POST, mirroring the extension's pack-margin /
 * hard-cap split (splitRRWebEvents). The server rejects bodies over 4 MiB
 * (vitrinka `maxSessionEventBytes`, a 400 via MaxBytesReader) and 400 is a
 * PERMANENT verdict — so an oversized batch must never be assembled: 500
 * capped net events (64 KiB req + 64 KiB res each) can pass 4 MiB under
 * backlog. An event bigger than the pack margin but under the wire cap is
 * still deliverable — it rides ALONE; only one beyond the wire cap can never
 * upload and is dropped.
 */
const WIRE_BODY_CAP = 4 * 1024 * 1024;
const MAX_BATCH_BYTES = 3 * 1024 * 1024; // pack margin
const MAX_EVENT_BYTES = WIRE_BODY_CAP - 1024; // solo cap; headroom for the {"events":[…]} envelope

/**
 * UTF-8 byte length of a string — the unit MaxBytesReader limits. String
 * .length counts UTF-16 code units and undercounts CJK 3× and emoji 2× on
 * the wire, which is exactly how a "3 MiB" batch turns into a rejected 9 MiB
 * body. Surrogate pairs advance two units for their 4 bytes.
 */
function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) {
      n += 4; // lead surrogate: the pair encodes as 4 bytes
      i++;
    } else n += 3;
  }
  return n;
}
/** How often a live session reconciles against the server (extension D5). */
export const RECONCILE_MS = 10_000;
// Health thresholds (extension D4): quiet until one of these trips.
const OFFLINE_AFTER_MS = 15_000;
const BACKLOG_ITEMS = 40;

export const PEND_DIR = `${documentDirectory}vitrinka-recorder/`;

// Durable KV behind the pluggable driver (./storage) — synchronous by
// contract, file-system-backed by default, MMKV via the storage-mmkv subpath.
const kv = () => getRecorderStorage();

export interface SessionState {
  sessionId: string;
  project: string;
  environment: string;
  title: string;
  seq: number;
  paused: boolean;
  /** Active-time bookkeeping: elapsed = activeMs + (now - resumeAt while running). */
  activeMs: number;
  resumeAt: string | null;
  /**
   * Keyframes captured in this session. Lives WITH the durable session (not a
   * module singleton) so a recording recovered after a JS reload still shows
   * its true frame count in the HUD.
   */
  shots: number;
  /**
   * The SERVER will not accept this session's events any more (extension D9):
   * 404 / done / deleted from the reconcile poll, or a permanent verdict on
   * the events POST. Capture and flushing stop; Stop completes locally.
   * Durable so a JS reload cannot resurrect the pointless retry loop.
   */
  dead?: boolean;
  deadReason?: string;
  /**
   * Who drives this recording (machine-run design). 'ai' marks a run
   * started over the devtools control channel: the HUD shrinks to a quiet dot
   * so keyframes stay usable for design review, and the session carries
   * environment "sim" plus the `ai` tag on the server. Absent = a human
   * pressed the HUD, which behaves exactly as before.
   */
  driver?: 'ai';
  /**
   * Idle auto-stop window in ms (machine-run design); absent or 0 disables it.
   * Only the control channel sets this — a human-started session keeps relying
   * on the HUD's Stop and the server's 24h sweep.
   */
  idleStopMs?: number;
  /**
   * The workspace redaction policy fetched at session start (null = fetch
   * failed ⇒ the engine's safe defaults). Durable WITH the session so a JS
   * reload re-applies the same rules instead of silently reverting.
   */
  policy?: import('@vitrinka/redact').RedactionPolicy | null;
}

// The wire shape lives in ../protocol (the server pins its contract there);
// re-exported so recorder-internal callers keep their import site.
export type { RecorderEvent };

interface PendingShot {
  seq: number;
  ts: string;
  tabId: string;
  tabHost: string;
  sessionId: string;
  payload?: Record<string, unknown>;
  fileUri: string;
}

function readJson<T>(key: string, fallback: T): T {
  const raw = kv().getString(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// The session record is small and read on every event — cache it in memory and
// write through, so the capture hot path never parses JSON.
let recCache: SessionState | null | undefined;

/**
 * The LIVE session record — a mutable alias of the cache, not a copy (review
 * Returning a fresh parse per call would put JSON.parse back on
 * the capture hot path, which is exactly what the caching fixed.
 *
 * Contract for callers: treat it as READ-ONLY unless you are one of the
 * mutators in this module (`nextSeq`, `countShot`) or you pass the object you
 * mutated straight to `setState()` in the same tick — otherwise the in-memory
 * cache silently diverges from durable storage and the change is lost on reload.
 * `session.ts` (pause/stop bookkeeping) follows the mutate-then-`setState`
 * form deliberately.
 */
export function getState(): SessionState | null {
  if (recCache === undefined) recCache = readJson<SessionState | null>('rec', null);
  return recCache;
}

export function setState(rec: SessionState | null): void {
  recCache = rec;
  if (rec === null) kv().remove('rec');
  else kv().set('rec', JSON.stringify(rec));
}

/**
 * The event buffer lives in memory and is FLUSHED TO STORAGE on a debounce (plus
 * synchronously whenever it is read for upload or the session ends). Doing a
 * full JSON.parse + JSON.stringify of up to MAX_BUFFER events on every
 * captured touch/nav/net line was ~O(n) work per event on the JS thread
 *. Worst-case durability loss is now the
 * events captured in the last PERSIST_DEBOUNCE_MS before a hard app kill.
 */
const PERSIST_DEBOUNCE_MS = 700;

let bufferCache: RecorderEvent[] | undefined;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function getBuffer(): RecorderEvent[] {
  if (bufferCache === undefined) bufferCache = readJson<RecorderEvent[]>('buffer', []);
  return bufferCache;
}

/**
 * Write the in-memory buffer to storage NOW. Called before every upload, on
 * session end, and from the provider's AppState background handler — the
 * debounce is a batching optimization, never the only path to disk
 *.
 */
export function persistNow(): void {
  persistBuffer();
}

/** Write the in-memory buffer to storage now. */
function persistBuffer(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (bufferCache !== undefined) kv().set('buffer', JSON.stringify(bufferCache));
}

/** Mark the buffer dirty; storage catches up within PERSIST_DEBOUNCE_MS. */
function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistBuffer();
  }, PERSIST_DEBOUNCE_MS);
}

function setBuffer(buffer: RecorderEvent[]): void {
  bufferCache = buffer;
  persistBuffer();
}

function getPendIdx(): PendingShot[] {
  return readJson<PendingShot[]>('pendIdx', []);
}

function setPendIdx(idx: PendingShot[]): void {
  kv().set('pendIdx', JSON.stringify(idx));
}

export function queuedCount(): number {
  return getBuffer().length + getPendIdx().length;
}

// -- health + server reconciliation (extension D4/D5/D9) ---------------------

let lastSyncAt = 0;
let lastError = '';
let failures = 0;
/** Highest seq the SERVER confirmed (events-POST 200 or reconcile GET). */
let serverMaxSeq = -1;

function noteSync(): void {
  lastSyncAt = Date.now();
  failures = 0;
  lastError = '';
}

function noteFailure(e: unknown): void {
  failures++;
  lastError = String(e instanceof Error ? e.message : e).slice(0, 200);
}

/** Fresh-session baseline; called by startSession before capture begins. */
export function resetHealth(baseSeq = 0): void {
  lastSyncAt = Date.now();
  lastError = '';
  failures = 0;
  serverMaxSeq = baseSeq;
}

export type RecorderHealthState = 'idle' | 'ok' | 'backlog' | 'offline' | 'dead';

export interface RecorderHealth {
  state: RecorderHealthState;
  queued: number;
  failures: number;
  error: string;
  sinceSyncMs: number | null;
  localSeq: number;
  serverMaxSeq: number;
  /** The reconciliation itself: the server accounts for every allocated seq. */
  synced: boolean;
  deadReason: string;
}

/**
 * Honest health (extension D4): queue depth and last-successful-sync age come
 * from this module; `serverMaxSeq` from the reconcile poll / events-POST 200 —
 * so `synced` means "the server has everything I allocated", never merely
 * "my last POST succeeded". Synchronous because the storage driver is.
 */
export function health(): RecorderHealth {
  const rec = getState();
  const queued = queuedCount();
  const sinceSync = lastSyncAt ? Date.now() - lastSyncAt : null;
  let state: RecorderHealthState = 'idle';
  if (rec) {
    if (rec.dead) state = 'dead';
    else if (failures >= 2 || (queued > 0 && sinceSync !== null && sinceSync > OFFLINE_AFTER_MS))
      state = 'offline';
    else if (queued > BACKLOG_ITEMS) state = 'backlog';
    else state = 'ok';
  }
  return {
    state,
    queued,
    failures,
    error: lastError,
    sinceSyncMs: sinceSync,
    localSeq: rec?.seq ?? 0,
    serverMaxSeq,
    synced: rec !== null && !rec.dead && serverMaxSeq >= rec.seq && queued === 0,
    deadReason: rec?.dead ? (rec.deadReason ?? '') : '',
  };
}

/**
 * Record that the SERVER will not accept this session's events any more
 * (extension D9). Freezes the HUD clock (the recording is over in every way
 * that matters) and stops the retry loop; the durable tail stays on disk until
 * Stop — losing data silently behind the tester's back is never this module's
 * call to make.
 */
export function markSessionDead(reason: string): void {
  const rec = getState();
  if (!rec || rec.dead) return;
  rec.dead = true;
  rec.deadReason = reason;
  if (!rec.paused && rec.resumeAt) {
    rec.activeMs = (rec.activeMs || 0) + (Date.now() - Date.parse(rec.resumeAt));
    rec.resumeAt = null;
  }
  setState(rec);
  console.warn('vitrinka: session marked dead —', reason);
  notify();
}

/**
 * Ask the server what it actually holds (extension D5/D9). Two answers matter:
 * the maxSeq the HUD reconciles against, and whether the session still exists
 * at all. Only the SERVER's verdict may declare the session dead.
 */
export async function reconcile(): Promise<void> {
  const rec = getState();
  if (!rec || rec.dead) return;
  let ses: { maxSeq?: number; status?: string; deletedAt?: string | null };
  try {
    ses = await api('GET', `/api/v1/sessions/${rec.sessionId}`);
  } catch (e) {
    if (e instanceof VitrinkaApiError && e.status === 404) {
      markSessionDead('session no longer exists on the server');
      return;
    }
    noteFailure(e);
    notify();
    return;
  }
  if (getState()?.sessionId !== rec.sessionId) return; // stopped while the GET was in flight
  // A 200 here proves the server reachable — reset the failure streak, or an
  // empty-queue session would stay "offline" forever after two blips (nothing
  // else ever syncs when there is nothing to upload).
  noteSync();
  serverMaxSeq = Math.max(serverMaxSeq, Number(ses.maxSeq ?? 0));
  if (ses.status === 'done' || ses.deletedAt) {
    markSessionDead(ses.deletedAt ? 'session was deleted' : 'session was closed on the server');
    return;
  }
  notify();
}

let reconcileTimer: ReturnType<typeof setInterval> | null = null;

export function armReconcile(): void {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => {
    void reconcile();
  }, RECONCILE_MS);
}

export function disarmReconcile(): void {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
}

export async function ensurePendDir(): Promise<void> {
  const info = await getInfoAsync(PEND_DIR);
  if (!info.exists) await makeDirectoryAsync(PEND_DIR, { intermediates: true });
}

/** Allocate a seq without emitting an event (shot uploads name blobs by seq). */
export function nextSeq(): number | null {
  const rec = getState();
  if (!rec || rec.dead) return null;
  rec.seq++;
  setState(rec);
  return rec.seq;
}

/**
 * In-flight CAPTURES (keyframe grabs, async network body reads) that have not
 * yet appended their event. Stop must settle these before draining, or an event
 * lands after the drain snapshot and the session is PATCHed done without it
 *.
 *
 * Lives here rather than in session.ts so the capture layers don't have to
 * import session.ts (which would create a require cycle).
 */
const inFlightCaptures = new Set<Promise<void>>();

/** Register an in-flight capture; it is removed automatically when it settles. */
export function trackCapture(p: Promise<void>): Promise<void> {
  inFlightCaptures.add(p);
  const done = p
    .catch(() => undefined)
    .finally(() => {
      inFlightCaptures.delete(p);
    });
  return done;
}

/** How long Stop is willing to wait for in-flight captures before giving up. */
export const CAPTURES_SETTLE_MS = 5000;

/**
 * Wait for in-flight captures, bounded by `deadlineMs`.
 *
 * Returns TRUE when the set genuinely drained, FALSE when the deadline (or the
 * re-entrancy guard) expired with captures still registered — the caller must
 * decide what to do, and it is reported rather than silently swallowed
 *.
 *
 * The deadline exists because a capture is not guaranteed to finish: a network
 * body read parks until EOF or the byte bound, and a long-lived stream (SSE,
 * NDJSON, a stalled connection) may reach neither. Without it, Stop could hang
 * forever.
 */
export async function capturesSettled(deadlineMs = CAPTURES_SETTLE_MS): Promise<boolean> {
  const t0 = Date.now();
  // A settling capture can enqueue another (a shot's upload retry, say), so
  // loop until the set is genuinely empty rather than awaiting one snapshot.
  let guard = 0;
  while (inFlightCaptures.size > 0 && guard++ < 50) {
    const remaining = deadlineMs - (Date.now() - t0);
    if (remaining <= 0) break;
    const timeout = new Promise<void>((res) => setTimeout(res, remaining));
    await Promise.race([Promise.allSettled([...inFlightCaptures]), timeout]);
  }
  if (inFlightCaptures.size > 0) {
    // EVICT the stragglers. Leaving them registered made one never-settling
    // capture degrade the module permanently — every later Stop would pay the
    // full deadline again. The promises are abandoned, not
    // cancelled; their own `finally` delete becomes a no-op.
    const stuck = inFlightCaptures.size;
    inFlightCaptures.clear();
    console.warn(
      `vitrinka: ${stuck} capture(s) still in flight after ${Date.now() - t0}ms — abandoned, proceeding without them`,
    );
    return false;
  }
  return true;
}

/**
 * Is `id` the session currently in state AND still accepting capture? Used by
 * captures that span awaits. A dead session is not live: in-flight capture
 * work (a keyframe encode, a body read) must stop at its next checkpoint
 * rather than finish work the server already refused.
 */
export function isSessionLive(id: string): boolean {
  const rec = getState();
  return rec !== null && rec.sessionId === id && !rec.dead;
}

/** Count one captured keyframe on the durable session. */
export function countShot(): void {
  const rec = getState();
  if (!rec) return;
  rec.shots++;
  setState(rec);
}

/**
 * Append events to the durable buffer (drops when no live session or paused).
 * `tabId`/`tabHost`/`ts`/`seq` are filled here; capture layers pass kind+payload
 * plus the route info they observed. Returns the stamped ts (null when
 * dropped) — the annotate flow anchors its held keyframe at note-ts + 1ms.
 */
export function pushEvent(
  kind: string,
  payload: Record<string, unknown> | undefined,
  route: { tabId: string; tabHost: string },
): string | null {
  const rec = getState();
  if (!rec || rec.paused || rec.dead) return null;
  rec.seq++;
  const ts = new Date().toISOString();
  const buffer = getBuffer();
  buffer.push({
    seq: rec.seq,
    ts,
    tabId: route.tabId,
    tabHost: route.tabHost,
    kind,
    payload,
  });
  if (buffer.length > MAX_BUFFER) {
    const dropped = buffer.length - MAX_BUFFER;
    buffer.splice(0, dropped);
    console.warn(`vitrinka: retry buffer full — dropped ${dropped} oldest events`);
  }
  noteActivity();
  schedulePersist();
  setState(rec);
  scheduleFlush();
  return ts;
}

/** Push a fully-formed event (shot pointer events carry a pre-allocated seq). */
export function pushRawEvent(ev: RecorderEvent): void {
  getBuffer().push(ev);
  noteActivity();
  schedulePersist();
  scheduleFlush();
}

// -- idle tracking (machine-run design) --------------------------------------

/**
 * When capture last APPENDED something. Deliberately a module var rather than
 * a field on the durable session: it is written on every event and storage
 * writes are synchronous, so persisting it would add a round-trip per touch
 * for a value whose only consumer is an in-memory timer. A JS reload resets it,
 * which is correct — the reload is itself activity, and the watchdog re-arms
 * from `armIdleStop` with a fresh baseline.
 */
let lastEventAt = Date.now();

function noteActivity(): void {
  lastEventAt = Date.now();
}

/** How long capture has been silent, in ms. */
export function idleMs(): number {
  return Date.now() - lastEventAt;
}

/** Reset the idle clock — called when a session starts and when one arms. */
export function resetIdle(): void {
  noteActivity();
}

/** Persist a failed shot upload for oldest-first retry, bound to its session. */
export async function queuePendingShot(item: PendingShot): Promise<void> {
  const idx = getPendIdx();
  idx.push(item);
  while (idx.length > MAX_PENDING) {
    const drop = idx.shift();
    console.warn(`vitrinka: pending upload queue full — dropped shot seq ${drop?.seq}`);
    if (drop) await deleteAsync(drop.fileUri, { idempotent: true });
  }
  setPendIdx(idx);
}

/**
 * Retry queued shot uploads oldest-first. Items are BOUND to their
 * originating session — an upload that began under session A must never
 * complete into session B; stale-session items drop loudly. Returns true
 * when the queue is empty.
 */
async function drainPending(limit = 5): Promise<boolean> {
  const idx = getPendIdx();
  if (idx.length === 0) return true;
  const rec = getState();
  let done = 0;
  const gone = new Set<number>();
  for (const item of idx) {
    if (done >= limit) break;
    done++;
    if (!rec || item.sessionId !== rec.sessionId) {
      console.warn(`vitrinka: dropping shot seq ${item.seq} from ended session ${item.sessionId}`);
      gone.add(item.seq);
      await deleteAsync(item.fileUri, { idempotent: true });
      continue;
    }
    try {
      const up = await uploadShot(rec.sessionId, item.seq, item.fileUri);
      // The pointer event joins the buffer only now, keeping its original
      // seq — a late retry fills the stream's gap.
      pushRawEvent({
        seq: item.seq,
        ts: item.ts,
        tabId: item.tabId,
        tabHost: item.tabHost,
        kind: 'shot',
        blobKey: up.blobKey,
        payload: item.payload,
      });
      noteSync();
      gone.add(item.seq);
      await deleteAsync(item.fileUri, { idempotent: true });
    } catch (e) {
      if (e instanceof VitrinkaApiError && permanentStatus(e.status)) {
        console.warn(`vitrinka: shot seq ${item.seq} rejected permanently (${e.status}) — dropped`);
        gone.add(item.seq);
        await deleteAsync(item.fileUri, { idempotent: true });
        continue;
      }
      noteFailure(e);
      console.warn('vitrinka: pending upload retry failed', e);
      break; // transient — stop the pass, the next flush retries
    }
  }
  if (gone.size) setPendIdx(getPendIdx().filter((p) => !gone.has(p.seq)));
  return getPendIdx().length === 0;
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_MS);
}

let flushBusy = false;

/**
 * Single-flight: stop's drain loop and the scheduled timer must never
 * overlap — overlapping drains could double-POST the same pending head.
 * Returns true when the events POST succeeded (or there was nothing to send).
 */
export async function flush(): Promise<boolean> {
  if (flushBusy) return false;
  flushBusy = true;
  try {
    return await flushInner();
  } finally {
    flushBusy = false;
  }
}

async function flushInner(): Promise<boolean> {
  // A dead session has a server verdict — POSTing into it can never succeed.
  // The tail stays on disk; Stop settles its fate (extension D9).
  if (getState()?.dead) return false;
  const pendingClear = await drainPending();
  if (!pendingClear) scheduleFlush();
  const rec = getState();
  const buffer = getBuffer();
  if (!rec || buffer.length === 0) return pendingClear;
  // Batch by COUNT and WIRE BYTES (the server caps both — 500 events / 4 MiB
  // of UTF-8). Greedy in-order pack under the pack margin; an event bigger
  // than the margin but under the wire cap is deliverable and rides ALONE.
  // Only an event beyond the wire cap can NEVER upload — solo-POSTing it hits
  // the permanent-400/dead path — so it is dropped loudly instead of dooming
  // the session (extension precedent: splitRRWebEvents reports these dropped).
  const batch: RecorderEvent[] = [];
  const oversized = new Set<number>();
  let batchBytes = 0;
  for (const ev of buffer) {
    if (batch.length >= 500) break;
    const b = utf8Bytes(JSON.stringify(ev)) + 1;
    if (b > MAX_EVENT_BYTES) {
      console.warn(`vitrinka: event seq ${ev.seq} (${b} bytes) exceeds the wire cap — dropped`);
      oversized.add(ev.seq);
      continue;
    }
    if (b > MAX_BATCH_BYTES) {
      // Deliverable but unpackable: its own solo POST, in order.
      if (batch.length === 0) {
        batch.push(ev);
        batchBytes = b;
      }
      break; // send what precedes it first (or it alone) — FIFO preserved
    }
    if (batch.length > 0 && batchBytes + b > MAX_BATCH_BYTES) break;
    batch.push(ev);
    batchBytes += b;
  }
  if (oversized.size) {
    setBuffer(getBuffer().filter((ev) => !oversized.has(ev.seq)));
    if (!batch.length) {
      // Only undeliverables at the head this pass — let the timer re-enter.
      scheduleFlush();
      return false;
    }
  }
  // The batch is in flight — make sure it is on disk before the network call,
  // so a crash mid-POST cannot lose it (the in-memory buffer is debounced).
  persistBuffer();
  try {
    await api('POST', `/api/v1/sessions/${rec.sessionId}/events`, { events: batch });
  } catch (e) {
    if (e instanceof VitrinkaApiError && permanentStatus(e.status)) {
      // A verdict retrying can never fix (revoked token, deleted session):
      // terminal for the whole session, not just this batch — dropping the
      // batch and carrying on would silently record into a void (extension
      // D9; supersedes an earlier per-batch drop). The buffer
      // is kept for Stop to settle.
      markSessionDead(`server rejected this session (${e.status})`);
      return false;
    }
    // Transient: keep the buffer; the next event (or stop) retries. Losing
    // events silently would be worse than a late batch.
    noteFailure(e);
    notify();
    console.warn('vitrinka: flush failed, retrying', e);
    scheduleFlush();
    return false;
  }
  noteSync();
  // A 200 IS the server confirming it holds these seqs — take it rather than
  // waiting for the 10s reconcile tick (extension: freshly-started recorders
  // otherwise show "server has 0/N" exactly when the tester watches closest).
  serverMaxSeq = Math.max(serverMaxSeq, batch[batch.length - 1]?.seq ?? serverMaxSeq);
  notify();
  // Remove EXACTLY the sent seqs — events pushed during the in-flight POST survive.
  const sent = new Set(batch.map((e) => e.seq));
  const rest = getBuffer().filter((e) => !sent.has(e.seq));
  setBuffer(rest);
  if (rest.length) scheduleFlush();
  return true;
}

/**
 * Drain until the buffer + pending queue are empty or the deadline passes.
 * Returns true when fully drained; a timed-out tail stays queued (never deleted).
 */
export async function drainBuffer(deadlineMs = 60000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    if (getBuffer().length === 0 && getPendIdx().length === 0) return true;
    const sent = await flush();
    if (getState()?.dead) return false; // no point retrying a dead session
    if (!sent) await new Promise<void>((res) => setTimeout(res, 1000));
  }
  console.warn('vitrinka: drain timed out — remaining events stay queued');
  return false;
}

/** Reset buffers for a fresh session; orphaned pend files are swept. */
export async function resetQueues(): Promise<void> {
  setBuffer([]);
  const idx = getPendIdx();
  for (const p of idx) await deleteAsync(p.fileUri, { idempotent: true });
  setPendIdx([]);
  await ensurePendDir();
}

/**
 * Test-only: drop all module state (caches, timers, single-flight latch) so
 * suites cannot leak a scheduled 2s flush into each other.
 */
export function __resetForTests(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushBusy = false;
  inFlightCaptures.clear();
  recCache = undefined;
  bufferCache = undefined;
  kv().remove('rec');
  kv().remove('buffer');
  kv().remove('pendIdx');
  disarmReconcile();
  lastSyncAt = 0;
  lastError = '';
  failures = 0;
  serverMaxSeq = -1;
  resetIdle();
}

/** Test-only: the recorded events currently buffered (in order). */
export function __bufferForTests(): RecorderEvent[] {
  return getBuffer();
}

/**
 * Test-only: drop the in-memory caches while LEAVING storage intact — the cold-start
 * recovery path (a restart re-reads the durable tail from disk).
 */
export function __dropCachesForTests(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushBusy = false;
  recCache = undefined;
  bufferCache = undefined;
  // A real JS reload also resets the in-memory health module state.
  disarmReconcile();
  lastSyncAt = 0;
  lastError = '';
  failures = 0;
  serverMaxSeq = -1;
}

/** Move a tmpfile into the pending dir so it survives cache purges. */
export async function persistShotFile(tmpUri: string, seq: number): Promise<string> {
  await ensurePendDir();
  const dest = `${PEND_DIR}pend-${seq}.jpg`;
  await moveAsync({ from: tmpUri, to: dest });
  return dest;
}
