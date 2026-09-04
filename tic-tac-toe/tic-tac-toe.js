const elements = {
  loading: document.querySelector("#loading"),
  orphan: document.querySelector("#orphan"),
  home: document.querySelector("#home"),
  game: document.querySelector("#game"),
  party: document.querySelector("#party"),
  create: document.querySelector("#create-game"),
  back: document.querySelector("#back"),
  started: document.querySelector("#started-games"),
  invited: document.querySelector("#invited-games"),
  startedCount: document.querySelector("#started-count"),
  invitedCount: document.querySelector("#invited-count"),
  homeError: document.querySelector("#home-error"),
  gameError: document.querySelector("#game-error"),
  status: document.querySelector("#game-status"),
  round: document.querySelector("#round"),
  mark: document.querySelector("#your-mark"),
  board: document.querySelector("#board"),
  playerX: document.querySelector("#player-x"),
  playerO: document.querySelector("#player-o"),
  opponentSelected: document.querySelector("#opponent-selected"),
  inviteForm: document.querySelector("#invite-form"),
  opponent: document.querySelector("#opponent"),
  restart: document.querySelector("#restart"),
};

let app;
let api;
let party;
let currentGame = null;
let pollTimer = null;
let movePending = false;

class Api {
  constructor(tabUrl, browserApp) {
    this.tabUrl = tabUrl;
    this.app = browserApp;
  }

  async call(path, method = "GET", body) {
    const result = await fetch(`${this.tabUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        "X-Tabserver-Token": this.app.getTokenBase64(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await result.json();
    if ("error" in json) throw json.error;
    return json.ok;
  }

  listGames() {
    return this.call("/games");
  }

  createGame() {
    return this.call("/games", "POST", {});
  }

  invite(gameId, opponent) {
    return this.call("/invite", "POST", { gameId, opponent });
  }

  state(gameId) {
    return this.call(`/state?game=${encodeURIComponent(gameId)}`);
  }

  move(game, index) {
    return this.call("/move", "POST", {
      gameId: game.id,
      index,
      version: game.version,
      moveId: crypto.randomUUID(),
    });
  }

  restart(gameId) {
    return this.call("/restart", "POST", { gameId });
  }
}

function show(name) {
  for (const key of ["loading", "orphan", "home", "game"]) {
    elements[key].hidden = key !== name;
  }
}

function showError(element, error) {
  element.textContent = String(error);
  element.hidden = false;
}

function clearError(element) {
  element.textContent = "";
  element.hidden = true;
}

function gameCard(summary, invited) {
  const button = document.createElement("button");
  button.className = "game-card";
  button.type = "button";
  const opponent = invited
    ? `Hosted by ${summary.host}`
    : summary.opponent
    ? `Against ${summary.opponent}`
    : "Waiting for an opponent";
  const stateLabel = invited
    ? "Invited game"
    : labelForStatus(summary.status, summary.winner);
  button.innerHTML = `
    <span class="mini-board" aria-hidden="true">${invited ? "○" : "×"}</span>
    <span class="card-copy">
      <strong>${escapeHtml(opponent)}</strong>
      <small>${escapeHtml(stateLabel)}</small>
    </span>
    <span class="arrow" aria-hidden="true">→</span>
  `;
  button.addEventListener("click", () => openGame(summary.id));
  return button;
}

function emptyCard(text) {
  const element = document.createElement("p");
  element.className = "empty";
  element.textContent = text;
  return element;
}

function labelForStatus(status, winner) {
  if (status === "waiting") return "Waiting to begin";
  if (status === "won") return `${winner} won`;
  if (status === "draw") return "Draw";
  return "In progress";
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

async function loadHome() {
  stopPolling();
  currentGame = null;
  show("loading");
  clearError(elements.homeError);
  try {
    const { started, invited } = await api.listGames();
    elements.started.replaceChildren(
      ...(started.length
        ? started.map((game) => gameCard(game, false))
        : [emptyCard("No games yet. Start the first one.")]),
    );
    elements.invited.replaceChildren(
      ...(invited.length
        ? invited.map((game) => gameCard(game, true))
        : [emptyCard("Invitations will appear here.")]),
    );
    elements.startedCount.textContent = started.length;
    elements.invitedCount.textContent = invited.length;
    show("home");
  } catch (error) {
    show("home");
    showError(elements.homeError, error);
  }
}

async function openGame(id) {
  show("loading");
  clearError(elements.gameError);
  try {
    const { game } = await api.state(id);
    currentGame = game;
    renderGame();
    show("game");
    startPolling();
  } catch (error) {
    show("home");
    showError(elements.homeError, error);
  }
}

function renderGame() {
  if (!currentGame) return;
  const isHost = currentGame.host === party;
  const mark = isHost ? "X" : "O";
  const opponent = isHost ? currentGame.players.O : currentGame.players.X;
  const canMove = currentGame.status === "playing" &&
    (isHost || currentGame.turn === mark);

  elements.round.textContent = `Round ${currentGame.round}`;
  const activeMark = isHost && currentGame.status === "playing"
    ? currentGame.turn
    : mark;
  elements.mark.textContent = activeMark;
  elements.mark.className = `mark-badge mark-${activeMark.toLowerCase()}`;
  elements.playerX.textContent = isHost ? "You" : currentGame.players.X;
  elements.playerO.textContent = isHost ? currentGame.players.O : "You";
  elements.opponentSelected.hidden = !currentGame.players.O;
  elements.inviteForm.hidden = !isHost || Boolean(currentGame.players.O);
  elements.restart.hidden = !isHost ||
    !["won", "draw"].includes(currentGame.status);

  if (currentGame.status === "waiting") {
    elements.status.textContent = "Add another daemon to begin";
  } else if (currentGame.status === "won") {
    const winnerParty = currentGame.players[currentGame.winner];
    elements.status.textContent = winnerParty === party
      ? `You won as ${currentGame.winner}`
      : `${winnerParty} won as ${currentGame.winner}`;
  } else if (currentGame.status === "draw") {
    elements.status.textContent = "A perfectly balanced draw";
  } else if (isHost) {
    const actingFor = currentGame.turn === "X" ? "yourself" : opponent;
    elements.status.textContent = `Play ${currentGame.turn} for ${actingFor}`;
  } else {
    elements.status.textContent = canMove
      ? "Your turn"
      : `Waiting for ${opponent}`;
  }

  const cells = currentGame.board.map((value, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cell${value ? ` cell-${value.toLowerCase()}` : ""}`;
    button.setAttribute("role", "gridcell");
    button.setAttribute(
      "aria-label",
      value ? `Square ${index + 1}: ${value}` : `Square ${index + 1}: empty`,
    );
    button.textContent = value;
    button.disabled = movePending || !canMove || Boolean(value);
    button.addEventListener("click", () => makeMove(index));
    return button;
  });
  elements.board.replaceChildren(...cells);
}

