// GENERATED from packages/redact — do not edit; rebuild with: bun run --filter @vitrinka/redact build:vendor

// src/index.ts
var REDACTED = "[redacted]";
var DEFAULT_HEADERS = [
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "xapikey",
  "xauthtoken",
  "xcsrftoken",
  "xamzsecuritytoken"
];
var DEFAULT_BODY_KEYS = [
  "password",
  "passwd",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authorization",
  "apikey",
  "clientsecret",
  "card",
  "cardnumber",
  "cvv",
  "cvc",
  "pin",
  "ssn"
];
function norm(s) {
  return String(s).toLowerCase().replace(/[-_]/g, "");
}
var cache = null;
function compileRules(policy) {
  const src = JSON.stringify(policy ?? null);
  if (cache?.src === src)
    return cache.rules;
  const headers = new Set(DEFAULT_HEADERS);
  const bodyKeys = new Set(DEFAULT_BODY_KEYS);
  const patterns = [];
  for (const h of policy?.extraHeaders ?? []) {
    const n = norm(h);
    if (n)
      headers.add(n);
  }
  for (const k of policy?.extraBodyKeys ?? []) {
    const n = norm(k);
    if (n)
      bodyKeys.add(n);
  }
  for (const p of policy?.patterns ?? []) {
    try {
      patterns.push(new RegExp(p, "g"));
    } catch (e) {
      console.warn("vitrinka redact: unsupported pattern skipped", p, e);
    }
  }
  const rules = {
    full: policy?.fullFidelity === true,
    maskAllText: policy?.maskAllText === true,
    headers,
    bodyKeys,
    patterns
  };
  cache = { src, rules };
  return rules;
}
var SECRET_TOKENS = new Set([
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "auth",
  "authorization",
  "otp",
  "pin",
  "apikey",
  "credential",
  "credentials",
  "cookie",
  "cvv",
  "cvc",
  "iban",
  "ssn"
]);
var SECRET_PHRASES = [
  "apikey",
  "privatekey",
  "secretkey",
  "sessionid",
  "cardnumber",
  "birthnumber",
  "rodnecislo",
  "accesstoken",
  "refreshtoken",
  "idtoken"
];
function tokenize(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean).map((t) => t.toLowerCase());
}
function isSecretKey(key) {
  const tokens = tokenize(key);
  if (tokens.some((t) => SECRET_TOKENS.has(t)))
    return true;
  for (let i = 0;i < tokens.length; i++) {
    let run = "";
    for (let j = i;j < tokens.length; j++) {
      run += tokens[j];
      if (SECRET_PHRASES.includes(run))
        return true;
      if (run.length > 24)
        break;
    }
  }
  return false;
}
function sensitiveHeader(rules, name) {
  const n = norm(name);
  return rules.headers.has(n) || n.endsWith("apikey") || n.endsWith("token") || isSecretKey(name);
}
function sensitiveBodyKey(rules, name) {
  return rules.bodyKeys.has(norm(name)) || isSecretKey(name);
}
function sensitiveParam(rules, name) {
  if (sensitiveBodyKey(rules, name))
    return true;
  const n = norm(name);
  return n.endsWith("apikey") || n.endsWith("token");
}
function maskPatterns(rules, s) {
  let out = s;
  for (const rx of rules.patterns) {
    rx.lastIndex = 0;
    out = out.replace(rx, REDACTED);
  }
  return out;
}
function containsSecretPair(rules, text) {
  for (const m of text.matchAll(/([A-Za-z][A-Za-z0-9_.\-[\]]{0,60})\s*[:=]/g)) {
    if (sensitiveBodyKey(rules, m[1]))
      return true;
  }
  return false;
}
function safeDecode(s) {
  let out = s;
  for (let pass = 0;pass < 3; pass++) {
    const next = decodeEscapes(out);
    if (next === out)
      break;
    out = next;
  }
  return out;
}
function decodeEscapes(s) {
  if (!s.includes("%"))
    return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s.replace(/(%[0-9A-Fa-f]{2})+/g, (seq) => {
      try {
        return decodeURIComponent(seq);
      } catch {
        return seq.replace(/%([0-9A-Fa-f]{2})/g, (esc, hex) => {
          const code = Number.parseInt(hex, 16);
          return code < 128 ? String.fromCharCode(code) : esc;
        });
      }
    });
  }
}
function scrubPairs(rules, sensitive, raw) {
  let changed = false;
  const out = raw.split(/[&;]/).map((p) => {
    if (p === "")
      return p;
    const i = p.indexOf("=");
    const key = i >= 0 ? p.slice(0, i) : p;
    const name = safeDecode(key.replace(/\+/g, " "));
    if (sensitive(rules, name)) {
      changed = true;
      return `${key}=${REDACTED}`;
    }
    if (i >= 0 && containsSecretPair(rules, safeDecode(p.slice(i + 1)))) {
      changed = true;
      return `${key}=${REDACTED}`;
    }
    return p;
  });
  return changed ? out.join("&") : raw;
}
function redactUrl(rules, raw) {
  if (rules.full || !raw)
    return raw;
  const i = raw.search(/[?#]/);
  if (i < 0)
    return maskPatterns(rules, raw);
  const scrubbed = raw.slice(i + 1).split("#").map((seg) => scrubPairs(rules, sensitiveParam, seg)).join("#");
  return maskPatterns(rules, raw.slice(0, i + 1) + scrubbed);
}
var KV_PAIR = /([A-Za-z][A-Za-z0-9_.\-[\]]{0,60})("?\s*[:=]\s*(?!\/\/))("?)([^&?"'\s,}]*)\3/g;
var QUERY_PARAM = /([?&])([^=&#\s]{1,120})=([^&#\s]*)/g;
var HEADER_LINE = /^([A-Za-z][A-Za-z0-9_.-]{0,60})[ \t]*:[ \t]*(.+)$/gm;
var MASK_TEXT_LIMIT = 128 * 1024;
function maskText(rules, text) {
  if (text.length > MASK_TEXT_LIMIT)
    return `[body omitted: ${text.length} bytes, unmaskable]`;
  const scrubbed = text.replace(HEADER_LINE, (match, key) => sensitiveHeader(rules, key) ? `${key}: ${REDACTED}` : match).replace(/\b((?:proxy-)?authorization|www-authenticate)(\s*[:=]\s*)[^\r\n]+/gi, (_m, key, sep) => `${key}${sep}${REDACTED}`).replace(/\b(Digest|Negotiate|NTLM)\s+(?=[A-Za-z][A-Za-z-]{0,30}\s*=)[^\r\n]+/gi, (_m, scheme) => `${scheme} ${REDACTED}`).replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`).replace(/\beyJ[A-Za-z0-9._-]{10,}/g, REDACTED).replace(QUERY_PARAM, (match, lead, key, value) => {
    if (sensitiveParam(rules, safeDecode(key)))
      return `${lead}${key}=${REDACTED}`;
    if (containsSecretPair(rules, safeDecode(value)))
      return `${lead}${key}=${REDACTED}`;
    return match;
  }).replace(KV_PAIR, (match, key, sep, quote, value) => {
    if (value === REDACTED)
      return match;
    return sensitiveBodyKey(rules, key) ? `${key}${sep}${quote}${REDACTED}${quote}` : match;
  });
  return maskPatterns(rules, scrubbed);
}
function urlKey(k) {
  switch (norm(k)) {
    case "url":
    case "href":
    case "uri":
    case "location":
      return true;
    default:
      return false;
  }
}
var MAX_SCRUB_DEPTH = 64;
function scrubTree(rules, v, depth) {
  if (depth > MAX_SCRUB_DEPTH)
    return REDACTED;
  if (Array.isArray(v))
    return v.map((x) => scrubTree(rules, x, depth + 1));
  if (v !== null && typeof v === "object") {
    const out = {};
    for (const [k, mv] of Object.entries(v)) {
      if (sensitiveBodyKey(rules, k))
        out[k] = REDACTED;
      else if (typeof mv === "string" && urlKey(k))
        out[k] = redactUrl(rules, mv);
      else
        out[k] = scrubTree(rules, mv, depth + 1);
    }
    return out;
  }
  return typeof v === "string" ? maskPatterns(rules, v) : v;
}
function scrubTruncatedJson(rules, body) {
  return body.replace(/("([A-Za-z0-9_-]+)"\s*:\s*)("(?:[^"\\]|\\.)*"?|[^,{}[\]"\r\n]*)/g, (m, pre, key) => sensitiveBodyKey(rules, key) ? `${pre}"${REDACTED}"` : m);
}
function looksLikeJson(text) {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}
function scrubMultipart(rules, body, contentType) {
  const bm = /boundary="?([^";]+)"?/i.exec(contentType);
  if (!bm)
    return null;
  const delim = `--${bm[1]}`;
  const segs = body.split(delim);
  if (segs.length < 3 || segs[0] !== "")
    return null;
  if (!segs[segs.length - 1].startsWith("--"))
    return null;
  const out = [segs[0]];
  for (let i = 1;i < segs.length - 1; i++) {
    const seg = segs[i];
    if (!seg.startsWith(`\r
`) || !seg.endsWith(`\r
`))
      return null;
    const hb = seg.indexOf(`\r
\r
`);
    if (hb < 0)
      return null;
    const partHeaders = seg.slice(2, hb);
    const value = seg.slice(hb + 4, -2);
    const nm = /content-disposition:[^\r\n]*;\s*name="([^"]*)"/i.exec(partHeaders);
    const name = nm?.[1] ?? "";
    const scrubbed = name !== "" && sensitiveBodyKey(rules, name) ? REDACTED : maskPatterns(rules, value);
    out.push(`\r
${partHeaders}\r
\r
${scrubbed}\r
`);
  }
  out.push(segs[segs.length - 1]);
  return out.join(delim);
}
var JSON_STRUCTURAL_LIMIT = 256 * 1024;
function redactBody(rules, body, contentType) {
  if (rules.full || !body)
    return body;
  try {
    if (looksLikeJson(body)) {
      if (body.length <= JSON_STRUCTURAL_LIMIT) {
        try {
          return JSON.stringify(scrubTree(rules, JSON.parse(body), 0));
        } catch {}
      }
      return maskPatterns(rules, scrubTruncatedJson(rules, body));
    }
    const ct = (contentType ?? "").toLowerCase();
    if (ct.includes("x-www-form-urlencoded")) {
      return maskPatterns(rules, scrubPairs(rules, sensitiveBodyKey, body));
    }
    if (ct.includes("multipart/form-data")) {
      const scrubbed = scrubMultipart(rules, body, contentType ?? "");
      if (scrubbed !== null)
        return scrubbed;
      return maskText(rules, body);
    }
    return maskText(rules, body);
  } catch {
    return REDACTED;
  }
}
function redactText(rules, text) {
  if (text === undefined)
    return;
  if (rules.full)
    return text;
  if (looksLikeJson(text)) {
    try {
      return JSON.stringify(scrubTree(rules, JSON.parse(text), 0));
    } catch {}
  }
  try {
    return maskText(rules, text);
  } catch {
    return REDACTED;
  }
}
function redactAndCap(rules, body, cap, contentType) {
  if (rules.full)
    return body.length > cap ? `${body.slice(0, cap)}…[truncated]` : body;
  if (looksLikeJson(body) && body.length <= JSON_STRUCTURAL_LIMIT) {
    const clean = redactBody(rules, body, contentType);
    return clean.length > cap ? `${clean.slice(0, cap)}…[truncated]` : clean;
  }
  const sliced = body.length > cap ? `${body.slice(0, cap)}…[truncated]` : body;
  return redactBody(rules, sliced, contentType);
}
function redactHeaders(rules, headers, caps) {
  if (!headers)
    return;
  const maxValueLen = caps?.maxValueLen ?? 1024;
  let budget = caps?.budget ?? 8192;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const raw = rules.full ? String(v) : sensitiveHeader(rules, k) ? REDACTED : maskPatterns(rules, String(v));
    const val = raw.slice(0, maxValueLen);
    budget -= k.length + val.length;
    if (budget < 0) {
      out["…"] = "(truncated)";
      break;
    }
    out[k] = val;
  }
  return out;
}
function maskDirectives(rules) {
  if (rules.full)
    return { maskAllInputs: false, maskAllText: false };
  return {
    maskAllInputs: true,
    maskAllText: rules.maskAllText,
    ...rules.maskAllText ? { maskTextSelector: "*" } : {}
  };
}
function pixelPolicy(rules) {
  return !rules.full && rules.maskAllText ? "blur" : "none";
}
export {
  sensitiveParam,
  sensitiveHeader,
  sensitiveBodyKey,
  scrubPairs,
  redactUrl,
  redactText,
  redactHeaders,
  redactBody,
  redactAndCap,
  pixelPolicy,
  norm,
  maskDirectives,
  isSecretKey,
  compileRules,
  REDACTED
};
