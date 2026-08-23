// version.js — dotted-version compare, shared by the service worker and the
// popup so the "is there an update?" answer can never differ between the two
// surfaces that show it. The Go CLI keeps its own comparator (the extension
// chain in internal/cli/cmds) — the TS copy and the cross-pinning test died
// with pkg/ in the 2026-08-18 cutover.

// newerVersion — true when a outranks b. Non-numeric segments count as 0, so a
// malformed marketplace version can never claim to be newer than what runs.
export function newerVersion(a, b) {
  const pa = String(a).split("."), pb = String(b).split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i]) || 0, nb = Number(pb[i]) || 0;
    if (na !== nb) return na > nb;
  }
  return false;
}
