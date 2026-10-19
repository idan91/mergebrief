// The production listener: srvx answers the built client files from memory
// and hands every other request to the TanStack server bundle. It owns the
// host check, the error answer and the shutdown drain, the things `vite
// preview` did wrong or not at all.
import {
  Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { serve, type Server, type ServerMiddleware } from "srvx";
import { answerInternalError, answerJson } from "../json-answer";
import {
  IDLE_SWEEP_MS,
  METHOD_NOT_ALLOWED_STATUS,
  UNSERVED_METHODS,
} from "./consts";
import { rejectForeignHost } from "./host-check";
import { serveStaticFiles } from "./static-files";
import {
  DrainOutcomes,
  type DrainOutcome,
  type WebServerOptions,
} from "./types";

function rejectUnservedMethod(): ServerMiddleware {
  return (request, next) => {
    if (UNSERVED_METHODS.has(request.method.toUpperCase())) {
      return answerJson(METHOD_NOT_ALLOWED_STATUS, {
        error: "unsupported method",
      });
    }
    return next();
  };
}

export async function startWebServer(
  options: WebServerOptions,
): Promise<Server> {
  const server = serve({
    hostname: options.hostname,
    port: options.port,
    // The process owns its signals: the drain budget and the exit are ours.
    gracefulShutdown: false,
    silent: true,
    middleware: [
      rejectForeignHost(options.allowedHosts),
      rejectUnservedMethod(),
      serveStaticFiles(options.staticFiles),
    ],
    fetch: (request) => options.fetch(request),
    // Without it a handler's throw is an unhandled rejection, which ends the
    // process and every request in flight with it. The server entry answers
    // its own failures under the request id; this catches what escapes it.
    error: (error) => {
      options.logger.error("web request failed", { err: error });
      return answerInternalError();
    },
  });
  return server.ready();
}

/** srvx's HTTP/1 listener; an HTTP/2 one has no idle keep-alive to sweep. */
function readHttpServer(server: Server): HttpServer | undefined {
  const nodeServer = server.node?.server;
  if (nodeServer instanceof HttpServer) {
    return nodeServer;
  }
  return undefined;
}

function closeAfterResponse(
  _request: IncomingMessage,
  response: ServerResponse,
): void {
  response.shouldKeepAlive = false;
}

/**
 * Stop taking connections and let the ones in flight finish, up to `drainMs`;
 * whatever is still open then is cut. Node's close leaves a keep-alive socket
 * the client keeps busy open, serving requests that arrived after the stop,
 * so every response from here closes its socket and idle ones are swept.
 */
export async function stopWebServer(
  server: Server,
  drainMs: number,
): Promise<DrainOutcome> {
  const httpServer = readHttpServer(server);
  httpServer?.prependListener("request", closeAfterResponse);
  httpServer?.closeIdleConnections();
  const sweep = setInterval(
    () => httpServer?.closeIdleConnections(),
    IDLE_SWEEP_MS,
  );

  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<DrainOutcome>((resolve) => {
    timer = setTimeout(() => resolve(DrainOutcomes.FORCED), drainMs);
  });
  const drained = server.close().then(() => DrainOutcomes.DRAINED);

  const outcome = await Promise.race([drained, budget]);
  clearTimeout(timer);
  clearInterval(sweep);
  if (outcome === DrainOutcomes.FORCED) {
    await server.close(true);
  }
  return outcome;
}

function hasFetchHandler(
  value: unknown,
): value is { fetch: WebServerOptions["fetch"] } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("fetch" in value)) {
    return false;
  }
  return typeof value.fetch === "function";
}

function isServerEntry(
  value: unknown,
): value is { default: { fetch: WebServerOptions["fetch"] } } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("default" in value)) {
    return false;
  }
  return hasFetchHandler(value.default);
}

/** The built server bundle's handler; a bundle without one refuses boot. */
export async function loadServerEntry(
  bundle: URL,
): Promise<WebServerOptions["fetch"]> {
  const loaded: unknown = await import(bundle.href);
  if (!isServerEntry(loaded)) {
    throw new Error(`web boot: ${bundle.pathname} exports no fetch handler`);
  }
  const entry = loaded.default;
  return (request) => entry.fetch(request);
}
