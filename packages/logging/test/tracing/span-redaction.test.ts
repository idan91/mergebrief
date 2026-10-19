import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { describe, expect, it } from "vitest";
import { createSpanRedactor } from "../../src/tracing/span-redaction";

describe("createSpanRedactor", () => {
  it("rewrites URL attributes before any exporter sees them", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new TracerProvider({
      spanProcessors: [
        createSpanRedactor(),
        new SimpleSpanProcessor({ exporter }),
      ],
    });
    const span = provider.getTracer("test").startSpan("GET", {
      attributes: {
        "url.full": "http://web/api/auth/callback?code=c&state=s",
        "url.query": "code=c&state=s",
        "http.target": "/api/auth/callback?code=c",
        "url.path": "/api/auth/callback",
      },
    });
    span.end();
    await provider.forceFlush();

    const [exported] = exporter.getFinishedSpans();
    expect(exported?.attributes).toEqual({
      "url.full": "http://web/api/auth/callback",
      "url.query": "[redacted]",
      "http.target": "/api/auth/callback",
      "url.path": "/api/auth/callback",
    });
    await provider.shutdown();
  });

  it("leaves an empty query attribute empty", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new TracerProvider({
      spanProcessors: [
        createSpanRedactor(),
        new SimpleSpanProcessor({ exporter }),
      ],
    });
    const tracer = provider.getTracer("test");
    tracer.startSpan("GET", { attributes: { "url.query": "" } }).end();
    await provider.forceFlush();

    expect(exporter.getFinishedSpans()[0]?.attributes["url.query"]).toBe("");
    await provider.shutdown();
  });

  it("redacts the user agent and the client's address", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new TracerProvider({
      spanProcessors: [
        createSpanRedactor(),
        new SimpleSpanProcessor({ exporter }),
      ],
    });
    const tracer = provider.getTracer("test");
    const span = tracer.startSpan("GET", {
      attributes: {
        "user_agent.original": "Mozilla/5.0",
        "client.address": "203.0.113.9",
        "network.peer.address": "203.0.113.9",
        "server.address": "brief.example.com",
      },
    });
    span.end();
    await provider.forceFlush();

    expect(exporter.getFinishedSpans()[0]?.attributes).toEqual({
      "user_agent.original": "[redacted]",
      "client.address": "[redacted]",
      "network.peer.address": "[redacted]",
      "server.address": "brief.example.com",
    });
    await provider.shutdown();
  });
});
