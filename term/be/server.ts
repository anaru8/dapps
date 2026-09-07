import { AbstractHandler, Lifecycle, response } from "webdaemon";

const lifecycle = new Lifecycle();
class Terminal extends AbstractHandler {
  override async handle(): Promise<Response> {
    this.assertCapability("terminal");
    const { system } = Lifecycle.getConfig();
    if (this.token?.getCounterparty() !== system.party || this.token.getSrc() !== system.source) {
      return response({ error: "Only the daemon owner can use this terminal." });
    }
    this.token.checkPeriod();
    const match = /\/sessions(?:\/[\w-]+(?:\/(?:input|resize|output))?)?$/.exec(this.url.pathname);
    if (!match || !["GET", "POST", "DELETE"].includes(this.request.method)) {
      return response({ error: "Unknown terminal endpoint." });
    }
    try {
      const upstream = await fetch(`http://127.0.0.1:8768${match[0]}${this.url.search}`, {
        method: this.request.method,
        headers: {
          "X-Tabserver-Token": this.request.headers.get("X-Tabserver-Token")!,
          "Content-Type": "application/json",
        },
        body: this.request.method === "POST" ? await this.request.text() : undefined,
        signal: AbortSignal.timeout(10000),
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch {
      return response({
        error:
          "Terminal service unavailable. Start the term bridge inside the daemon container. See term/README.md.",
      });
    }
  }
}
Deno.serve(
  { port: 0 },
  (request) =>
    Lifecycle.shouldHandle(request) ? lifecycle.handler(request) : new Terminal(request).handler(),
);
