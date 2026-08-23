/**
 * Programmatic control channel for the journey recorder (machine-run design).
 *
 * The recorder could only ever be driven by tapping the HUD, which makes it
 * useless to an agent iterating on a screen: every "screenshot this flow" had
 * to go back through `vitrinka snap`. This module gives it an out-of-band
 * start/stop surface so the AI can record a journey while driving the sim with
 * Appium or `simctl openurl`, and read the result back as a session digest.
 *
 * TRANSPORT — the Expo DevTools plugin channel. `expo-dev-client` is already a
 * dependency, so `useDevToolsPluginClient` gives a bidirectional WebSocket
 * through Metro with no native module, no dev-client rebuild, and no listening
 * socket inside the app. It also rides whatever Metro port THIS worktree got,
 * so the wk port-slot map needs no new entry (`scripts/vitrinka-rec.ts` is the
 * CLI end and resolves the port the same way).
 *
 * The channel is a BROADCAST: every participant sees every frame, filtered
 * only by plugin name. Request and reply therefore use DISTINCT method names
 * (`start` vs `started`) — reusing one name would make the app answer itself
 * in a loop. Every reply echoes the request's `id` so a CLI that sent two
 * commands can tell the answers apart.
 *
 * Dev-only by construction: this module is reachable exclusively through
 * `RecorderProvider`, which `index.tsx` requires from inside the env-literal
 * gate. It must never be imported above that gate — doing so would defeat the
 * dead-code elimination that keeps the recorder out of release bundles.
 */

import { useDevToolsPluginClient } from 'expo/devtools';
import { useEffect } from 'react';

import { getState, health } from './queue';
import { addNote, elapsedOf, startSession, stopSession } from './session';

/** Plugin name both ends agree on; also the CLI's message filter. */
export const PLUGIN_NAME = 'vitrinka-recorder';

/**
 * Default idle auto-stop for machine-driven runs: 10 minutes of zero captured
 * events. Matches the window vitrinka itself uses to call a session `stalled`,
 * and sits far below the server's 24h sweep so an abandoned run closes as a
 * real drained session rather than an `autoClosed` husk.
 */
export const DEFAULT_IDLE_STOP_MS = 10 * 60 * 1000;

interface StartParams {
  id?: string;
  title?: string;
  /** Overrides the default; 0 explicitly disables the watchdog. */
  idleStopMs?: number;
  /** Extra tags on top of the always-attached `ai` + `sim` pair. */
  tags?: string[];
}

interface NoteParams {
  id?: string;
  text?: string;
}

/** What every reply carries, so the CLI can render a status line from any of them. */
function snapshot(): Record<string, unknown> {
  const rec = getState();
  if (!rec) return { recording: false };
  const h = health();
  return {
    recording: true,
    sessionId: rec.sessionId,
    project: rec.project,
    environment: rec.environment,
    title: rec.title,
    driver: rec.driver ?? 'human',
    paused: rec.paused,
    dead: Boolean(rec.dead),
    deadReason: rec.deadReason ?? '',
    elapsedMs: elapsedOf(rec),
    shots: rec.shots,
    events: rec.seq,
    queued: h.queued,
    synced: h.synced,
    healthState: h.state,
  };
}

/**
 * Listen for control commands for the lifetime of the recorder tree.
 *
 * `useDevToolsPluginClient` returns null until the WebSocket is up (and again
 * if Metro restarts), so every listener is registered inside the effect keyed
 * on the client — a reconnect re-subscribes rather than leaving a dead client
 * wired up.
 */
export function useRecorderControl(): void {
  const client = useDevToolsPluginClient(PLUGIN_NAME);

  useEffect(() => {
    if (!client) return;
    const reply = (method: string, id: string | undefined, extra?: Record<string, unknown>) => {
      client.sendMessage(method, { id, ...snapshot(), ...extra });
    };

    const subs = [
      client.addMessageListener('start', (params: StartParams = {}) => {
        const { id } = params;
        if (getState()) {
          // Idempotence matters more than strictness here: an agent that lost
          // its sticky file must not end up with two overlapping recordings,
          // and silently starting a second one would orphan the first.
          reply('started', id, { ok: false, error: 'a session is already recording' });
          return;
        }
        startSession({
          title: params.title,
          environment: 'sim',
          driver: 'ai',
          tags: ['ai', 'sim', ...(params.tags ?? [])],
          idleStopMs: params.idleStopMs ?? DEFAULT_IDLE_STOP_MS,
        })
          .then(() => reply('started', id, { ok: true }))
          .catch((e) =>
            reply('started', id, { ok: false, error: String(e instanceof Error ? e.message : e) }),
          );
      }),

      client.addMessageListener('stop', (params: { id?: string } = {}) => {
        const { id } = params;
        if (!getState()) {
          reply('stopped', id, { ok: false, error: 'no session is recording' });
          return;
        }
        // Snapshot BEFORE the stop: stopSession clears the durable state, so a
        // reply built afterwards would report an empty recorder and the CLI
        // could not print what it just captured.
        const captured = snapshot();
        stopSession()
          .then((done) =>
            reply('stopped', id, { ok: true, ...captured, board: done?.board?.url ?? '' }),
          )
          .catch((e) =>
            reply('stopped', id, {
              ok: false,
              ...captured,
              error: String(e instanceof Error ? e.message : e),
            }),
          );
      }),

      client.addMessageListener('status', (params: { id?: string } = {}) => {
        reply('statusResult', params?.id, { ok: true });
      }),

      client.addMessageListener('note', (params: NoteParams = {}) => {
        const text = params.text?.trim();
        if (!getState()) {
          reply('noteResult', params.id, { ok: false, error: 'no session is recording' });
          return;
        }
        if (!text) {
          reply('noteResult', params.id, { ok: false, error: 'note text is empty' });
          return;
        }
        addNote(text);
        reply('noteResult', params.id, { ok: true });
      }),
    ];

    return () => {
      for (const s of subs) s.remove();
    };
  }, [client]);
}
