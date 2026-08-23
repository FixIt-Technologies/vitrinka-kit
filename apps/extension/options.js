const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

chrome.storage.local.get(["base", "token"]).then(({ base = "", token = "" }) => {
  $("base").value = base;
  $("token").value = token;
});

// The background seeds empty settings from the CLI on first run; this is the
// override for a machine whose saved token has gone stale — the CLI's copy is
// the one `vitrinka login` refreshes.
$("fromCli").onclick = async () => {
  const st = $("status");
  st.textContent = "asking the vitrinka CLI…";
  st.className = "";
  const r = await send({ type: "vt-ext-config" });
  if (!r || !r.ok) {
    st.textContent = r && r.absent
      ? "✗ no vitrinka CLI registered on this machine — run: vitrinka extension setup"
      : `✗ ${(r && r.error) || "the CLI did not answer"}`;
    st.className = "bad";
    return;
  }
  if (r.base) $("base").value = String(r.base).replace(/\/$/, "");
  if (r.token) $("token").value = r.token;
  st.textContent = r.token ? "✓ filled — hit Save & test" : "✓ base URL filled; the CLI has no token (run: vitrinka login)";
  st.className = r.token ? "ok" : "bad";
};

$("save").onclick = async () => {
  const base = $("base").value.trim().replace(/\/$/, "");
  const token = $("token").value.trim();
  await chrome.storage.local.set({ base, token });
  const st = $("status");
  st.textContent = "testing…";
  st.className = "";
  try {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${base}/api/v1/version`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    st.textContent = `✓ connected (${(await res.json()).cli || "ok"})`;
    st.className = "ok";
  } catch (e) {
    st.textContent = `✗ ${e.message || e}`;
    st.className = "bad";
  }
};

// ---------------------------------------------------------------------------
// Recorder data (recorder-live D9). Nothing is dropped to make room (D8), so
// usage needs a visible home: per-session rows, an automatic sweep of what the
// SERVER says is finished, and a manual clear-all for everything else.

const fmtBytes = (n) => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
};

function row(label, value, live) {
  const el = document.createElement("div");
  el.className = "r" + (label === "total" ? " total" : "");
  const l = document.createElement("span");
  l.textContent = label;
  if (live) l.className = "live";
  const v = document.createElement("span");
  v.textContent = value;
  el.append(l, v);
  return el;
}

async function renderStorage() {
  const [stats, { rec }] = await Promise.all([
    send({ type: "vt-storage" }),
    chrome.storage.local.get("rec"),
  ]);
  const box = $("rows");
  box.textContent = "";
  if (!stats || !stats.count) {
    box.append(row("nothing queued", "0 B"));
    return;
  }
  for (const [sessionId, s] of Object.entries(stats.bySession)) {
    const live = rec && String(rec.sessionId) === String(sessionId);
    box.append(row(`session #${sessionId}${live ? " · recording" : ""}`,
      `${s.count} item(s) · ${fmtBytes(s.bytes)}`, live));
  }
  box.append(row("total", `${stats.count} item(s) · ${fmtBytes(stats.bytes)}`));
}

$("reap").onclick = async () => {
  const st = $("dataStatus");
  st.textContent = "checking with vitrinka…";
  st.className = "";
  const r = await send({ type: "vt-reap" });
  st.textContent = r && r.ok ? "✓ finished sessions cleared" : `✗ ${(r && r.error) || "failed"}`;
  st.className = r && r.ok ? "ok" : "bad";
  renderStorage();
};

$("clear").onclick = async () => {
  if (!confirm("Delete every queued recording still held on this machine?")) return;
  const st = $("dataStatus");
  const r = await send({ type: "vt-clear-all" });
  st.textContent = r && r.ok ? "✓ cleared" : `✗ ${(r && r.error) || "failed"}`;
  st.className = r && r.ok ? "ok" : "bad";
  renderStorage();
};

renderStorage();
