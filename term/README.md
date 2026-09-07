# Terminal for Web Daemon

An owner-only interactive terminal, with a real PTY, command history, colours, Ctrl+C, resizing, and interactive programs such as `top` and `vi`.
The shell runs as the terminal service user in the environment where that service is installed.

## Why there is a service

[Web Daemon agent-side tabs](https://webdaemon.online/latest/static/docs/apps/agent-side.html#sandbox-constraints) have network access only and cannot spawn a shell or access the container filesystem.
This app therefore includes a trusted loopback service that must run **inside the daemon container** to provide that container's shell.
Running the service on another host or in a separate container gives you that other environment instead.
The ordinary app sandbox remains unchanged.

## Install

1. Host this directory at a stable public HTTPS URL, keeping the `be` and `vendor` folders beside `term.html`.
2. Install the public URL of `term.html` through the Web Daemon launcher.
3. Place this directory inside the daemon container, for example at `/opt/term`.
4. Ensure the container has Node.js 22 or newer, Python 3, and `/bin/sh`.
5. Install dependencies and start the bridge **inside that container**, using your real daemon origin and the exact installed app URL:

```sh
cd /opt/term
npm ci --omit=dev --ignore-scripts
TERM_DAEMON_ORIGIN='https://YOUR-DAEMON-HOST' \
TERM_APP_SOURCE='https://YOUR-APP-HOST/term/term.html' \
npm start
```

6. Open Terminal from the Web Daemon launcher and click **Open shell**.

The bridge must stay running alongside the daemon process.
Add the command to your existing container process supervisor for persistent use, and include the files and dependencies in your image so they survive recreation.
Run it as the OS user whose shell access you want, normally the daemon user.
Do not publish port 8768; the service binds only to `127.0.0.1`.
No daemon deployment files are changed by this app.

The service uses `/bin/bash` when installed, otherwise `/bin/sh`.
Set `TERM_SHELL` to choose another shell.
Command history and editing features depend on that shell.
`TERM_PYTHON` can name an alternative Python 3 executable.
The app expects port 8768; `TERM_PORT` is intended for tests and requires a matching backend edit if changed in deployment.

## Behaviour

- Commands, working directory, and environment variables persist in the current shell.
- **Clear** clears terminal scrollback; **Close shell** ends the session.
- Reloading or closing the page requests session cleanup.
- Sessions expire after 10 minutes without requests, including when the browser disappears without closing cleanly.
- Up to four sessions can run at once, with a 1 MiB output buffer per session.
- Browser polling transports raw terminal bytes over the normal authenticated tab route, so no WebSocket proxy changes are needed.
- A connection error does not replay commands automatically.
- Terminal sessions are temporary and end when the bridge or container stops.

## Access control

The manifest grants `terminal` only to the owning daemon for this exact app.
The tab verifies the token and capability before forwarding requests.
The bridge independently checks its configured daemon origin, exact app source, capability, token lifetime, device issuer, and cryptographic signature.
It rejects tokens from other apps, other daemons, agent issuers, and delegated callers.
Only signed owner device tokens can open or use a shell.
The bridge does not store browser tokens or command history on disk.
Shell programs may still write their normal files and shell history.

The bridge needs network access to the configured daemon origin to retrieve its device verification key.
Use a daemon origin and app URL you control; the app is an administrative interface with the service user's filesystem and process permissions.

## Verify

```sh
npm ci --ignore-scripts
npm test
deno task check
```

Tests use a local signed-token issuer and real PTYs to verify authentication, state, Unicode output, resizing, interruption, exit, and session limits.
They require macOS or Linux, Python 3, and permission to open loopback servers and PTYs.
The Deno check validates the agent-side TypeScript against WebDaemon 36.0.0.

The bundled xterm.js 6.0.0 and fit addon 0.11.0 browser files include their MIT licence notices in `vendor/`.
The SDK is pinned to WebDaemon 36.0.0.

For the optional Chrome browser test, set `TERM_PLAYWRIGHT_MODULE` to the absolute path of an installed Playwright `index.mjs` and `TERM_BROWSER_CHANNEL=chrome` before running `npm test`.
This test substitutes the browser launch handshake and tab proxy, then exercises the real signed-token bridge and shell at desktop and mobile sizes.
It does not replace testing in your deployed daemon.
