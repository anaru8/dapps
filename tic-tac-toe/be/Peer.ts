import { getAppId, Lifecycle } from "webdaemon";
import { Scope } from "./Types.ts";

export async function parseOk(
  result: Response,
  target: string,
  counterparty?: string,
): Promise<unknown> {
  const text = await result.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    if (counterparty) {
      throw `${counterparty} does not accept this tic-tac-toe app. ` +
        "They may not have installed it from the same URL.";
    }
    throw `${result.status} from ${target}: ${text.slice(0, 120)}`;
  }
  if ("error" in json) {
    if (counterparty && result.status === 401) {
      throw `${counterparty} has not granted this app permission to play`;
    }
    throw String(json.error);
  }
  return json.ok;
}

export async function tabCall(
  host: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const { system: { protocol, source } } = Lifecycle.getConfig();
  const token = await Lifecycle.getTokenFor(
    { [source]: Scope.PlayGame },
    host,
  );
  const prefix = await getAppId(source);
  const result = await fetch(`${protocol}//${host}/tab/${prefix}/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "X-Tabserver-Token": token.asSignedBase64(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return await parseOk(result, `${host}${path}`, host);
}
