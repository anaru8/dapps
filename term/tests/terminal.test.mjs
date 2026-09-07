import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

const algorithm = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

test(
  "signed owner opens a real PTY; unauthorised callers cannot",
  { timeout: 30000 },
  async (t) => {
    const key = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", key.publicKey);
    const issuer = http.createServer((_, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: { src: "party:control", jwk } }));
    });
    issuer.listen(0, "127.0.0.1");
    await once(issuer, "listening");
    t.after(() => issuer.close());
    const origin = `http://127.0.0.1:${issuer.address().port}`;
    const source = "https://apps.example.com/term/term.html";
    async function token(overrides = {}) {
      const payload = {
        iss: `${origin}/device/test`,
        aud: origin,
        sub: origin,
        src: source,
        scope: { [source]: "terminal" },
        iat: Date.now() - 1000,
        exp: Date.now() + 60000,
        ...overrides,
      };
      const sig = Buffer.from(
        await crypto.subtle.sign(
          algorithm,
          key.privateKey,
          new TextEncoder().encode(JSON.stringify(payload)),
        ),
      ).toString("base64");
      return Buffer.from(JSON.stringify({ ...payload, sig })).toString("base64");
    }
    const child = spawn(process.execPath, ["bridge/server.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, TERM_DAEMON_ORIGIN: origin, TERM_APP_SOURCE: source, TERM_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
    });
    let stderr = "";
    child.stderr.on("data", (b) => stderr += b);
    const line = await Promise.race([
      once(createInterface({ input: child.stdout }), "line"),
      once(child, "exit").then(() => {
        throw new Error(stderr);
      }),
    ]);
    const endpoint = `http://127.0.0.1:${line[0].match(/:(\d+)$/)[1]}`;
    const valid = await token();
    async function call(path, method = "GET", data, auth = valid) {
      const response = await fetch(endpoint + path, {
        method,
        headers: { "X-Tabserver-Token": auth },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return { status: response.status, ...await response.json() };
    }
    await t.test("rejects missing, expired, foreign, wrong-app, delegated, and tampered tokens", async () => {
      for (
        const auth of [
          "",
          await token({ exp: Date.now() - 1 }),
          await token({ sub: "https://other.example" }),
          await token({ src: "https://other.example/app" }),
          await token({ scope: {} }),
          await token({ pre: [{ sub: "other.example", src: source }] }),
          await token({ iss: `${origin}/issuer/another-app` }),
        ]
      ) {
        assert.equal((await call("/sessions", "POST", { cols: 80, rows: 24 }, auth)).status, 403);
      }
      const forged = JSON.parse(Buffer.from(valid, "base64"));
      forged.exp += 1;
      assert.equal(
        (await call(
          "/sessions",
          "POST",
          { cols: 80, rows: 24 },
          Buffer.from(JSON.stringify(forged)).toString("base64"),
        )).status,
        403,
      );
    });
    let id, cursor = 0, text = "";
    async function readUntil(pattern) {
      for (let i = 0; i < 80; i++) {
        const result = await call(`/sessions/${id}/output?after=${cursor}`);
        assert.equal(result.status, 200);
        cursor = result.ok.next;
        text += Buffer.from(result.ok.data, "base64").toString();
        if (pattern.test(text)) return result.ok;
        await delay(50);
      }
      throw new Error(`Output did not match ${pattern}: ${text}`);
    }
    async function input(data) {
      assert.equal((await call(`/sessions/${id}/input`, "POST", { data })).status, 200);
    }
    await t.test("PTY supports tty, state, Unicode, resize, Ctrl+C, and shell exit", async () => {
      const result = await call("/sessions", "POST", { cols: 80, rows: 24 });
      assert.equal(result.status, 200);
      id = result.ok.id;
      await input("stty -echo; test -t 0 && printf 'PTY_OK\\n'; export TERM_TEST=state; cd /tmp\n");
      await readUntil(/PTY_OK/);
      text = "";
      await input('printf \'%s:%s:héllo\\n\' "$TERM_TEST" "$PWD"\n');
      await readUntil(/state:\/tmp:héllo/);
      assert.equal(
        (await call(`/sessions/${id}/resize`, "POST", { cols: 101, rows: 31 })).status,
        200,
      );
      text = "";
      await input("stty size\n");
      await readUntil(/31 101/);
      text = "";
      await input("sleep 30\n");
      await delay(100);
      await input("\u0003");
      await input("printf 'INTERRUPTED_OK\\n'\n");
      await readUntil(/INTERRUPTED_OK/);
      await input("exit\n");
      for (let i = 0; i < 40; i++) {
        const output = await call(`/sessions/${id}/output?after=${cursor}`);
        if (output.ok.exited) break;
        if (i === 39) assert.fail("Shell did not exit");
        await delay(50);
      }
      assert.equal((await call(`/sessions/${id}`, "DELETE")).status, 200);
      assert.equal((await call(`/sessions/${id}/output`)).status, 404);
    });
    if (process.env.TERM_PLAYWRIGHT_MODULE) {
      await t.test("browser opens shell, types command, resizes, and closes", async () => {
        const { chromium } = await import(process.env.TERM_PLAYWRIGHT_MODULE);
        const { readFile } = await import("node:fs/promises");
        const ui = http.createServer(async (req, res) => {
          try {
            if (req.url.startsWith("/sessions")) {
              const chunks = [];
              for await (const chunk of req) chunks.push(chunk);
              const upstream = await fetch(endpoint + req.url, {
                method: req.method,
                headers: { "X-Tabserver-Token": req.headers["x-tabserver-token"] || "" },
                ...(["POST"].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
              });
              res.writeHead(upstream.status, { "Content-Type": "application/json" });
              res.end(await upstream.text());
              return;
            }
            const path = req.url.split("?")[0];
            const data = await readFile(new URL(".." + path, import.meta.url));
            const type = path.endsWith(".js")
              ? "text/javascript"
              : path.endsWith(".css")
              ? "text/css"
              : path.endsWith(".svg")
              ? "image/svg+xml"
              : "text/html";
            res.setHeader("Content-Type", type);
            res.end(data);
          } catch {
            res.writeHead(404);
            res.end();
          }
        });
        ui.listen(0, "127.0.0.1");
        await once(ui, "listening");
        t.after(() => ui.close());
        const uiOrigin = `http://127.0.0.1:${ui.address().port}`;
        const browser = await chromium.launch({
          headless: true,
          ...(process.env.TERM_BROWSER_CHANNEL
            ? { channel: process.env.TERM_BROWSER_CHANNEL }
            : {}),
        });
        try {
          const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.route("https://webdaemon.online/**/BrowserApp.js", (route) =>
            route.fulfill({
              contentType: "text/javascript",
              body:
                `export const BrowserApp = { getInstance: async () => ({ isOrphan: () => false, getParty: () => 'test.daemon', getAgentUrl: async () => ${
                  JSON.stringify(uiOrigin)
                }, getTokenBase64: () => ${JSON.stringify(valid)} }) };`,
            }));
          await page.goto(uiOrigin + "/term.html");
          await page.getByRole("button", { name: "Open shell", exact: true }).click();
          await page.waitForFunction(() =>
            document.getElementById("status").textContent.includes("Connected")
          );
          await page.locator(".xterm-helper-textarea").pressSequentially("echo BROWSER_OK", {
            delay: 15,
          });
          await page.keyboard.press("Enter");
          await page.waitForFunction(() =>
            [...document.querySelectorAll(".xterm-rows > div")].filter((e) =>
              e.textContent.trim() === "BROWSER_OK"
            ).length > 0
          );
          await page.screenshot({ path: "/tmp/webdaemon-term-desktop.png" });
          await page.setViewportSize({ width: 390, height: 844 });
          await delay(300);
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          await page.screenshot({ path: "/tmp/webdaemon-term-mobile.png" });
          await page.getByRole("button", { name: "Close shell", exact: true }).click();
          await page.waitForFunction(() =>
            document.getElementById("status").textContent === "Shell closed"
          );
          assert.deepEqual(errors, []);
        } finally {
          await browser.close();
          ui.close();
        }
      });
    }
    await t.test("validates sizes and caps shell sessions", async () => {
      assert.equal((await call("/sessions", "POST", { cols: 0, rows: 24 })).status, 400);
      const ids = [];
      for (let i = 0; i < 4; i++) {
        const result = await call("/sessions", "POST", { cols: 80, rows: 24 });
        assert.equal(result.status, 200);
        ids.push(result.ok.id);
      }
      assert.equal((await call("/sessions", "POST", { cols: 80, rows: 24 })).status, 429);
      for (const session of ids) {
        assert.equal(
          (await call(`/sessions/${session}`, "DELETE")).status,
          200,
        );
      }
    });
  },
);
