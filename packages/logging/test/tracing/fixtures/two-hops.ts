// Run by propagation.test.ts in a child process: tracing has to start before
// `node:http` loads, which a vitest worker has already done.
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
import { startTracing, stopTracing } from "../../../src/tracing";

const INBOUND_TRACEPARENT = process.argv[2] ?? "";
const spans: ReadableSpan[] = [];
const exporter: SpanExporter = {
  export(batch, done) {
    spans.push(...batch);
    done({ code: ExportResultCode.SUCCESS });
  },
  shutdown: async () => {},
};
const log = { warn: (msg: string) => process.stderr.write(`${msg}\n`) };

await startTracing({
  env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1" },
  serviceName: "fixture",
  log,
  exporter,
});
const { createServer } = await import("node:http");

const servers: ReturnType<typeof createServer>[] = [];

function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

const apiOrigin = await listen((_request, response) => response.end("{}"));
async function proxyToApi(path: string): Promise<string> {
  const upstream = await fetch(`${apiOrigin}${path}`);
  return upstream.text();
}

const webOrigin = await listen((request, response) => {
  const relayed = proxyToApi(request.url ?? "/");
  void relayed.then((body) => response.end(body));
});

await fetch(`${webOrigin}/api/auth/callback?code=c&state=s`, {
  headers: { traceparent: INBOUND_TRACEPARENT },
});
await fetch(`${webOrigin}/healthz`);
await stopTracing(log);
// Keep-alive sockets would hold the process open for seconds after this.
for (const server of servers) {
  server.closeAllConnections();
  server.close();
}

const reported = spans.map((span) => {
  const { traceId, spanId } = span.spanContext();
  return {
    name: span.name,
    kind: span.kind,
    traceId,
    spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    urlFull: span.attributes["url.full"],
    urlPath: span.attributes["url.path"],
  };
});
process.stdout.write(JSON.stringify(reported));