async function makeMove(index) {
  if (!currentGame || movePending) return;
  movePending = true;
  clearError(elements.gameError);
  renderGame();
  try {
    const { game } = await api.move(currentGame, index);
    currentGame = game;
  } catch (error) {
    showError(elements.gameError, error);
    await refreshGame();
  } finally {
    movePending = false;
    renderGame();
  }
}

async function refreshGame() {
  if (!currentGame) return;
  try {
    const { game } = await api.state(currentGame.id);
    if (game.version !== currentGame.version) {
      currentGame = game;
      renderGame();
    }
  } catch (error) {
    showError(elements.gameError, error);
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(refreshGame, 2500);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

elements.create.addEventListener("click", async () => {
  clearError(elements.homeError);
  elements.create.disabled = true;
  try {
    const { game } = await api.createGame();
    await openGame(game.id);
  } catch (error) {
    showError(elements.homeError, error);
  } finally {
    elements.create.disabled = false;
  }
});

elements.inviteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentGame) return;
  clearError(elements.gameError);
  const button = elements.inviteForm.querySelector("button");
  button.disabled = true;
  try {
    const { game } = await api.invite(currentGame.id, elements.opponent.value);
    currentGame = game;
    elements.opponent.value = "";
    renderGame();
  } catch (error) {
    showError(elements.gameError, error);
  } finally {
    button.disabled = false;
  }
});

elements.restart.addEventListener("click", async () => {
  if (!currentGame) return;
  clearError(elements.gameError);
  elements.restart.disabled = true;
  try {
    const { game } = await api.restart(currentGame.id);
    currentGame = game;
    renderGame();
  } catch (error) {
    showError(elements.gameError, error);
  } finally {
    elements.restart.disabled = false;
  }
});

elements.back.addEventListener("click", loadHome);

async function initialise() {
  let opened = false;
  const orphanTimeout = setTimeout(() => {
    if (!opened) show("orphan");
  }, 4000);
  try {
    const { BrowserApp } = await import(
      "https://webdaemon.online/35.0.4/static/lib/index.js"
    );
    app = await BrowserApp.getInstance("noughts-and-daemons");
    if (app.isOrphan()) {
      clearTimeout(orphanTimeout);
      show("orphan");
      return;
    }
    opened = true;
    clearTimeout(orphanTimeout);
    party = app.getParty().toLowerCase();
    elements.party.textContent = party;
    elements.party.hidden = false;
    api = new Api(await app.getAgentUrl("v1"), app);
    await loadHome();
  } catch (error) {
    clearTimeout(orphanTimeout);
    show("orphan");
    console.error(error);
  }
}

initialise();
