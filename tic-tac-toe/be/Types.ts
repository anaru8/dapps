export const Scope = {
  ManageGame: "manage_game",
  PlayGame: "play_game",
  WriteMemory: "write_memory",
  ReadMemory: "read_memory",
} as const;

export const COLLECTION = "tic-tac-toe";

export const RecordType = {
  Game: "game",
  Ref: "ref",
} as const;

export type Mark = "X" | "O";
export type Cell = Mark | "";
export type GameStatus = "waiting" | "playing" | "won" | "draw";

export interface GameState {
  id: string;
  host: string;
  players: {
    X: string;
    O: string | null;
  };
  opponentType?: "daemon" | "player";
  board: Cell[];
  turn: Mark;
  status: GameStatus;
  winner: Mark | null;
  version: number;
  round: number;
  updatedAt: number;
  lastMoveId?: string;
}

export interface GameRef {
  host: string;
}

export interface StoredRecord {
  id: string;
  type: string;
  object: Record<string, unknown>;
  created: string;
}

export function normalizeParty(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const game = value as Record<string, unknown>;
  const players = game.players as Record<string, unknown> | undefined;
  const board = game.board;
  return (
    typeof game.id === "string" &&
    typeof game.host === "string" &&
    !!players &&
    typeof players.X === "string" &&
    (players.O === null || typeof players.O === "string") &&
    (
      game.opponentType === undefined ||
      game.opponentType === "daemon" ||
      game.opponentType === "player"
    ) &&
    Array.isArray(board) &&
    board.length === 9 &&
    board.every((cell) => cell === "" || cell === "X" || cell === "O") &&
    (game.turn === "X" || game.turn === "O") &&
    ["waiting", "playing", "won", "draw"].includes(String(game.status)) &&
    (game.winner === null || game.winner === "X" || game.winner === "O") &&
    Number.isInteger(game.version) &&
    Number.isInteger(game.round) &&
    typeof game.updatedAt === "number"
  );
}

export function isGameRef(value: unknown): value is GameRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return typeof (value as Record<string, unknown>).host === "string";
}
