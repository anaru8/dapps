# Noughts and Daemons

Noughts and Daemons is a two-player, cross-daemon tic-tac-toe app for Web Daemon.

One daemon creates and hosts each game.
The host enters one opponent daemon and presses **Add**.
After that invitation succeeds, the opponent is permanently assigned to the game.
The home screen separates games the owner started from games they were invited to.

## How it works

- The host stores the single authoritative game record in structured memory.
- The invited daemon stores only a reference containing the host daemon.
- A guest move travels through the guest's agent tab to the host's agent tab.
- The host derives player identity from the signed token and validates every move.
- For testing, the host may click for both marks; each click uses the current turn and therefore alternates X and O.
- An invited player can act only as O and only when it is O's turn.
- The frontend polls the host-owned state every 2.5 seconds while a game is open.
- Both players must install the app from the exact same public URL.

The app deliberately has no static backend, WebSockets, AI dependency, push notifications, or Web Daemon platform changes.

## Files

- `tic-tac-toe.html`, `tic-tac-toe.css`, `tic-tac-toe.js`: browser application.
- `tic-tac-toe.yml`: Web Daemon scopes, grants, audience, and agent tab.
- `be/server.ts`: agent-side HTTP server.
- `be/Routes.ts`: owner-facing and counterparty-facing routes.
- `be/Game.ts`: deterministic game rules.
- `be/Memory.ts`: structured-memory persistence.
- `be/Peer.ts`: authenticated cross-daemon calls.

## Test

```sh
deno task verify
```

## Install

Host this directory at a stable public URL, then install the URL of `tic-tac-toe.html` from the Web Daemon shell.

For local static-file development:

```sh
python3 -m http.server 8000
```

Opening the page directly shows an instruction to launch it through Web Daemon because ordinary browser sessions do not have a daemon identity or launch token.
