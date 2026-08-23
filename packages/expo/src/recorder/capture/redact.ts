/**
 * Credential redaction for captured payloads.
 *
 * The recorder is dev-variant-only and vitrinka is WireGuard-mesh-only, so D7
 * ("capture everything, trust the mesh") keeps FULL debugging payloads — but
 * that is no reason to persist auth tokens, passwords and OTPs when masking
 * them by key name costs nothing and loses no QA value: you never need the
 * password field to reconstruct a journey.
 *
 * Two invariants this module now guarantees:
 *
 * 1. ONE policy for both paths. `isSecretKey()` decides for structural JSON AND
 *    for the text/URL fallback (which runs the same predicate through a generic
 *    key=value scanner). A regex with its own shorter key list used to leak
 *    `authorization`/`apikey`/`cookie`/`iban`/… on every URL.
 * 2. TOKEN matching, not substring. Splitting the key into word tokens keeps
 *    `author`, `authorId`, `shippingAddress` and `pinned` intact while still
 *    catching `Authorization`, `accessToken` and `X-Dev-Auth-Secret`. Raw
 *    `includes()` masked ordinary data ('shipping' contains 'pin').
 */

const REDACTED = '[redacted]';

/** Exact key TOKENS that mark a secret (compared per word, case-folded). */
const SECRET_TOKENS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'auth',
  'authorization',
  'otp',
  'pin',
  'apikey',
  'credential',
  'credentials',
  'cookie',
  'cvv',
  'cvc',
  'iban',
]);

/** Multi-word names that only read as secrets when joined. */
const SECRET_PHRASES = [
  'apikey',
  'privatekey',
  'secretkey',
  'sessionid',
  'cardnumber',
  'birthnumber',
  'rodnecislo',
  'accesstoken',
  'refreshtoken',
  'idtoken',
];

/** Split a key into lowercase word tokens: camelCase, snake_case, kebab-case, dots. */
function tokenize(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

export function isSecretKey(key: string): boolean {
  const tokens = tokenize(key);
  if (tokens.some((t) => SECRET_TOKENS.has(t))) return true;
  // Phrases match a run of CONSECUTIVE tokens, never a raw substring of the
  // joined key: `joined.includes('privatekey')` also matched
  // `privateKeyboardEnabled` and `apiKeyboardLayout`.
  for (let i = 0; i < tokens.length; i++) {
    let run = '';
    for (let j = i; j < tokens.length; j++) {
      run += tokens[j];
      if (SECRET_PHRASES.includes(run)) return true;
      if (run.length > 24) break; // no phrase is longer
    }
  }
  return false;
}

/** Does this text contain a `secretkey=value` pair? Used for encoded values. */
function containsSecretPair(text: string): boolean {
  for (const m of text.matchAll(/([A-Za-z][A-Za-z0-9_.\-[\]]{0,60})\s*[:=]/g)) {
    if (isSecretKey(m[1])) return true;
  }
  return false;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? REDACTED : redactValue(v);
    }
    return out;
  }
  return value;
}

/**
 * Generic `key=value` / `"key": "value"` scanner for non-JSON text and URLs.
 * The key is handed to the SAME `isSecretKey` predicate as the JSON path, so
 * the two can never drift apart. Quantifiers are bounded — an unbounded
 * key-prefix class backtracks quadratically (~9s on a 64 KiB body).
 */
