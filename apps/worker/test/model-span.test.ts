import type { Effort, GenerateRequest, Generator } from "generators";
import { startTestTracing, type TestTracing } from "logging/testing";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { traceProviderCalls } from "../src/task/generate/logic/model-span";

const USAGE = { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800 };

let tracing: TestTracing | undefined;

afterEach(async () => {
  await tracing?.stop();
  tracing = undefined;
});

function stubReportingGenerator(
  failWith?: Error,
  provider = "anthropic",
): Generator {
  return {
    generate: async <S extends z.ZodType>(req: GenerateRequest<S>) => {
      req.onUsage?.(USAGE);
      req.onUsage?.(USAGE);
      if (failWith !== undefined) {
        throw failWith;
      }
      return req.schema.parse({ summary: "ok" });
    },
    origin: (effort: Effort) => ({
      provider,
      model: "claude-test",
      effort,
    }),
  };
}

function makeRequest(): GenerateRequest<z.ZodType<{ summary: string }>> {
  return {
    schema: z.object({ summary: z.string() }),
    system: "system prompt",
    user: "user prompt",
    effort: "high",
    label: "brief",
  };
}

describe("traceProviderCalls", () => {
  it("opens a GenAI span with the origin and the summed usage", async () => {
    tracing = startTestTracing();
    const generator = traceProviderCalls(stubReportingGenerator());

    await generator.generate(makeRequest());

    const [call] = tracing.readFinishedSpans();
    expect(call?.name).toBe("chat claude-test");
    expect(call?.attributes).toMatchObject({
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "anthropic",
      "gen_ai.request.model": "claude-test",
      "mergebrief.generation.kind": "brief",
      "mergebrief.generation.effort": "high",
      "gen_ai.usage.input_tokens": 4000,
      "gen_ai.usage.output_tokens": 600,
      "gen_ai.usage.cache_read.input_tokens": 1600,
      "mergebrief.provider_requests": 2,
    });
    const recorded = JSON.stringify(call);
    expect(recorded).not.toContain("user prompt");
    expect(recorded).not.toContain("system prompt");
  });

  it("keeps the usage and marks the span failed when the call throws", async () => {
    tracing = startTestTracing();
    const failing = stubReportingGenerator(new Error("rate limited"));
    const generator = traceProviderCalls(failing);

    const call = generator.generate(makeRequest());

    await expect(call).rejects.toThrow("rate limited");
    const [span] = tracing.readFinishedSpans();
    expect(span?.failed).toBe(true);
    expect(span?.attributes["gen_ai.usage.input_tokens"]).toBe(4000);
  });

  it("counts Anthropic cache writes in the input total on a cold cache", async () => {
    tracing = startTestTracing();
    const cold: Generator = {
      generate: async <S extends z.ZodType>(req: GenerateRequest<S>) => {
        req.onUsage?.({
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 90,
        });
        return req.schema.parse({ summary: "ok" });
      },
      origin: (effort: Effort) => ({
        provider: "anthropic",
        model: "claude-test",
        effort,
      }),
    };

    await traceProviderCalls(cold).generate(makeRequest());

    const [call] = tracing.readFinishedSpans();
    expect(call?.attributes["gen_ai.usage.input_tokens"]).toBe(100);
  });

  it("adds cache reads to a claude-code input total", async () => {
    tracing = startTestTracing();
    const claudeCode = stubReportingGenerator(undefined, "claude-code");

    await traceProviderCalls(claudeCode).generate(makeRequest());

    const [call] = tracing.readFinishedSpans();
    expect(call?.attributes["gen_ai.usage.input_tokens"]).toBe(4000);
  });

  it("keeps an OpenAI-compatible input total, cache reads already inside", async () => {
    tracing = startTestTracing();
    const openai = stubReportingGenerator(undefined, "openai");

    await traceProviderCalls(openai).generate(makeRequest());

    const [call] = tracing.readFinishedSpans();
    expect(call?.attributes["gen_ai.usage.input_tokens"]).toBe(2400);
  });

  it("leaves the call unfailed when the run aborts it", async () => {
    tracing = startTestTracing();
    const stop = new AbortController();
    stop.abort();
    const aborted = new Error("aborted");
    const generator = traceProviderCalls(
      stubReportingGenerator(aborted),
      stop.signal,
    );

    const call = generator.generate(makeRequest());

    await expect(call).rejects.toBe(aborted);
    const [span] = tracing.readFinishedSpans();
    expect(span?.failed).toBe(false);
  });

  it("records the effort the provider served once the call settles", async () => {
    tracing = startTestTracing();
    let effortSupported = true;
    const inner = stubReportingGenerator();
    const refusesEffort: Generator = {
      generate: async (req) => {
        effortSupported = false;
        return inner.generate(req);
      },
      origin: (effort) => ({
        provider: "openai",
        model: "gpt-test",
        effort: effortSupported ? effort : null,
      }),
    };

    await traceProviderCalls(refusesEffort).generate(makeRequest());

    const [call] = tracing.readFinishedSpans();
    expect(call?.attributes["mergebrief.generation.effort"]).toBe("none");
  });

  it("adds no usage listener with tracing off", async () => {
    let listened: boolean | undefined;
    const inner = stubReportingGenerator();
    const probe: Generator = {
      generate: (req) => {
        listened = req.onUsage !== undefined;
        return inner.generate(req);
      },
      origin: (effort) => inner.origin(effort),
    };

    await traceProviderCalls(probe).generate(makeRequest());

    expect(listened).toBe(false);
  });

  it("still hands each usage report to the caller's own listener", async () => {
    tracing = startTestTracing();
    const seen: number[] = [];
    const generator = traceProviderCalls(stubReportingGenerator());
    const request = makeRequest();
    request.onUsage = (usage) => {
      seen.push(usage.inputTokens);
    };

    await generator.generate(request);

    expect(seen).toEqual([1200, 1200]);
  });
});
