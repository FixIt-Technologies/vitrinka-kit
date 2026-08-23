/**
 * Credential redaction for captured payloads (reviews #3648514371, #3648514375).
 *
 * D7 ("capture everything, trust the mesh") is about keeping FULL debugging
 * payloads — it is not a reason to ship auth tokens, passwords and OTPs into
 * the event stream when masking them costs nothing and loses no QA value.
 */
import { describe, expect, it } from 'bun:test';

const { redactAndCap, redactText } = (await import(
  '../capture/redact'
)) as typeof import('../capture/redact');

describe('redactText', () => {
  it('masks credential-shaped keys in JSON objects, keeping the shape', () => {
    const out = redactText(
      JSON.stringify({ email: 'a@b.cz', password: 'hunter2', accessToken: 'eyJhbGci.x.y' }),
    );
    const parsed = JSON.parse(out as string);
    expect(parsed.email).toBe('a@b.cz'); // non-secret data survives — that's the point of D7
    expect(parsed.password).toBe('[redacted]');
    expect(parsed.accessToken).toBe('[redacted]');
  });

  it('masks nested and array-nested secrets', () => {
    const out = redactText(
      JSON.stringify({
        user: { profile: { refresh_token: 'r1' } },
        sessions: [{ otp: '123456' }, { note: 'keep' }],
      }),
    );
    const p = JSON.parse(out as string);
    expect(p.user.profile.refresh_token).toBe('[redacted]');
    expect(p.sessions[0].otp).toBe('[redacted]');
    expect(p.sessions[1].note).toBe('keep');
  });

  it('matches key names case- and separator-insensitively', () => {
    const out = redactText(
      JSON.stringify({
        'X-Dev-Auth-Secret': 's',
        Authorization: 'Bearer x',
        clientSecret: 's',
        birthNumber: '900101/1234',
      }),
    );
    const p = JSON.parse(out as string);
    expect(p['X-Dev-Auth-Secret']).toBe('[redacted]');
    expect(p.Authorization).toBe('[redacted]');
    expect(p.clientSecret).toBe('[redacted]');
    expect(p.birthNumber).toBe('[redacted]'); // Czech rodné číslo is sensitive PII
  });

  it('masks bearer tokens and JWTs in NON-JSON text (form bodies, logs)', () => {
    expect(redactText('authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')).not.toContain(
      'eyJhbGci',
    );
    expect(redactText('password=hunter2&email=a@b.cz')).toContain('email=a@b.cz');
    expect(redactText('password=hunter2&email=a@b.cz')).not.toContain('hunter2');
  });

  it('passes through undefined and leaves ordinary text untouched', () => {
    expect(redactText(undefined)).toBeUndefined();
    expect(redactText('inquiry created, id=42')).toBe('inquiry created, id=42');
  });

  it('never throws on malformed JSON — falls back to text masking', () => {
    const out = redactText('{"password":"hunter2", oops');
    expect(out).not.toContain('hunter2');
  });
});

describe('one policy for both paths (review #3648868611, #3648868619)', () => {
  // URLs and form bodies are never JSON, so they always take the text path.
  // Every key class the structural policy declares must mask there too.
  const cases: [string, string][] = [
    ['https://api.test/x?apiKey=k1&id=7', 'k1'],
    ['https://api.test/x?sessionId=s1', 's1'],
    ['https://api.test/x?authorization=abc', 'abc'],
    ['https://api.test/x?privateKey=pk', 'pk'],
    ['https://api.test/x?credential=c1', 'c1'],
    ['https://api.test/x?iban=CZ6508000000192000145399', 'CZ6508'],
    ['https://api.test/x?cardNumber=4111111111111111', '4111111111111111'],
    ['https://api.test/x?birthNumber=900101%2F1234', '900101'],
    ['cookie=sid_abcdef; path=/', 'sid_abcdef'],
    ['refreshToken=rt_1&otp=123456', 'rt_1'],
  ];
  for (const [input, secret] of cases) {
    it(`masks the secret in "${input.slice(0, 42)}…"`, () => {
      expect(redactText(input)).not.toContain(secret);
    });
  }

  it('keeps non-secret query params readable', () => {
    const out = redactText('https://api.test/inquiries?apiKey=k1&status=OPEN&page=2') as string;
    expect(out).toContain('status=OPEN');
    expect(out).toContain('page=2');
    expect(out).not.toContain('k1');
  });

  it('masks Basic and Digest auth schemes, not just Bearer', () => {
    expect(redactText('Authorization: Basic dXNlcjpwYXNz')).not.toContain('dXNlcjpwYXNz');
    expect(redactText('Authorization: Digest abc123')).not.toContain('abc123');
  });
});

