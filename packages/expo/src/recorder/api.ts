/**
 * Vitrinka API client for the journey recorder (dev-only module).
 *
 * Ingest contract, shared with the browser extension
 * (this repo, apps/extension/background.js):
 *   POST  /api/v1/sessions            {app, title, meta}  → session
 *   POST  /api/v1/sessions/:id/events {events: [...]}
 *   POST  /api/v1/sessions/:id/shot?seq=N   (image body)
 *   PATCH /api/v1/sessions/:id        {status: recording|paused|done}
 *
 * Config is env-baked at build time: EXPO_PUBLIC_VITRINKA_URL +
 * EXPO_PUBLIC_VITRINKA_TOKEN. Keep the token out of committed env files —
 * inject it per machine (a gitignored env overlay) or per build profile (e.g.
 * an EAS environment).
 *
 * SECURITY POSTURE: the bearer token is the only thing protecting the target
 * workspace — vitrinka ingest routes carry no ingest-only scope, so a token
 * extracted from a distributed build grants workspace-wide read from anywhere
 * the server is reachable. Treat tokens baked into internally-distributed
 * builds (TestFlight and similar) as rotate-per-build-round credentials,
 * never long-lived ones.
 */
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';

import { VitrinkaApiError } from './api-status';

const BASE = (process.env.EXPO_PUBLIC_VITRINKA_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.EXPO_PUBLIC_VITRINKA_TOKEN ?? '';

export function vitrinkaConfigured(): boolean {
  return BASE !== '' && TOKEN !== '';
}

/** Recorder's own traffic — the network capture layer must skip it. */
export function isVitrinkaUrl(url: string): boolean {
  return BASE !== '' && url.startsWith(BASE);
}

// The status vocabulary lives in a native-import-free module so tests can
// assert against the SHIPPED rule; re-exported here so callers keep one import.
export { permanentStatus, VitrinkaApiError } from './api-status';

/**
 * Fetch the workspace redaction policy at session start. NEVER rejects: null
 * (server too old, network down, 4xx) means the engine's safe defaults — fail
 * closed, never capture-everything. Full fidelity only ever arrives as an
 * explicit server-approved flag inside a successfully fetched policy.
 */
export async function fetchPolicy(): Promise<import('@vitrinka/redact').RedactionPolicy | null> {
  try {
    const res = await api<{ policy?: import('@vitrinka/redact').RedactionPolicy }>(
      'GET',
      '/api/v1/recorder/policy',
    );
    return res.policy ?? null;
  } catch (e) {
    console.warn('vitrinka: redaction policy fetch failed — using safe defaults', e);
    return null;
  }
}

export async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new VitrinkaApiError(`${method} ${path} → ${res.status}: ${text}`, res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Upload a JPEG keyframe from disk. Returns the server's blobKey. */
export async function uploadShot(
  sessionId: string,
  seq: number,
  fileUri: string,
): Promise<{ blobKey?: string }> {
  const res = await uploadAsync(`${BASE}/api/v1/sessions/${sessionId}/shot?seq=${seq}`, fileUri, {
    httpMethod: 'POST',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'image/jpeg',
    },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new VitrinkaApiError(`POST shot seq ${seq} → ${res.status}: ${res.body}`, res.status);
  }
  try {
    return JSON.parse(res.body) as { blobKey?: string };
  } catch {
    return {};
  }
}