// The VALUE groups are unbounded on purpose. A `{1,4096}` bound matched only the
// first 4096 characters and replaced just that prefix, leaving the tail of a
// longer credential recorded verbatim. Negated character
// classes with `*` are linear — the quadratic risk was the KEY prefix, which
// stays bounded.
const KV_PAIR = /([A-Za-z][A-Za-z0-9_.\-[\]]{0,60})("?\s*[:=]\s*(?!\/\/))("?)([^&?"'\s,}]*)\3/g;

/**
 * Query parameters get their OWN pass, before the generic scanner. Without it a
 * URL's scheme matched the generic pattern first (`https:` as key, `//host/…?
 * apiKey=k1` as its value), consuming the query string so its real parameters
 * were never examined — every URL secret leaked.
 */
const QUERY_PARAM = /([?&])([^=&#\s]{1,120})=([^&#\s]*)/g;

/**
 * Decode for INSPECTION, failing closed.
 *
 * `decodeURIComponent` is all-or-nothing: one malformed escape anywhere
 * (`?next=token%3Dhunter2%ZZ`) threw, and the value was then scanned in its
 * still-encoded form where `containsSecretPair` cannot see the encoded `=`.
 * Now: decode escape-by-escape so a bad tail cannot hide a good prefix, and
 * repeat a bounded number of times so a double-encoded `token%253D…` is seen.
 */
function safeDecode(s: string): string {
  let out = s;
  for (let pass = 0; pass < 3; pass++) {
    const next = decodeEscapes(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Percent-decode what we can; leave individually-malformed escapes as-is. */
function decodeEscapes(s: string): string {
  if (!s.includes('%')) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    // Per-run best effort, then per-ESCAPE: a run containing malformed UTF-8
    // (e.g. `%3Dhunter2%E0%80`) used to be returned whole, keeping the valid
    // `%3D` encoded so the structural scan could not see it.
    // ASCII-range escapes are decoded individually; non-ASCII bytes that cannot
    // stand alone are left as-is.
    return s.replace(/(%[0-9A-Fa-f]{2})+/g, (seq) => {
      try {
        return decodeURIComponent(seq);
      } catch {
        return seq.replace(/%([0-9A-Fa-f]{2})/g, (esc, hex: string) => {
          const code = Number.parseInt(hex, 16);
          return code < 0x80 ? String.fromCharCode(code) : esc;
        });
      }
    });
  }
}

/**
 * Header-shaped lines (`Key: value`) mask their ENTIRE value. For a header the
 * secret is the rest of the line, not a whitespace-free token: the generic
 * key=value pass matched only `Bearer` in `authorization: Bearer <token>`,
 * leaving the token, and only the first pair of `Cookie: a=1; b=2`. Running this
 * first also avoids the double-mask the two passes produced together
 *.
 */
const HEADER_LINE = /^([A-Za-z][A-Za-z0-9_.-]{0,60})[ \t]*:[ \t]*(.+)$/gm;

/** Beyond this, only the structural JSON path is worth running. */
const MASK_TEXT_LIMIT = 128 * 1024;

function maskText(text: string): string {
  if (text.length > MASK_TEXT_LIMIT) return `[body omitted: ${text.length} bytes, unmaskable]`;
  return (
    text
      // Secret HEADERS mask their whole value first — for a header the secret is
      // the rest of the line, not a whitespace-free token. The generic pass
      // matched only `Bearer` in `authorization: Bearer <token>` (leaving the
      // token) and only the first pair of `Cookie: a=1; b=2`; running this first
      // also avoids the double-mask the passes produced together
      //.
      .replace(HEADER_LINE, (match, key: string) =>
        isSecretKey(key) ? `${key}: ${REDACTED}` : match,
      )
      // An auth header appearing MID-LINE (not at line start, so HEADER_LINE
      // missed it) loses everything after the key. This replaces a bare
      // `/\bDigest\s+.../` rule that wiped the rest of ANY line containing the
      // word "Digest" — e.g. `Digest mismatch for asset https://…` — which is
      // the over-redaction this module exists to avoid.
      .replace(
        /\b((?:proxy-)?authorization|www-authenticate)(\s*[:=]\s*)[^\r\n]+/gi,
        (_m, key: string, sep: string) => `${key}${sep}${REDACTED}`,
      )
      // A scheme CHALLENGE/CREDENTIAL standing on its own, with no auth key in
      // front of it (a captured WWW-Authenticate body, a logged raw header). The
      // lookahead requires the first token after the scheme to be a `param=`,
      // which is what makes this a credential rather than prose — `Digest
      // mismatch for asset …` does not match, but `Digest realm="api",
      // nonce="abc"` does.
      .replace(
        /\b(Digest|Negotiate|NTLM)\s+(?=[A-Za-z][A-Za-z-]{0,30}\s*=)[^\r\n]+/gi,
        (_m, scheme: string) => `${scheme} ${REDACTED}`,
      )
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`)
      .replace(/\beyJ[A-Za-z0-9._-]{10,}/g, REDACTED) // bare JWT
      .replace(QUERY_PARAM, (match, lead: string, key: string, value: string) => {
        if (isSecretKey(safeDecode(key))) return `${lead}${key}=${REDACTED}`;
        // An ordinary key can CARRY an encoded URL/form payload that holds a
        // secret: `?next=%2Fcb%3Ftoken%3Dsupersecret`.
        // Only the parameter name was decoded and inspected before.
        if (containsSecretPair(safeDecode(value))) return `${lead}${key}=${REDACTED}`;
        return match;
      })
      .replace(KV_PAIR, (match, key: string, sep: string, quote: string, value: string) => {
        if (value === REDACTED) return match; // already masked by an earlier pass
        return isSecretKey(key) ? `${key}${sep}${quote}${REDACTED}${quote}` : match;
      })
  );
}

/**
 * Redact a captured body/log string. JSON is walked structurally (shape is
 * preserved so the timeline still shows which fields were sent); anything else
 * gets the key-scanner pass. Never throws — capture must not break the app.
 *
 * Call this BEFORE any size capping: slicing a JSON body first makes it invalid,
 * which silently downgrades every large payload to the weaker text path
 *.
 */
function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

const JSON_STRUCTURAL_LIMIT = 256 * 1024;

/**
 * Redact, then cap to `cap` bytes — with the ORDER chosen by shape:
 *
 * - JSON: redact the WHOLE body first, then cap. Capping first would slice it
 *   into invalid JSON, silently downgrading the payloads most likely to carry
 *   credentials to the weaker text scanner.
 * - anything else: cap FIRST, then mask. Slicing text is harmless, and it keeps
 *   the masking cost bounded — a 512 KiB text body would otherwise exceed the
 *   masking limit and be dropped entirely instead of kept in part.
 *
 * JSON above JSON_STRUCTURAL_LIMIT skips the structural path: request bodies
 * come straight from the caller with no read bound, so a multi-megabyte upload
 * would be parsed, deep-copied and re-serialized on the JS thread.
 */
export function redactAndCap(body: string, cap: number): string | undefined {
  if (looksLikeJson(body) && body.length <= JSON_STRUCTURAL_LIMIT) {
    const clean = redactText(body);
    if (clean === undefined) return undefined;
    return clean.length > cap ? `${clean.slice(0, cap)}…[truncated]` : clean;
  }
  const sliced = body.length > cap ? `${body.slice(0, cap)}…[truncated]` : body;
  return redactText(sliced);
}

export function redactText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (looksLikeJson(text)) {
    try {
      return JSON.stringify(redactValue(JSON.parse(text)));
    } catch {
      // malformed (or truncated) JSON — fall through to text masking
    }
  }
  try {
    return maskText(text);
  } catch {
    return REDACTED; // never let redaction failure leak the raw payload
  }
}