describe('no over-redaction (review #3648868620, #3648868630)', () => {
  // Substring matching used to destroy ordinary debugging data:
  // 'author'.includes('auth') and 'shipping'.includes('pin').
  it('keeps author-ish and pin-ish NON-secret fields intact', () => {
    const out = redactText(
      JSON.stringify({
        author: 'Jan',
        authorId: 42,
        authorName: 'Jan K',
        authenticated: true,
        shippingAddress: 'Praha 1',
        pinned: true,
        spinner: 'idle',
        tokenizer: 'v2',
      }),
    ) as string;
    const p = JSON.parse(out);
    expect(p.author).toBe('Jan');
    expect(p.authorId).toBe(42);
    expect(p.authorName).toBe('Jan K');
    expect(p.authenticated).toBe(true);
    expect(p.shippingAddress).toBe('Praha 1');
    expect(p.pinned).toBe(true);
    expect(p.spinner).toBe('idle');
  });

  it('still masks the real secrets alongside them', () => {
    const p = JSON.parse(
      redactText(
        JSON.stringify({
          author: 'Jan',
          auth: 'a',
          Authorization: 'b',
          accessToken: 'c',
          pin: '1234',
        }),
      ) as string,
    );
    expect(p.author).toBe('Jan');
    expect(p.auth).toBe('[redacted]');
    expect(p.Authorization).toBe('[redacted]');
    expect(p.accessToken).toBe('[redacted]');
    expect(p.pin).toBe('[redacted]');
  });
});

