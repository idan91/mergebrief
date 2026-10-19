// The real listener on an ephemeral port: what a browser and the compose
// healthcheck see, and what a stop does to a request still in flight.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { Agent, request as sendHttpRequest } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "srvx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startWebServer, stopWebServer } from ".";
import { indexStaticFiles } from "./static-files";
import { DrainOutcomes, type WebServerOptions } from "./types";

interface Reply {
  readonly status: number;
  readonly body: string;
}

/** Well under Node's 5s keep-alive timeout, which an open socket would wait out. */
const DRAIN_WITHOUT_KEEP_ALIVE_MS = 2000;
/** Long enough for a sent request to reach the held handler. */
const REQUEST_ARRIVAL_MS = 50;
const DRAIN_BUDGET_MS = 5000;
const SHORT_DRAIN_BUDGET_MS = 100;

let server: Server | undefined;

afterEach(async () => {
  await server?.close(true);
  server = undefined;
});

function makeClientDir(): string {
  const prefix = join(tmpdir(), "web-serve-");
  const dir = mkdtempSync(prefix);
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log(1)");
  return dir;
}

async function startServer(
  overrides: Partial<WebServerOptions> = {},
): Promise<number> {
  const staticFiles = await indexStaticFiles(makeClientDir());
  server = await startWebServer({
    hostname: "127.0.0.1",
    port: 0,
    allowedHosts: new Set(["localhost", "brief.example.com"]),
    staticFiles,
    logger: { error: vi.fn() },
    fetch: () => new Response("rendered by the server entry"),
    ...overrides,
  });
  const { port } = new URL(server.url ?? "");
  return Number(port);
}

function waitForRequestArrival(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, REQUEST_ARRIVAL_MS));
}

function readRunningServer(): Server {
  if (server === undefined) {
    throw new Error("server not started");
  }
  return server;
}

