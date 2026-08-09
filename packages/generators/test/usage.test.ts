import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnthropicError } from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { AnthropicGenerator } from "../src/adapters/anthropic";
import type { AnthropicStreamingClient } from "../src/adapters/anthropic";
import { createOpenAiCore } from "../src/adapters/openai";
import { createOpenRouterCore } from "../src/adapters/openrouter";
import type { TokenUsage } from "../src/contract/generator";

/**
 * onUsage reporting: adapters with provider-reported usage
 * invoke the optional callback once per underlying request (retries
 * included — callers sum). CLI adapters never call it; the OpenAI-compatible
 * core asks the wire for usage ONLY when a callback is present, so existing
 * callers see zero wire change.
 */

const Schema = z.object({ ok: z.boolean() });

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "usage-test-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Anthropic: usage is on every final response — no wire change at all.
// ---------------------------------------------------------------------------

interface AnthropicWireUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
}

type AnthropicUsageTurn =
  | { raw: string; usage: AnthropicWireUsage }
  | {
      /** SDK eager-parse rejection AFTER a complete stream: replay
       * message_start/message_delta usage events, then reject. */
      sdkParseRejection: { streamUsage: AnthropicWireUsage };
    };

function messageStartEvent(
  usage: AnthropicWireUsage,
): Anthropic.MessageStreamEvent {
  return {
    type: "message_start",
    message: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-opus-4-8",
      stop_reason: null,
      stop_sequence: null,
      container: null,
      stop_details: null,
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: 0,
        output_tokens_details: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
        cache_creation: null,
        server_tool_use: null,
        service_tier: null,
        inference_geo: null,
      },
    },
  };
}

function messageDeltaEvent(outputTokens: number): Anthropic.MessageStreamEvent {
  return {
    type: "message_delta",
    delta: {
      stop_reason: null,
      stop_sequence: null,
      container: null,
      stop_details: null,
    },
    usage: {
      output_tokens: outputTokens,
      output_tokens_details: null,
      input_tokens: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
    },
  };
}

function usageStubClient(
  turns: readonly AnthropicUsageTurn[],
): AnthropicStreamingClient {
  let calls = 0;
  return {
    messages: {
      stream(_body: Parameters<Anthropic["messages"]["stream"]>[0]) {
        const turn = turns[calls];
        calls += 1;
        if (!turn) throw new Error("usage stub: no scripted turn left");
        let listener: ((event: Anthropic.MessageStreamEvent) => void) | null =
          null;
        return {
          on(
            _event: "streamEvent",
            handler: (event: Anthropic.MessageStreamEvent) => void,
          ) {
            listener = handler;
            return this;
          },
          async finalMessage() {
            if ("sdkParseRejection" in turn) {
              const usage = turn.sdkParseRejection.streamUsage;
              listener?.(messageStartEvent(usage));
              listener?.({
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: '{"ok":tru' },
              });
              listener?.(messageDeltaEvent(usage.output_tokens));
              throw new AnthropicError(
                "Failed to parse structured output: truncated",
              );
            }
            return {
              stop_reason: "end_turn",
              usage: turn.usage,
              content: [{ type: "text", text: turn.raw }],
            };
          },
        };
      },
    },
  } satisfies AnthropicStreamingClient;
}

