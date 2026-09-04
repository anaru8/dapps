import { Lifecycle } from "webdaemon";
import { parseOk } from "./Peer.ts";
import {
  COLLECTION,
  type GameState,
  isGameState,
  RecordType,
  Scope,
  type StoredRecord,
} from "./Types.ts";

async function memoryCall(
  path: string,
  capability: string,
  body: unknown,
): Promise<unknown> {
  const { system: { party, source } } = Lifecycle.getConfig();
  const token = await Lifecycle.getTokenFor({ [source]: capability }, party);
  const result = await fetch(`${token.getAud()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tabserver-Token": token.asSignedBase64(),
    },
    body: JSON.stringify(body),
  });
  return await parseOk(result, path);
}

export async function appendRecord(
  type: string,
  object: Record<string, unknown>,
  id: string,
): Promise<StoredRecord> {
  return await memoryCall("/ai/structured/append", Scope.WriteMemory, {
    collection: COLLECTION,
    type,
    object,
    options: { id },
  }) as StoredRecord;
}

export async function getRecord(id: string): Promise<StoredRecord | null> {
  try {
    const ok = await memoryCall("/ai/structured/get", Scope.ReadMemory, {
      collection: COLLECTION,
      id,
    }) as { record: StoredRecord | null };
    return ok.record;
  } catch (error) {
    if (String(error).toLowerCase().includes("not found")) return null;
    throw error;
  }
}

export async function queryRecords(
  query: Record<string, unknown>,
): Promise<StoredRecord[]> {
  try {
    const ok = await memoryCall("/ai/structured/query", Scope.ReadMemory, {
      collection: COLLECTION,
      query,
    }) as { records: StoredRecord[] };
    return ok.records;
  } catch (error) {
    console.warn(`Tic-tac-toe query returned no records: ${error}`);
    return [];
  }
}

export async function saveGame(game: GameState): Promise<void> {
  await appendRecord(
    RecordType.Game,
    game as unknown as Record<string, unknown>,
    game.id,
  );
}

export async function loadGame(id: string): Promise<GameState> {
  const record = await getRecord(id);
  if (
    !record || record.type !== RecordType.Game || !isGameState(record.object)
  ) {
    throw `Unknown game '${id}'`;
  }
  return record.object;
}
