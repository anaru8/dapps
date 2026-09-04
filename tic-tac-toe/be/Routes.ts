import { Lifecycle, response, Token } from "webdaemon";
import { applyMove, createGame, restartGame, selectOpponent } from "./Game.ts";
import {
  appendRecord,
  getRecord,
  loadGame,
  queryRecords,
  saveGame,
} from "./Memory.ts";
import { tabCall } from "./Peer.ts";
import {
  isGameRef,
  isGameState,
  normalizeParty,
  RecordType,
  Scope,
  type StoredRecord,
} from "./Types.ts";

type CapabilityToken = ReturnType<typeof Token.from>;

const locks = new Map<string, Promise<void>>();

async function withGameLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(id, queued);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (locks.get(id) === queued) locks.delete(id);
  }
}

function requireCapability(
  request: Request,
  capability: string,
): NonNullable<CapabilityToken> {
  const token = Token.from(request);
  const source = Lifecycle.getConfig().system.source;
  if (!token?.hasCapability(source, capability)) {
    throw `Missing capability: ${capability}`;
  }
  return token;
}

async function json(request: Request): Promise<Record<string, unknown>> {
  return await request.json() as Record<string, unknown>;
}

function gameSummary(record: StoredRecord): Record<string, unknown> {
  const game = record.object;
  return {
    id: record.id,
    host: game.host,
    opponent: (game.players as { O?: string | null } | undefined)?.O ?? null,
    status: game.status,
    winner: game.winner,
    round: game.round,
    updatedAt: game.updatedAt,
    created: record.created,
  };
}

export async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "POST" && path.endsWith("/games")) {
    requireCapability(request, Scope.ManageGame);
    const { system: { party } } = Lifecycle.getConfig();
    const game = createGame(crypto.randomUUID(), party);
    await saveGame(game);
    return response({ ok: { game } });
  }

  if (request.method === "GET" && path.endsWith("/games")) {
    requireCapability(request, Scope.ManageGame);
    const started = await queryRecords({
      type: RecordType.Game,
      select: [
        "id",
        "host",
        "players",
        "status",
        "winner",
        "round",
        "updatedAt",
        "created",
      ],
    });
    const invited = await queryRecords({
      type: RecordType.Ref,
      select: ["id", "host", "created"],
    });
    return response({
      ok: {
        started: started.filter((record) => isGameState(record.object)).map(
          gameSummary,
        ),
        invited: invited
          .filter((record) => isGameRef(record.object))
          .map((record) => ({
            id: record.id,
            host: record.object.host,
            created: record.created,
          })),
      },
    });
  }

  if (request.method === "POST" && path.endsWith("/invite")) {
    requireCapability(request, Scope.ManageGame);
    const { gameId, opponent } = await json(request);
    const id = String(gameId ?? "");
    const invitee = normalizeParty(opponent);
    if (!id || !invitee) throw "Missing game or opponent daemon";

    const game = await loadGame(id);
    const { system: { party } } = Lifecycle.getConfig();
    if (game.host !== normalizeParty(party)) {
      throw "Only the host may invite a player";
    }
    if (game.players.O && game.players.O !== invitee) {
      throw `This game is already assigned to ${game.players.O}`;
    }
    if (!game.players.O) {
      await tabCall(invitee, "/invited", { gameId: game.id });
      await saveGame(selectOpponent(game, invitee));
    }
    return response({ ok: { game: await loadGame(id) } });
  }

  if (request.method === "POST" && path.endsWith("/invited")) {
    const token = requireCapability(request, Scope.PlayGame);
    const host = normalizeParty(token!.getCounterparty());
    const { gameId } = await json(request);
    const id = String(gameId ?? "");
    if (!id) throw "Missing game";
    const { system: { party } } = Lifecycle.getConfig();
    if (host === normalizeParty(party)) {
      throw "You cannot invite your own daemon";
    }

    const existing = await getRecord(id);
    if (existing) {
      if (
        existing.type !== RecordType.Ref ||
        !isGameRef(existing.object) ||
        existing.object.host !== host
      ) {
        throw `Game id '${id}' is already in use`;
      }
      return response({ ok: true });
    }
    await appendRecord(RecordType.Ref, { host }, id);
    return response({ ok: true });
  }

  if (request.method === "GET" && path.endsWith("/state")) {
    requireCapability(request, Scope.ManageGame);
    const id = url.searchParams.get("game") ?? "";
    const record = await getRecord(id);
    if (!record) throw `Unknown game '${id}'`;
    if (record.type === RecordType.Game && isGameState(record.object)) {
      return response({ ok: { game: record.object } });
    }
    if (record.type === RecordType.Ref && isGameRef(record.object)) {
      const ok = await tabCall(
        record.object.host,
        `/fetch?game=${encodeURIComponent(id)}`,
      );
      return response({ ok });
    }
    throw `Invalid game '${id}'`;
  }

  if (request.method === "GET" && path.endsWith("/fetch")) {
    const token = requireCapability(request, Scope.PlayGame);
    const requester = normalizeParty(token!.getCounterparty());
    const id = url.searchParams.get("game") ?? "";
    const game = await loadGame(id);
    if (game.players.O !== requester) {
      throw `${requester} is not the invited player for this game`;
    }
    return response({ ok: { game } });
  }

  if (request.method === "POST" && path.endsWith("/move")) {
    requireCapability(request, Scope.ManageGame);
    const body = await json(request);
    const id = String(body.gameId ?? "");
    const index = Number(body.index);
    const version = Number(body.version);
    const moveId = String(body.moveId ?? "");
    const record = await getRecord(id);
    if (!record) throw `Unknown game '${id}'`;

    if (record.type === RecordType.Ref && isGameRef(record.object)) {
      const ok = await tabCall(record.object.host, "/moved", {
        gameId: id,
        index,
        version,
        moveId,
      });
      return response({ ok });
    }
    if (record.type !== RecordType.Game || !isGameState(record.object)) {
      throw `Invalid game '${id}'`;
    }

    const { system: { party } } = Lifecycle.getConfig();
    const game = await withGameLock(id, async () => {
      const latest = await loadGame(id);
      const updated = applyMove(latest, party, index, version, moveId, true);
      await saveGame(updated);
      return updated;
    });
    return response({ ok: { game } });
  }

  if (request.method === "POST" && path.endsWith("/moved")) {
    const token = requireCapability(request, Scope.PlayGame);
    const requester = normalizeParty(token!.getCounterparty());
    const body = await json(request);
    const id = String(body.gameId ?? "");
    const game = await withGameLock(id, async () => {
      const latest = await loadGame(id);
      const updated = applyMove(
        latest,
        requester,
        Number(body.index),
        Number(body.version),
        String(body.moveId ?? ""),
      );
      await saveGame(updated);
      return updated;
    });
    return response({ ok: { game } });
  }

  if (request.method === "POST" && path.endsWith("/restart")) {
    requireCapability(request, Scope.ManageGame);
    const { gameId } = await json(request);
    const id = String(gameId ?? "");
    const { system: { party } } = Lifecycle.getConfig();
    const game = await withGameLock(id, async () => {
      const latest = await loadGame(id);
      if (latest.host !== normalizeParty(party)) {
        throw "Only the host can start another round";
      }
      const updated = restartGame(latest);
      await saveGame(updated);
      return updated;
    });
    return response({ ok: { game } });
  }

  throw "Invalid request to tic-tac-toe";
}