/** A raw request, so the test controls the Host header fetch would set. */
function sendRequest(
  port: number,
  path: string,
  host: string,
  method = "GET",
  agent?: Agent,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = sendHttpRequest(
      { host: "127.0.0.1", port, path, method, headers: { host }, agent },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString();
          resolve({ status: response.statusCode ?? 0, body });
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

describe("startWebServer", () => {
  it("serves a built client file without reaching the server entry", async () => {
    const port = await startServer({
      fetch: () => new Response("wrong", { status: 500 }),
    });

    const reply = await sendRequest(port, "/assets/app-abc123.js", "localhost");

    expect(reply).toEqual({ status: 200, body: "console.log(1)" });
  });

  it("hands every other path to the server entry", async () => {
    const port = await startServer();

    const reply = await sendRequest(
      port,
      "/repos/1/pulls/2",
      "brief.example.com",
    );

    expect(reply).toEqual({
      status: 200,
      body: "rendered by the server entry",
    });
  });

  it("refuses a host outside the allow-list before anything runs", async () => {
    let reached = false;
    const port = await startServer({
      fetch: () => {
        reached = true;
        return new Response("rendered");
      },
    });

    const reply = await sendRequest(port, "/", "evil.example.net");

    expect(reply.status).toBe(403);
    expect(reached).toBe(false);
  });

  it("answers the healthcheck's bare IP host", async () => {
    const port = await startServer();

    const reply = await sendRequest(port, "/healthz", `127.0.0.1:${port}`);

    expect(reply.status).toBe(200);
  });
});

describe("startWebServer error answers", () => {
  it("answers a handler's throw with a 500 and keeps listening", async () => {
    const logger = { error: vi.fn() };
    const port = await startServer({
      logger,
      fetch: () => {
        throw new Error("render blew up");
      },
    });

    const failed = await sendRequest(port, "/", "localhost");
    const healthy = await sendRequest(
      port,
      "/assets/app-abc123.js",
      "localhost",
    );

    expect(failed).toEqual({
      status: 500,
      body: '{"error":"internal error"}',
    });
    expect(healthy.status).toBe(200);
    const failureFields = { err: expect.any(Error) };
    expect(logger.error).toHaveBeenCalledWith(
      "web request failed",
      expect.objectContaining(failureFields),
    );
  });

  it("refuses a TRACE before the server entry can throw on it", async () => {
    const port = await startServer();

    const reply = await sendRequest(port, "/", "localhost", "TRACE");

    expect(reply.status).toBe(405);
  });
});

describe("stopWebServer", () => {
  it("lets a request in flight finish before the server stops", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const port = await startServer({
      fetch: async () => {
        await held;
        return new Response("submitted");
      },
    });
    const inFlight = sendRequest(port, "/api/review", "localhost");
    await waitForRequestArrival();
    const running = readRunningServer();

    const stopping = stopWebServer(running, DRAIN_BUDGET_MS);
    release();

    expect(await inFlight).toEqual({ status: 200, body: "submitted" });
    expect(await stopping).toBe(DrainOutcomes.DRAINED);
    // A reused keep-alive socket sees the close as a reset or a hang-up, a
    // new one as a refusal: either way the stopped server answers nothing.
    const afterStop = sendRequest(port, "/", "localhost");
    await expect(afterStop).rejects.toThrow(
      /ECONNREFUSED|ECONNRESET|socket hang up/,
    );
  });

  it("closes a busy keep-alive socket instead of waiting it out", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const port = await startServer({
      fetch: async () => {
        await held;
        return new Response("submitted");
      },
    });
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const inFlight = sendRequest(
      port,
      "/api/review",
      "localhost",
      "GET",
      agent,
    );
    await waitForRequestArrival();
    const running = readRunningServer();

    const startedAt = Date.now();
    const stopping = stopWebServer(running, DRAIN_BUDGET_MS);
    release();

    expect(await inFlight).toEqual({ status: 200, body: "submitted" });
    expect(await stopping).toBe(DrainOutcomes.DRAINED);
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(DRAIN_WITHOUT_KEEP_ALIVE_MS);
    agent.destroy();
  });

  it("closes the socket after a response written mid-drain", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const port = await startServer({
      fetch: async () => {
        await held;
        return new Response("submitted");
      },
    });
    // A kept-alive socket whose next request arrives after the stop began:
    // the static file is answered synchronously inside srvx's own handler.
    const socket = connect(port, "127.0.0.1");
    const received: Buffer[] = [];
    let sentSecond = false;
    socket.on("data", (chunk: Buffer) => {
      received.push(chunk);
      const answered = Buffer.concat(received).includes("submitted");
      if (!sentSecond && answered) {
        sentSecond = true;
        socket.write(
          "GET /assets/app-abc123.js HTTP/1.1\r\nHost: localhost\r\n\r\n",
        );
      }
    });
    const closed = new Promise<void>((resolve) => socket.on("close", resolve));
    socket.write("GET /api/review HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await waitForRequestArrival();
    const running = readRunningServer();

    const stopping = stopWebServer(running, DRAIN_BUDGET_MS);
    release();
    await closed;

    const transcript = Buffer.concat(received).toString();
    const replies = transcript.split("HTTP/1.1 ");
    expect(replies.at(-1)).toMatch(/^200[\s\S]*connection: close/i);
    expect(await stopping).toBe(DrainOutcomes.DRAINED);
  });

  it("cuts what is still open once the budget runs out", async () => {
    const port = await startServer({
      fetch: () => new Promise<Response>(() => undefined),
    });
    const inFlight = sendRequest(port, "/api/review", "localhost");
    await waitForRequestArrival();
    const running = readRunningServer();

    const outcome = await stopWebServer(running, SHORT_DRAIN_BUDGET_MS);

    expect(outcome).toBe(DrainOutcomes.FORCED);
    await expect(inFlight).rejects.toThrow(/socket hang up|ECONNRESET/);
  });
});
