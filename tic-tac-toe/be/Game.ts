import {
  type Cell,
  type GameState,
  type Mark,
  normalizeParty,
} from "./Types.ts";

const WINNING_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

export function createGame(id: string, host: string): GameState {
  const party = normalizeParty(host);
  if (!party) throw "Missing host daemon";
  return {
    id,
    host: party,
    players: { X: party, O: null },
    board: Array<Cell>(9).fill(""),
    turn: "X",
    status: "waiting",
    winner: null,
    version: 0,
    round: 1,
    updatedAt: Date.now(),
  };
}

export function selectOpponent(
  game: GameState,
  opponent: string,
): GameState {
  if (game.opponentType === "daemon") {
    throw "This game is already being played against your daemon";
  }
  const party = normalizeParty(opponent);
  if (!party) throw "Enter a daemon hostname";
  if (party === game.host) throw "You cannot invite your own daemon";
  if (game.players.O && game.players.O !== party) {
    throw `This game is already assigned to ${game.players.O}`;
  }
  if (game.players.O === party) return game;
  return {
    ...game,
    players: { ...game.players, O: party },
    opponentType: "player",
    status: "playing",
    version: game.version + 1,
    updatedAt: Date.now(),
  };
}

export function startDaemonGame(game: GameState): GameState {
  if (game.players.O || game.opponentType === "player") {
    throw "This game already has an invited player";
  }
  if (game.opponentType === "daemon") return game;
  if (game.status !== "waiting") throw "This game has already started";
  return {
    ...game,
    opponentType: "daemon",
    status: "playing",
    updatedAt: Date.now(),
  };
}

export function markForParty(game: GameState, party: string): Mark {
  const normalized = normalizeParty(party);
  if (game.players.X === normalized) return "X";
  if (game.players.O === normalized) return "O";
  throw `${normalized || "Unknown daemon"} is not a player in this game`;
}

export function applyMove(
  game: GameState,
  party: string,
  index: number,
  expectedVersion: number,
  moveId: string,
  canPlayBoth = false,
): GameState {
  if (moveId && game.lastMoveId === moveId) return game;
  if (game.version !== expectedVersion) {
    throw "The game changed. Refresh and try again.";
  }
  if (game.status !== "playing") throw "This game is not accepting moves";
  if (!Number.isInteger(index) || index < 0 || index > 8) {
    throw "Choose a square from 0 to 8";
  }
  if (game.board[index] !== "") throw "That square is already occupied";

  if (canPlayBoth && normalizeParty(party) !== game.host) {
    throw "Only the game owner can play both marks";
  }
  const mark = canPlayBoth ? game.turn : markForParty(game, party);
  if (game.turn !== mark) throw "It is not your turn";

  return placeMark(game, index, mark, moveId || undefined);
}

function placeMark(
  game: GameState,
  index: number,
  mark: Mark,
  moveId?: string,
): GameState {
  const board = [...game.board];
  board[index] = mark;
  const winner = findWinner(board);
  const status = winner ? "won" : board.every(Boolean) ? "draw" : "playing";

  return {
    ...game,
    board,
    turn: mark === "X" ? "O" : "X",
    status,
    winner,
    version: game.version + 1,
    updatedAt: Date.now(),
    lastMoveId: moveId ?? game.lastMoveId,
  };
}

export function makeDaemonMove(game: GameState): GameState {
  if (
    game.opponentType !== "daemon" ||
    game.status !== "playing" ||
    game.turn !== "O"
  ) {
    return game;
  }
  const index = chooseDaemonMove(game.board);
  if (index === null) return game;
  return placeMark(game, index, "O");
}

export function chooseDaemonMove(board: Cell[]): number | null {
  const empty = board
    .map((cell, index) => cell === "" ? index : -1)
    .filter((index) => index >= 0);
  if (!empty.length) return null;

  for (const mark of ["O", "X"] as const) {
    for (const index of empty) {
      const candidate = [...board];
      candidate[index] = mark;
      if (findWinner(candidate) === mark) return index;
    }
  }

  return [4, 0, 2, 6, 8, 1, 3, 5, 7].find((index) => board[index] === "") ??
    null;
}

export function restartGame(game: GameState): GameState {
  if (!game.players.O && game.opponentType !== "daemon") {
    throw "Add an opponent before starting a round";
  }
  const startingMark: Mark = game.round % 2 === 0 ? "X" : "O";
  return {
    ...game,
    board: Array<Cell>(9).fill(""),
    turn: startingMark,
    status: "playing",
    winner: null,
    version: game.version + 1,
    round: game.round + 1,
    updatedAt: Date.now(),
    lastMoveId: undefined,
  };
}

export function findWinner(board: Cell[]): Mark | null {
  for (const [a, b, c] of WINNING_LINES) {
    const mark = board[a];
    if (mark && mark === board[b] && mark === board[c]) return mark;
  }
  return null;
}
