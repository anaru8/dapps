import {
  applyMove,
  createGame,
  findWinner,
  restartGame,
  selectOpponent,
} from "./Game.ts";
import type { Cell } from "./Types.ts";

function equal(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

function throws(work: () => unknown, message: string): void {
  try {
    work();
  } catch (error) {
    if (String(error).includes(message)) return;
    throw error;
  }
  throw new Error(`Expected error containing '${message}'`);
}

Deno.test("a game waits until one opponent is selected", () => {
  const game = createGame("g1", "Alice.Example");
  equal(game.status, "waiting");
  equal(game.players, { X: "alice.example", O: null });

  const ready = selectOpponent(game, "Bob.Example");
  equal(ready.status, "playing");
  equal(ready.players.O, "bob.example");
  throws(() => selectOpponent(ready, "charlie.example"), "already assigned");
});

Deno.test("players must alternate and cannot overwrite a square", () => {
  let game = selectOpponent(createGame("g1", "alice"), "bob");
  game = applyMove(game, "alice", 0, game.version, "m1");
  equal(game.board[0], "X");
  equal(game.turn, "O");
  throws(
    () => applyMove(game, "alice", 1, game.version, "m2"),
    "not your turn",
  );
  throws(
    () => applyMove(game, "bob", 0, game.version, "m3"),
    "already occupied",
  );
});

Deno.test("the owner can alternate both marks for testing", () => {
  let game = selectOpponent(createGame("g1", "alice"), "bob");
  game = applyMove(game, "alice", 0, game.version, "m1", true);
  game = applyMove(game, "alice", 4, game.version, "m2", true);
  equal(game.board[0], "X");
  equal(game.board[4], "O");
  equal(game.turn, "X");
  throws(
    () => applyMove(game, "bob", 1, game.version, "m3", true),
    "Only the game owner",
  );
});

Deno.test("a winning line ends the game", () => {
  let game = selectOpponent(createGame("g1", "alice"), "bob");
  for (
    const [party, index] of [
      ["alice", 0],
      ["bob", 3],
      ["alice", 1],
      ["bob", 4],
      ["alice", 2],
    ] as const
  ) {
    game = applyMove(game, party, index, game.version, crypto.randomUUID());
  }
  equal(game.status, "won");
  equal(game.winner, "X");
});

Deno.test("winner detection covers diagonals", () => {
  const board: Cell[] = ["O", "", "X", "", "O", "", "X", "", "O"];
  equal(findWinner(board), "O");
});

Deno.test("restart clears the board and alternates the starter", () => {
  let game = selectOpponent(createGame("g1", "alice"), "bob");
  game = restartGame(game);
  equal(game.board, ["", "", "", "", "", "", "", "", ""]);
  equal(game.round, 2);
  equal(game.turn, "O");
});