describe('large JSON keeps the structural path (review #3648868615)', () => {
  it('masks a >64 KiB JSON body structurally rather than degrading to text', () => {
    const filler = 'd'.repeat(70 * 1024);
    const out = redactText(JSON.stringify({ note: filler, password: 'hunter2' })) as string;
    // Still parseable JSON → the structural walker handled it.
    const p = JSON.parse(out);
    expect(p.password).toBe('[redacted]');
    expect(p.note.length).toBe(filler.length);
  });

  it('masks fast — a 64 KiB body must not take seconds', () => {
    const started = Date.now();
    redactText(`x=${'z'.repeat(64 * 1024)}`);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('bounds (review #3648891211)', () => {
  it('replaces a body over the masking limit rather than leaving it raw', () => {
    // Non-JSON over MASK_TEXT_LIMIT (128 KiB): masking it would be too costly,
    // so it is omitted WITH its size — never passed through unmasked.
    const huge = `password=hunter2&pad=${'p'.repeat(200 * 1024)}`;
    const out = redactText(huge) as string;
    expect(out).toContain('[body omitted:');
    expect(out).toContain('unmaskable');
    expect(out).not.toContain('hunter2');
  });

  it('still masks a body just UNDER the limit', () => {
    const justUnder = `password=hunter2&pad=${'p'.repeat(100 * 1024)}`;
    const out = redactText(justUnder) as string;
    expect(out).not.toContain('hunter2');
    expect(out).toContain('[redacted]');
    expect(out).toContain('pad=');
  });

  it('masks an over-long single token without hanging (bounded quantifiers)', () => {
    const started = Date.now();
    const out = redactText(`token=${'a'.repeat(8192)}`) as string;
    expect(Date.now() - started).toBeLessThan(500);
    expect(out).toContain('[redacted]');
  });
});

describe('redactAndCap ordering', () => {
  it('caps JSON only AFTER structural masking (shape preserved)', () => {
    const body = JSON.stringify({ password: 'hunter2', pad: 'j'.repeat(200 * 1024) });
    const out = redactAndCap(body, 64 * 1024) as string;
    expect(out).not.toContain('hunter2');
    expect(out.startsWith('{"password":"[redacted]"')).toBe(true); // masked before the slice
    expect(out).toContain('[truncated]');
  });

  it('caps non-JSON BEFORE masking, keeping the head instead of dropping it all', () => {
    const body = `password=hunter2&pad=${'t'.repeat(200 * 1024)}`;
    const out = redactAndCap(body, 64 * 1024) as string;
    expect(out).not.toContain('hunter2');
    expect(out).toContain('[redacted]'); // masked, not "unmaskable"
    expect(out).toContain('[truncated]');
    expect(out.length).toBeLessThan(70 * 1024);
  });
});

describe('no credential tail survives the regex (review #3648909229)', () => {
  // Assert the POSITIVE shape, not just the absence of a long run: a negative
  // alone passes when up to 49 chars survive, or when the redactor mangles the
  // input entirely (review #3648946378).
  it('masks a token far longer than the old 4096-char bound', () => {
    const long = 'A'.repeat(5000);
    const out = redactText(`https://api.test/x?token=${long}&id=7`) as string;
    expect(out).toBe('https://api.test/x?token=[redacted]&id=7');
    expect(out).not.toContain('A');
  });

  it('masks an over-long Bearer header whole', () => {
    // A secret HEADER loses its entire value (scheme included) — the header pass
    // runs first, since for a header the secret is the rest of the line.
    const out = redactText(`authorization: Bearer ${'B'.repeat(6000)}`) as string;
    expect(out).toBe('authorization: [redacted]');
  });

  it('masks an INLINE Bearer token while keeping the surrounding text', () => {
    const out = redactText(`request failed, sent Bearer ${'B'.repeat(600)} to /api`) as string;
    expect(out).toBe('request failed, sent Bearer [redacted] to /api');
  });

  it('masks an over-long form value whole', () => {
    const out = redactText(`password=${'C'.repeat(9000)}`) as string;
    expect(out).toBe('password=[redacted]');
  });
});

describe('no over-redaction of ordinary text (review #3648980385)', () => {
  it('leaves a line that merely CONTAINS the word Digest intact', () => {
    const out = redactText('Digest mismatch for asset https://cdn.test/a.png (sha 9f2)') as string;
    expect(out).toBe('Digest mismatch for asset https://cdn.test/a.png (sha 9f2)');
  });

  it('still redacts a mid-line authorization header', () => {
    const out = redactText(
      'retrying with authorization: Digest username="x", response="s"',
    ) as string;
    expect(out).toBe('retrying with authorization: [redacted]');
    expect(out).not.toContain('response="s"');
  });

  it('redacts a BARE scheme credential that has no auth key in front of it', () => {
    // A captured WWW-Authenticate body or a logged raw header (review #3650004778).
    const out = redactText('Digest realm="api", nonce="abc123", opaque="xyz"') as string;
    expect(out).toBe('Digest [redacted]');
    expect(out).not.toContain('abc123');
  });

  it('still leaves scheme-shaped PROSE alone (no param= after the word)', () => {
    for (const line of [
      'Digest mismatch for asset https://cdn.test/a.png (sha 9f2)',
      'NTLM handshake finished in 12ms',
      'Negotiate failed, falling back',
    ]) {
      expect(redactText(line)).toBe(line);
    }
  });

  it('leaves the words authorized / authored alone', () => {
    const out = redactText('request authorized for author Jan (id 7)') as string;
    expect(out).toBe('request authorized for author Jan (id 7)');
  });
});

describe('secret headers mask their whole value (review #3648946370)', () => {
  it('masks every cookie pair, not just the first', () => {
    const out = redactText('Cookie: sid=abc123; csrf=def456; theme=dark') as string;
    expect(out).toBe('Cookie: [redacted]');
    expect(out).not.toContain('def456');
  });

  it('leaves non-secret headers untouched', () => {
    const out = redactText('Content-Type: application/json\nX-Request-Id: req-42') as string;
    expect(out).toContain('application/json');
    expect(out).toContain('req-42');
  });

  it('redacts the entire comma-separated Digest parameter list', () => {
    const out = redactText(
      'Authorization: Digest username="Mufasa", nonce="abc", response="secretresponse"',
    ) as string;
    expect(out).toBe('Authorization: [redacted]');
    expect(out).not.toContain('secretresponse');
    expect(out).not.toContain('Mufasa');
  });
});

describe('safeDecode fallback (review #3648946372, #3648946368)', () => {
  // Positive shapes, not bare negatives — a negative alone also passes when the
  // redactor drops or mangles the whole value (review #3648980391).
  it('sees a secret whose value has a MALFORMED escape in the tail', () => {
    const out = redactText('https://api.test/x?next=token%3Dhunter2%ZZ') as string;
    expect(out).toBe('https://api.test/x?next=[redacted]');
  });

  it('sees a DOUBLE-encoded nested secret', () => {
    const out = redactText('https://api.test/x?next=token%253Dhunter2') as string;
    expect(out).toBe('https://api.test/x?next=[redacted]');
  });

  it('sees a secret delimiter even when the run also holds malformed UTF-8', () => {
    // `%3D` stayed encoded because the whole run failed to decode as UTF-8, so
    // containsSecretPair never saw the `=` (review #3648980381).
    const out = redactText('https://api.test/x?next=token%3Dhunter2%E0%80') as string;
    expect(out).not.toContain('hunter2');
    expect(out).toBe('https://api.test/x?next=[redacted]');
  });

  it('does not throw on a truncated escape sequence', () => {
    expect(() => redactText('https://api.test/x?next=%E0%A4%A')).not.toThrow();
    expect(() => redactText('https://api.test/x?a=%')).not.toThrow();
  });

  it('leaves an ordinary malformed-escape value readable', () => {
    // Exact equality: `toContain('note=')` was satisfied by the redacted output
    // too, so it proved nothing about over-redaction (review #3648980383).
    const out = redactText('https://api.test/x?note=100%25%ZZ') as string;
    expect(out).toBe('https://api.test/x?note=100%25%ZZ');
  });
});

describe('encoded query values (review #3648909233)', () => {
  it('redacts a secret nested inside an encoded value under an ordinary key', () => {
    const out = redactText('https://api.test/cb?next=%2Fcallback%3Ftoken%3Dsupersecret') as string;
    expect(out).not.toContain('supersecret');
  });

  it('redacts an encoded form payload carrying a password', () => {
    const out = redactText(
      'https://api.test/x?payload=email%3Da%40b.cz%26password%3Dhunter2',
    ) as string;
    expect(out).not.toContain('hunter2');
  });

  it('leaves an ordinary encoded value alone', () => {
    const out = redactText('https://api.test/x?next=%2Fhome%3Ftab%3Dorders') as string;
    expect(out).toContain('%2Fhome');
  });
});

describe('phrase matching across word boundaries (review #3648909237)', () => {
  it('does NOT mask unrelated words that merely contain a phrase when joined', () => {
    const p = JSON.parse(
      redactText(
        JSON.stringify({
          privateKeyboardEnabled: true,
          apiKeyboardLayout: 'qwerty',
          sessionIdentityProvider: 'workos',
          cardNumbering: 'auto',
        }),
      ) as string,
    );
    expect(p.privateKeyboardEnabled).toBe(true);
    expect(p.apiKeyboardLayout).toBe('qwerty');
    expect(p.cardNumbering).toBe('auto');
  });

  it('still masks the real phrase keys', () => {
    const p = JSON.parse(
      redactText(
        JSON.stringify({
          privateKey: 'pk',
          apiKey: 'ak',
          'X-Api-Key': 'xak',
          sessionId: 'sid',
          cardNumber: '4111',
          rodneCislo: '900101/1234',
        }),
      ) as string,
    );
    for (const k of [
      'privateKey',
      'apiKey',
      'X-Api-Key',
      'sessionId',
      'cardNumber',
      'rodneCislo',
    ]) {
      expect(p[k]).toBe('[redacted]');
    }
  });
});

describe('JSON structural bound (review #3648909231)', () => {
  it('does not parse a multi-megabyte JSON upload structurally', () => {
    const huge = JSON.stringify({ password: 'hunter2', blob: 'm'.repeat(2 * 1024 * 1024) });
    const started = Date.now();
    const out = redactAndCap(huge, 64 * 1024) as string;
    expect(Date.now() - started).toBeLessThan(1500);
    expect(out).not.toContain('hunter2'); // still masked, via the text path
    expect(out.length).toBeLessThan(70 * 1024);
  });

  it('keeps the structural path for a normal-sized JSON body', () => {
    const out = redactAndCap(JSON.stringify({ password: 'x', keep: 'yes' }), 64 * 1024) as string;
    const p = JSON.parse(out);
    expect(p.password).toBe('[redacted]');
    expect(p.keep).toBe('yes');
  });
});