describe("anthropic usage reporting", () => {
  it("reports mapped usage once on a clean generation", async () => {
    const seen: TokenUsage[] = [];
    const generator = new AnthropicGenerator(
      usageStubClient([
        {
          raw: '{"ok":true}',
          usage: {
            input_tokens: 1200,
            output_tokens: 340,
            cache_read_input_tokens: 900,
          },
        },
      ]),
      tempDir(),
    );
    await generator.generate({
      schema: Schema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "usage-clean",
      onUsage: (usage) => seen.push(usage),
    });
    expect(seen).toEqual([
      { inputTokens: 1200, outputTokens: 340, cacheReadTokens: 900 },
    ]);
  });

  it("defaults absent cache_read to 0", async () => {
    const seen: TokenUsage[] = [];
    const generator = new AnthropicGenerator(
      usageStubClient([
        { raw: '{"ok":true}', usage: { input_tokens: 10, output_tokens: 5 } },
      ]),
      tempDir(),
    );
    await generator.generate({
      schema: Schema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "usage-nocache",
      onUsage: (usage) => seen.push(usage),
    });
    expect(seen).toEqual([
      { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 },
    ]);
  });

  it("reports once per attempt across a feedback retry — callers sum", async () => {
    const seen: TokenUsage[] = [];
    const generator = new AnthropicGenerator(
      usageStubClient([
        { raw: "not json", usage: { input_tokens: 100, output_tokens: 7 } },
        { raw: '{"ok":true}', usage: { input_tokens: 150, output_tokens: 9 } },
      ]),
      tempDir(),
    );
    await generator.generate({
      schema: Schema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "usage-retry",
      onUsage: (usage) => seen.push(usage),
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]?.inputTokens).toBe(100);
    expect(seen[1]?.inputTokens).toBe(150);
  });

  it("reports stream-event usage when the SDK's eager parse rejects the attempt", async () => {
    const seen: TokenUsage[] = [];
    const generator = new AnthropicGenerator(
      usageStubClient([
        {
          sdkParseRejection: {
            streamUsage: {
              input_tokens: 2000,
              output_tokens: 31999,
              cache_read_input_tokens: 1500,
            },
          },
        },
        {
          raw: '{"ok":true}',
          usage: { input_tokens: 2000, output_tokens: 20 },
        },
      ]),
      tempDir(),
    );
    await generator.generate({
      schema: Schema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "usage-parse-reject",
      onUsage: (usage) => seen.push(usage),
    });
    // The pathological attempt (e.g. max_tokens truncation) is the expensive
    // one — its usage must not vanish from the sum.
    expect(seen).toEqual([
      { inputTokens: 2000, outputTokens: 31999, cacheReadTokens: 1500 },
      { inputTokens: 2000, outputTokens: 20, cacheReadTokens: 0 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// OpenAI-compatible core: usage exists on the wire only when requested via
// stream_options.include_usage — sent iff the caller passed onUsage.
// ---------------------------------------------------------------------------

function sse(content: string, usage?: unknown, model?: string): Response {
  const stamp = model !== undefined ? { model } : {};
  const events = [
    `data: ${JSON.stringify({ ...stamp, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ ...stamp, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
    ...(usage !== undefined
      ? [`data: ${JSON.stringify({ ...stamp, choices: [], usage })}\n\n`]
      : []),
    "data: [DONE]\n\n",
  ].join("");
  return new Response(events, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: { message, type: "invalid_request_error" } }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function openAiGenerator(
  bodies: unknown[],
  respond: (call: number) => Response,
) {
  const result = await createOpenAiCore({
    apiKey: "k",
    model: "m",
    failureDir: tempDir(),
    provider: "openai",
    fetch: async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/models/")) {
        return new Response(JSON.stringify({ id: "m" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (typeof init?.body === "string") {
        const parsed: unknown = JSON.parse(init.body);
        bodies.push(parsed);
      }
      return respond(bodies.length);
    },
  });
  if (!result.ok) throw new Error(result.error.issues.join("; "));
  return result.value;
}

describe("openai-core usage reporting", () => {
  it("does not request usage when no callback is given", async () => {
    const bodies: unknown[] = [];
    const generator = await openAiGenerator(bodies, () => sse('{"ok":true}'));
    await generator.generate({
      schema: Schema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "no-usage",
    });
    expect(bodies).toHaveLength(1);
    const body = bodies[0];
    if (!isRecord(body)) throw new Error("expected an object body");
    expect(body["stream_options"]).toBeUndefined();
  });

  it("requests usage and reports the final chunk's counts when onUsage is set", async () => {
    const bodies: unknown[] = [];
    const seen: TokenUsage[] = [];
    const generator = await openAiGenerator(bodies, () =>
      sse('{"ok":true}', {
        prompt_tokens: 800,
        completion_tokens: 120,
        prompt_tokens_details: { cached_tokens: 600 },
      }),
    );
    await generator.generate({
      schema: Schema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "with-usage",
      onUsage: (usage) => seen.push(usage),
    });
    const body = bodies[0];
    if (!isRecord(body)) throw new Error("expected an object body");
    expect(body["stream_options"]).toEqual({ include_usage: true });
    expect(seen).toEqual([
      { inputTokens: 800, outputTokens: 120, cacheReadTokens: 600 },
    ]);
  });

  it("stays silent when the provider reports no usage despite the request", async () => {
    const bodies: unknown[] = [];
    const seen: TokenUsage[] = [];
    const generator = await openAiGenerator(bodies, () => sse('{"ok":true}'));
    await generator.generate({
      schema: Schema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "usage-missing",
      onUsage: (usage) => seen.push(usage),
    });
    expect(seen).toEqual([]);
  });

  it("ignores malformed usage from a compatible server instead of reporting NaN", async () => {
    const bodies: unknown[] = [];
    const seen: TokenUsage[] = [];
    const generator = await openAiGenerator(bodies, () =>
      // A self-hosted "compatible" server emitting a usage object without
      // numeric counts — the declared chunk shape is wire data, not truth.
      sse('{"ok":true}', { prompt_tokens: "800", completion_tokens: null }),
    );
    await generator.generate({
      schema: Schema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "usage-malformed",
      onUsage: (usage) => seen.push(usage),
    });
    expect(seen).toEqual([]);
  });

  it("reports reasoningTokens from completion_tokens_details when present", async () => {
    const bodies: unknown[] = [];
    const seen: TokenUsage[] = [];
    const generator = await openAiGenerator(bodies, () =>
      sse('{"ok":true}', {
        prompt_tokens: 800,
        completion_tokens: 120,
        completion_tokens_details: { reasoning_tokens: 64 },
      }),
    );
    await generator.generate({
      schema: Schema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "usage-reasoning",
      onUsage: (usage) => seen.push(usage),
    });
    expect(seen).toEqual([
      {
        inputTokens: 800,
        outputTokens: 120,
        cacheReadTokens: 0,
        reasoningTokens: 64,
      },
    ]);
  });

  it("omits reasoningTokens when unreported or malformed — 0 must stay distinguishable from unreported", async () => {
    const bodies: unknown[] = [];
    const seen: TokenUsage[] = [];
    const generator = await openAiGenerator(bodies, (call) =>
      call === 1
        ? sse('{"ok":tru', { prompt_tokens: 10, completion_tokens: 2 })
        : sse('{"ok":true}', {
            prompt_tokens: 10,
            completion_tokens: 2,
            completion_tokens_details: { reasoning_tokens: "64" },
          }),
    );
    await generator.generate({
      schema: Schema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "usage-reasoning-absent",
      onUsage: (usage) => seen.push(usage),
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toHaveProperty("reasoningTokens");
    expect(seen[1]).not.toHaveProperty("reasoningTokens");
  });

  it("keeps requesting usage on the knob-discovery retry", async () => {
    const bodies: unknown[] = [];
    const seen: TokenUsage[] = [];
    const generator = await openAiGenerator(bodies, (call) =>
      call === 1
        ? jsonError(400, "Unsupported parameter: 'reasoning_effort'.")
        : sse('{"ok":true}', { prompt_tokens: 50, completion_tokens: 5 }),
    );
    await generator.generate({
      schema: Schema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "usage-knob-retry",
      onUsage: (usage) => seen.push(usage),
    });
    expect(bodies).toHaveLength(2);
    const retry = bodies[1];
    if (!isRecord(retry)) throw new Error("expected an object body");
    expect(retry["reasoning_effort"]).toBeUndefined();
    expect(retry["stream_options"]).toEqual({ include_usage: true });
    // The 400'd first request streamed nothing → exactly one report.
    expect(seen).toEqual([
      { inputTokens: 50, outputTokens: 5, cacheReadTokens: 0 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// OpenRouter assembly: stream_options must survive the wire-body translation.
// ---------------------------------------------------------------------------

const SLUG = "test/model";

describe("openrouter usage passthrough", () => {
  it("forwards stream_options and reports the usage chunk through the transport", async () => {
    const bodies: Record<string, unknown>[] = [];
    const seen: TokenUsage[] = [];
    const result = await createOpenRouterCore({
      apiKey: "test-key",
      model: SLUG,
      failureDir: tempDir(),
      fetch: async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.endsWith("/models")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: SLUG,
                  supported_parameters: ["structured_outputs", "reasoning"],
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (typeof init?.body === "string") {
          const parsed: unknown = JSON.parse(init.body);
          if (isRecord(parsed)) bodies.push(parsed);
        }
        return sse(
          '{"ok":true}',
          { prompt_tokens: 70, completion_tokens: 9 },
          SLUG,
        );
      },
    });
    if (!result.ok) throw new Error(result.error.issues.join("; "));
    await result.value.generate({
      schema: Schema,
      system: "s",
      user: "u",
      effort: "medium",
      label: "openrouter-usage",
      onUsage: (usage) => seen.push(usage),
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.["stream_options"]).toEqual({ include_usage: true });
    expect(seen).toEqual([
      { inputTokens: 70, outputTokens: 9, cacheReadTokens: 0 },
    ]);
  });
});
