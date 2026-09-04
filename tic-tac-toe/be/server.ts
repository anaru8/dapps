import { Lifecycle, response } from "webdaemon";
import { route } from "./Routes.ts";

const lifecycle = new Lifecycle();

async function handler(request: Request): Promise<Response> {
  try {
    if (Lifecycle.shouldHandle(request)) {
      return await lifecycle.handler(request);
    }
    return await route(request);
  } catch (error) {
    console.error(error);
    return response({ error: String(error) });
  }
}

Deno.serve({ port: 0 }, handler);
