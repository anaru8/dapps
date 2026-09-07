const $ = (id) => document.getElementById(id);
let app, endpoint, terminal, fit, session;
let cursor = 0;
let queue = Promise.resolve();
let connecting = false;
function error(message) {
  $("error").textContent = String(message);
  $("error").hidden = false;
}
function controls() {
  $("open").disabled = !app || Boolean(session) || connecting;
  $("close").disabled = !session || connecting;
  $("clear").disabled = !terminal;
}
async function call(path, method = "GET", data, keepalive = false) {
  const res = await fetch(endpoint + path, {
    method,
    keepalive,
    signal: AbortSignal.timeout(15000),
    headers: { "X-Tabserver-Token": app.getTokenBase64(), "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await res.json();
  if (!res.ok || result.error) throw new Error(result.error || `Request failed (${res.status})`);
  return result.ok;
}
function enqueue(work) {
  queue = queue.then(work).catch((e) => {
    if (terminal) terminal.options.disableStdin = true;
    error(e.message + " Input paused. Close this shell and open another.");
  });
  return queue;
}
async function poll(id) {
  try {
    const output = await call(`/sessions/${id}/output?after=${cursor}`);
    if (session !== id) return;
    if (output.truncated) {
      terminal.writeln("\r\n[Earlier output discarded: scrollback limit reached]\r\n");
    }
    const bytes = Uint8Array.from(atob(output.data), (c) => c.charCodeAt(0));
    await new Promise((resolve) => terminal.write(bytes, resolve));
    cursor = output.next;
    if (output.exited) {
      session = null;
      $("status").textContent = "Shell exited";
      terminal.writeln("\r\n[Shell exited]");
      await call(`/sessions/${id}`, "DELETE");
      controls();
      return;
    }
    setTimeout(() => {
      if (session === id) poll(id);
    }, output.data ? 60 : 250);
  } catch (e) {
    if (session !== id) return;
    $("status").textContent = "Connection interrupted";
    terminal.options.disableStdin = true;
    error(e.message + " Use Close shell to end this session, then open another.");
    // Keep the id so Close can clean up; do not replay uncertain keystrokes.
  }
}
$("open").addEventListener("click", async () => {
  connecting = true;
  controls();
  $("error").hidden = true;
  try {
    fit.fit();
    const result = await call("/sessions", "POST", { cols: terminal.cols, rows: terminal.rows });
    session = result.id;
    cursor = 0;
    terminal.reset();
    terminal.options.disableStdin = false;
    $("welcome").hidden = true;
    $("status").textContent = `${result.shell} · Connected`;
    terminal.focus();
    poll(session);
  } catch (e) {
    error(e.message);
  } finally {
    connecting = false;
    controls();
  }
});
$("close").addEventListener("click", async () => {
  const id = session;
  if (!id) return;
  connecting = true;
  controls();
  try {
    await queue;
    await call(`/sessions/${id}`, "DELETE");
    $("status").textContent = "Shell closed";
  } catch (e) {
    error(e.message + " The disconnected shell will expire after 10 minutes.");
    $("status").textContent = "Disconnected";
  } finally {
    session = null;
    connecting = false;
    controls();
    terminal.writeln("\r\n[Disconnected]");
  }
});
$("clear").addEventListener("click", () => {
  terminal.clear();
  terminal.focus();
});
async function initialise() {
  try {
    const { BrowserApp } = await import(
      "https://webdaemon.online/36.0.0/static/lib/js/BrowserApp.js"
    );
    const browserApp = await BrowserApp.getInstance("webdaemon-term");
    if (browserApp.isOrphan()) {
      $("status").textContent = "Open this app from Web Daemon";
      return;
    }
    endpoint = await browserApp.getAgentUrl("v1");
    app = browserApp;
    $("party").textContent = app.getParty();
    terminal = new window.Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "Menlo, Consolas, monospace",
      scrollback: 5000,
      theme: { background: "#0b1017", foreground: "#dce4ee", cursor: "#80ddaf" },
    });
    fit = new window.FitAddon.FitAddon();
    terminal.loadAddon(fit);
    terminal.open($("terminal"));
    fit.fit();
    terminal.onData((data) => {
      const id = session;
      if (!id || connecting) return;
      // Serialise input, including large pastes. Never retry a command automatically.
      enqueue(async () => {
        for (let i = 0; i < data.length; i += 8192) {
          if (session !== id || terminal.options.disableStdin) return;
          await call(`/sessions/${id}/input`, "POST", { data: data.slice(i, i + 8192) });
        }
      });
    });
    let resizeTimer;
    new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        fit.fit();
        $("size").textContent = `${terminal.cols} × ${terminal.rows}`;
        const id = session;
        if (id) {
          enqueue(() =>
            session === id &&
            call(`/sessions/${id}/resize`, "POST", { cols: terminal.cols, rows: terminal.rows })
          );
        }
      }, 100);
    }).observe($("terminal"));
    $("status").textContent = "Ready";
    controls();
  } catch (e) {
    error(e.message);
    $("status").textContent = "Could not start terminal";
  }
}
window.addEventListener("pagehide", () => {
  if (session) call(`/sessions/${session}`, "DELETE", undefined, true).catch(() => {});
});
initialise();
