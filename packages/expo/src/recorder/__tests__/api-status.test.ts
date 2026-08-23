/**
 * Transport-status classification (review #3648891221). This is the predicate
 * both the event flush and the pending-shot drain branch on: a wrong verdict
 * either wedges the queue forever (transient treated as permanent's opposite)
 * or silently discards deliverable data.
 */
import { describe, expect, it } from 'bun:test';

import { permanentStatus, VitrinkaApiError } from '../api-status';

describe('permanentStatus', () => {
  it('treats client errors as permanent — retrying cannot fix them', () => {
    for (const s of [400, 401, 403, 404, 409, 413, 422, 451, 499]) {
      expect(permanentStatus(s)).toBe(true);
    }
  });

  it('exempts the two retryable 4xx: 408 timeout and 429 rate-limit', () => {
    expect(permanentStatus(408)).toBe(false);
    expect(permanentStatus(429)).toBe(false);
  });

  it('treats server errors as transient', () => {
    for (const s of [500, 502, 503, 504]) {
      expect(permanentStatus(s)).toBe(false);
    }
  });

  it('treats success and no-response (0) as not permanent', () => {
    for (const s of [0, 200, 201, 204, 304]) {
      expect(permanentStatus(s)).toBe(false);
    }
  });

  it('holds exactly at the 4xx boundaries', () => {
    expect(permanentStatus(399)).toBe(false);
    expect(permanentStatus(400)).toBe(true);
    expect(permanentStatus(499)).toBe(true);
    expect(permanentStatus(500)).toBe(false);
  });
});

describe('VitrinkaApiError', () => {
  it('carries the status alongside the message', () => {
    const e = new VitrinkaApiError('POST /events → 422: bad seq', 422);
    expect(e.status).toBe(422);
    expect(e.message).toContain('422');
    expect(e instanceof Error).toBe(true);
  });
});
