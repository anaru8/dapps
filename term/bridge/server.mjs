import http from "node:http";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { authenticate } from "./auth.mjs";

const origin = new URL(process.env.TERM_DAEMON_ORIGIN).origin;
const source = new URL(process.env.TERM_APP_SOURCE).href;
const port = Number(process.env.TERM_PORT || 8768);
const shell = process.env.TERM_SHELL || (existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh");
const python = process.env.TERM_PYTHON || "python3";
const idleMs = 10 * 60 * 1000;
const maxBytes = 1024 * 1024;
const sessions = new Map();

function dimensions(body) {
  if (
    !Number.isInteger(body.cols) || !Number.isInteger(body.rows) ||
    body.cols < 2 || body.cols > 500 || body.rows < 1 || body.rows > 300
  ) {
    throw new Error("Invalid terminal size");
  }
  return { cols: body.cols, rows: body.rows };
}
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}
function reply(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}
function close(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  s.child.kill("SIGTERM");
}
function send(s, message) {
  if (s.exited || !s.child.stdin.writable) throw new Error("Shell has exited");
  if (s.child.stdin.writableLength > 65536) throw new Error("Shell input is busy");
  s.child.stdin.write(`${JSON.stringify(message)}\n`);
}
const server = http.createServer(async (req, res) => {
  let owner;
  try {
    owner = await authenticate(req.headers["x-tabserver-token"], origin, source);
  } catch {
    reply(res, 403, { error: "A valid owner device token with terminal capability is required." });
    return;
  }
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/sessions") {
      const size = dimensions(await body(req));
      if (sessions.size >= 4) {
        return reply(res, 429, {
          error: "Four shells are already open. Close one or wait 10 minutes.",
        });
      }
      const child = spawn(python, [
        fileURLToPath(new URL("./worker.py", import.meta.url)),
        shell,
        String(size.cols),
        String(size.rows),
      ], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
      const id = randomUUID();
      const s = {
        owner,
        child,
        output: Buffer.alloc(0),
        base: 0,
        end: 0,
        lastSeen: Date.now(),
        exited: false,
        exitCode: null,
      };
      sessions.set(id, s);
      child.stdin.on("error", () => {});
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        try {
          const data = Buffer.from(JSON.parse(line).data, "base64");
          s.output = Buffer.concat([s.output, data]);
          s.end += data.length;
          if (s.output.length > maxBytes) s.output = s.output.subarray(s.output.length - maxBytes);
          s.base = s.end - s.output.length;
        } catch {
          close(id);
        }
      });
      child.stderr.on("data", (chunk) => {
        const data = Buffer.from(
          "\r\n[Terminal service: " + chunk.toString().slice(0, 2048) + "]\r\n",
        );
        s.output = Buffer.concat([s.output, data]).subarray(-maxBytes);
        s.end += data.length;
        s.base = s.end - s.output.length;
      });
      child.on("error", () => {
        s.exited = true;
        s.exitCode = -1;
      });
      child.on("exit", (code) => {
        s.exited = true;
        s.exitCode = code;
      });
      return reply(res, 200, { ok: { id, shell, ...size } });
    }
    const match = /^\/sessions\/([\w-]+)(?:\/(input|resize|output))?$/.exec(url.pathname);
    const s = match && sessions.get(match[1]);
    if (!s || s.owner !== owner) {
      return reply(res, 404, { error: "Shell session ended. Open a new shell." });
    }
    s.lastSeen = Date.now();
    if (req.method === "DELETE" && !match[2]) {
      close(match[1]);
      return reply(res, 200, { ok: true });
    }
    if (req.method === "GET" && match[2] === "output") {
      const after = Number(url.searchParams.get("after") || 0);
      if (!Number.isSafeInteger(after) || after < 0 || after > s.end) {
        throw new Error("Invalid output cursor");
      }
      const start = Math.max(after, s.base);
      return reply(res, 200, {
        ok: {
          data: s.output.subarray(start - s.base).toString("base64"),
          next: s.end,
          truncated: after < s.base,
          exited: s.exited,
          exitCode: s.exitCode,
        },
      });
    }
    if (req.method === "POST" && match[2] === "input") {
      const data = await body(req);
      if (typeof data.data !== "string" || data.data.length > 32768) {
        throw new Error("Input too large");
      }
      send(s, { op: "input", data: Buffer.from(data.data, "utf8").toString("base64") });
      return reply(res, 200, { ok: true });
    }
    if (req.method === "POST" && match[2] === "resize") {
      send(s, { op: "resize", ...dimensions(await body(req)) });
      return reply(res, 200, { ok: true });
    }
    reply(res, 405, { error: "Method not allowed" });
  } catch (error) {
    reply(res, 400, { error: error.message });
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
setInterval(() => {
  for (const [id, s] of sessions) if (Date.now() - s.lastSeen > idleMs) close(id);
}, 30000).unref();
function shutdown() {
  for (const id of sessions.keys()) close(id);
  server.close();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
server.listen(
  port,
  "127.0.0.1",
  () => console.log(`Term bridge listening on 127.0.0.1:${server.address().port}`),
);
