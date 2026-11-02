import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AnthropicError,
  APIConnectionError,
  RetryableError,
} from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { GeneratorError, GeneratorErrorKinds } from "../src/contract/errors";
import { AnthropicGenerator } from "../src/adapters/anthropic";
import type { AnthropicStreamingClient } from "../src/adapters/anthropic";
import {
  ContractSchema,
  contractPayloads,
  describeGeneratorContract,
  type ContractGeneratorHandle,
  type ContractTurn,
  type GeneratorContractHarness,
} from "./contract";

/**
 * The Anthropic adapter's consumption of the shared conformance suite.
 *
 * The fake is a stub SDK CLIENT (not wire-level), a deliberate asymmetry
 * with the API adapters' fetch-level fixtures: these stubs predate the
 * shared pipeline and are the characterization anchor that held while
 * AnthropicGenerator migrated onto it. Promotion trigger to a wire-level
 * fake: a bug escaping through the stubbed surface, or the next substantive
 * SDK-client change (see AGENTS.md).
 */

/** Marker rejection standing in for the SDK's APIUserAbortError. */
const ABORT_ERROR = Object.assign(new Error("Request was aborted."), {
  name: "APIUserAbortError",
});

/** A scripted turn for the stub client, extending the contract's vocabulary. */
type StubTurn =
  | ContractTurn
  | {
      sdkParseRejection: {
        deltas: string[];
        message: string;
        stopReason?: Anthropic.StopReason;
      };
    }
  | { cut: string }
  | { rejectWith: unknown };

interface StubClient {
  client: AnthropicStreamingClient;
  requests: {
    messages: { role: string; content: unknown }[];
    maxTokens: number;
  }[];
  streamOptions: ({ signal?: AbortSignal } | undefined)[];
}

function stubClient(turns: readonly StubTurn[]): StubClient {
  const requests: StubClient["requests"] = [];
  const streamOptions: ({ signal?: AbortSignal } | undefined)[] = [];
  const client = {
    messages: {
      stream(
        body: Parameters<Anthropic["messages"]["stream"]>[0],
        options?: { signal?: AbortSignal },
      ) {
        streamOptions.push(options);
        requests.push({
          messages: body.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          maxTokens: body.max_tokens,
        });
        const turn = turns[requests.length - 1];
        if (!turn) {
          throw new Error("anthropic harness: no scripted turn left");
        }
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
            if ("abort" in turn) {
              throw ABORT_ERROR;
            }
            if ("rejectWith" in turn) {
              throw turn.rejectWith;
            }
            if ("sdkParseRejection" in turn) {
              // Replay the deltas the stream saw before the SDK's eager
              // parse blew up at message_stop, then reject like the SDK.
              for (const text of turn.sdkParseRejection.deltas) {
                const event = {
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "text_delta", text },
                } satisfies Anthropic.RawContentBlockDeltaEvent;
                listener?.(event);
              }
              const stopReason = turn.sdkParseRejection.stopReason;
              if (stopReason !== undefined) {
                listener?.({
                  type: "message_delta",
                  delta: {
                    stop_reason: stopReason,
                    stop_sequence: null,
                    container: null,
                  },
                  usage: { output_tokens: 1 },
                } as Anthropic.RawMessageDeltaEvent);
              }
              throw new AnthropicError(turn.sdkParseRejection.message);
            }
            if ("cut" in turn) {
              return {
                stop_reason: "max_tokens",
                usage: { input_tokens: 1, output_tokens: 1 },
                content: [{ type: "text", text: turn.cut }],
              };
            }
            if ("refusal" in turn) {
              return {
                stop_reason: "refusal",
                usage: { input_tokens: 1, output_tokens: 0 },
                content: [],
              };
            }
            return {
              stop_reason: "end_turn",
              usage: { input_tokens: 1, output_tokens: 1 },
              content: [{ type: "text", text: turn.raw }],
            };
          },
        };
      },
    },
  } satisfies AnthropicStreamingClient;
  return { client, requests, streamOptions };
}

function makeHandle(
  stub: StubClient,
  failureDir: string,
): ContractGeneratorHandle {
  const controller = new AbortController();
  return {
    generator: new AnthropicGenerator(stub.client, failureDir),
    signal: controller.signal,
    attempts: () => stub.requests.length,
    feedbackSeen: () => {
      const retry = stub.requests[1];
      if (!retry) {
        return null;
      }
      // Everything past the base user turn is the feedback surface.
      return retry.messages
        .slice(1)
        .map((message) => String(message.content))
        .join("\n");
    },
  };
}

function makeAnthropicHarness(): GeneratorContractHarness {
  return {
    supportsRefusal: true,
    expectedOrigin: {
      provider: "anthropic",
      model: "claude-opus-5-5",
      effort: "medium",
    },
    isAbortRejection: (error) => error === ABORT_ERROR,
    make: (turns: readonly ContractTurn[], failureDir: string) =>
      makeHandle(stubClient(turns), failureDir),
  };
}

describeGeneratorContract("anthropic", makeAnthropicHarness);

describe("AnthropicGenerator SDK error classification", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anthropic-classify-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function rejectionFor(rejectWith: unknown): Promise<unknown> {
    const stub = stubClient([{ rejectWith }]);
    const generator = new AnthropicGenerator(stub.client, dir);
    return generator
      .generate({
        schema: ContractSchema,
        system: "sys",
        user: "usr",
        effort: "medium",
        label: "classify",
      })
      .then(
        () => {
          throw new Error("expected rejection");
        },
        (error: unknown) => error,
      );
  }

  it.each([
    [401, GeneratorErrorKinds.AUTH],
    [403, GeneratorErrorKinds.AUTH],
    [400, GeneratorErrorKinds.CONFIG],
    [404, GeneratorErrorKinds.CONFIG],
    [429, GeneratorErrorKinds.PROVIDER_TRANSIENT],
    [529, GeneratorErrorKinds.PROVIDER_TRANSIENT],
  ])("maps SDK status %d to kind %s", async (status, kind) => {
    const sdkError = Object.assign(new Error(`http ${status}`), { status });
    const error = await rejectionFor(sdkError);
    expect(error).toBeInstanceOf(GeneratorError);
    expect(error).toMatchObject({ kind, cause: sdkError });
  });

  /** A 429 as the SDK raises it: `error` holds the whole response body. */
  function stubRateLimit429(details?: Record<string, string>): Error {
    const body: Record<string, unknown> = {
      type: "rate_limit_error",
      message: "You have reached your API usage limits.",
    };
    if (details !== undefined) {
      body["details"] = details;
    }
    return Object.assign(new Error("429 rate_limit_error"), {
      status: 429,
      type: "rate_limit_error",
      error: { type: "error", error: body, request_id: "req_test" },
    });
  }

  it("maps a 429 naming the enforced spend limit to provider-spend-limit", async () => {
    const sdkError = stubRateLimit429({
      error_code: "enforced_spend_limit_reached",
    });

    const error = await rejectionFor(sdkError);

    expect(error).toMatchObject({
      kind: GeneratorErrorKinds.PROVIDER_SPEND_LIMIT,
      cause: sdkError,
    });
  });

  it("keeps a rate_limit_error 429 without that code transient", async () => {
    const error = await rejectionFor(stubRateLimit429());

    expect(error).toMatchObject({
      kind: GeneratorErrorKinds.PROVIDER_TRANSIENT,
    });
  });

  it("never decides a spend limit from the error type alone", async () => {
    const sdkError = Object.assign(new Error("429"), {
      status: 429,
      type: "enforced_spend_limit_reached",
    });

    const error = await rejectionFor(sdkError);

    expect(error).toMatchObject({
      kind: GeneratorErrorKinds.PROVIDER_TRANSIENT,
    });
  });

  /** A 400 as the SDK raises it: `error` holds the whole response body. */
  function stubInvalidRequest400(message: string): Error {
    return Object.assign(new Error(`400 ${message}`), {
      status: 400,
      type: "invalid_request_error",
      error: {
        type: "error",
        error: { type: "invalid_request_error", message },
        request_id: "req_test",
      },
    });
  }

  it.each([
    {
      limit: "an organization",
      message:
        "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.",
    },
    {
      limit: "a workspace",
      message:
        "You have reached your specified workspace API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.",
    },
  ])(
    "maps a 400 for $limit spend limit to provider-spend-limit",
    async ({ message }) => {
      const sdkError = stubInvalidRequest400(message);

      const error = await rejectionFor(sdkError);

      expect(error).toMatchObject({
        kind: GeneratorErrorKinds.PROVIDER_SPEND_LIMIT,
        cause: sdkError,
      });
    },
  );

  it("keeps any other invalid_request_error 400 a config failure", async () => {
    const error = await rejectionFor(
      stubInvalidRequest400("max_tokens: must be at most 64000"),
    );

    expect(error).toMatchObject({ kind: GeneratorErrorKinds.CONFIG });
  });

  it("maps a connection-level failure to provider-transient", async () => {
    const connectionError = new APIConnectionError({
      cause: new Error("boom"),
    });
    const error = await rejectionFor(connectionError);
    expect(error).toMatchObject({
      kind: GeneratorErrorKinds.PROVIDER_TRANSIENT,
      cause: connectionError,
    });
  });

  it("maps a statusless RetryableError to provider-transient", async () => {
    const retryable = new RetryableError("middleware retries exhausted");
    const error = await rejectionFor(retryable);
    expect(error).toMatchObject({
      kind: GeneratorErrorKinds.PROVIDER_TRANSIENT,
      cause: retryable,
    });
  });

  it("wraps a statusless non-abort AnthropicError as opaque", async () => {
    const statusless = new AnthropicError("stream ended without a message");
    const error = await rejectionFor(statusless);
    expect(error).toBeInstanceOf(GeneratorError);
    expect(error).toMatchObject({
      kind: GeneratorErrorKinds.OPAQUE,
      cause: statusless,
    });
  });

  it("classifies an unrepresentable schema as config before any attempt", async () => {
    const stub = stubClient([]);
    const generator = new AnthropicGenerator(stub.client, dir);
    const promise = generator.generate({
      // z.unknown() compiles to a type-less JSON schema node, which the
      // strict transform rejects.
      schema: z.unknown(),
      system: "sys",
      user: "usr",
      effort: "medium",
      label: "unrepresentable",
    });
    await expect(promise).rejects.toBeInstanceOf(GeneratorError);
    await expect(promise).rejects.toMatchObject({
      kind: GeneratorErrorKinds.CONFIG,
    });
    expect(stub.requests).toHaveLength(0);
  });

  it("leaves an unrecognized rejection untouched", async () => {
    const weird = { odd: true };
    const error = await rejectionFor(weird);
    expect(error).toBe(weird);
  });
});

describe("AnthropicGenerator SDK eager-parse rejection from SDK 0.101 on", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anthropic-sdkparse-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("converts the stream rejection into a pipeline attempt that can retry", async () => {
    // Non-JSON output (e.g. max_tokens truncation): the SDK's eager
    // JSON.parse rejects finalMessage(); the adapter must hand the
    // delta-accumulated raw to the floor so retry still happens.
    const truncated = contractPayloads.valid.slice(0, 10);
    const stub = stubClient([
      {
        sdkParseRejection: {
          deltas: [truncated],
          message: "Failed to parse structured output: SyntaxError",
        },
      },
      { raw: contractPayloads.valid },
    ]);
    const generator = new AnthropicGenerator(stub.client, dir);
    await expect(
      generator.generate({
        schema: ContractSchema,
        system: "sys",
        user: "usr",
        effort: "medium",
        label: "truncated",
      }),
    ).resolves.toEqual(contractPayloads.validParsed);
    expect(stub.requests).toHaveLength(2);
    // The retry's feedback echoes the truncated raw the deltas carried.
    const retryMessages = stub.requests[1]?.messages ?? [];
    expect(String(retryMessages[1]?.content)).toBe(truncated);
  });
});

describe("AnthropicGenerator request shape", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anthropic-request-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("caps the output at 64000 tokens by default", async () => {
    const stub = stubClient([{ raw: contractPayloads.valid }]);
    const generator = new AnthropicGenerator(stub.client, dir);

    await generator.generate({
      schema: ContractSchema,
      system: "sys",
      user: "usr",
      effort: "medium",
      label: "default-cap",
    });

    expect(stub.requests[0]?.maxTokens).toBe(64000);
  });

  it("sends the request's own output cap", async () => {
    const stub = stubClient([{ raw: contractPayloads.valid }]);
    const generator = new AnthropicGenerator(stub.client, dir);

    await generator.generate({
      schema: ContractSchema,
      system: "sys",
      user: "usr",
      effort: "medium",
      label: "grouping-cap",
      maxOutputTokens: 128000,
    });

    expect(stub.requests[0]?.maxTokens).toBe(128000);
  });

  it.each([
    ["claude-haiku-4-5", 64000],
    ["claude-sonnet-4-5-20250929", 64000],
    ["an-unknown-model", 64000],
    ["claude-sonnet-5-5", 128000],
    ["us.anthropic.claude-opus-4-8", 128000],
  ])("caps a 128000 request at %s's ceiling", async (model, sent) => {
    const stub = stubClient([{ raw: contractPayloads.valid }]);
    const generator = new AnthropicGenerator(stub.client, dir, model);

    await generator.generate({
      schema: ContractSchema,
      system: "sys",
      user: "usr",
      effort: "medium",
      label: "grouping-cap",
      maxOutputTokens: 128000,
    });

    expect(stub.requests[0]?.maxTokens).toBe(sent);
  });

  it("threads the request signal into the SDK stream options", async () => {
    const stub = stubClient([{ raw: contractPayloads.valid }]);
    const controller = new AbortController();
    const generator = new AnthropicGenerator(stub.client, dir);
    await generator.generate({
      schema: ContractSchema,
      system: "sys",
      user: "usr",
      effort: "medium",
      label: "signal",
      signal: controller.signal,
    });
    expect(stub.streamOptions[0]?.signal).toBe(controller.signal);
  });

  it("replays the failed output as the assistant turn on retry", async () => {
    const stub = stubClient([
      { raw: contractPayloads.invalid },
      { raw: contractPayloads.valid },
    ]);
    const generator = new AnthropicGenerator(stub.client, dir);
    await generator.generate({
      schema: ContractSchema,
      system: "sys",
      user: "usr",
      effort: "medium",
      label: "retry",
    });
    expect(stub.requests[1]?.messages[1]).toEqual({
      role: "assistant",
      content: contractPayloads.invalid,
    });
  });
});

describe("AnthropicGenerator output cut", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anthropic-cut-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function generateFrom(turns: readonly StubTurn[]) {
    const stub = stubClient(turns);
    const generator = new AnthropicGenerator(stub.client, dir);
    const run = generator.generate({
      schema: ContractSchema,
      system: "sys",
      user: "usr",
      effort: "medium",
      label: "cut",
    });
    return { stub, run };
  }

  it("fails a max_tokens stop as output-cut without a retry", async () => {
    const { stub, run } = generateFrom([
      { cut: contractPayloads.valid.slice(0, 10) },
      { raw: contractPayloads.valid },
    ]);

    await expect(run).rejects.toMatchObject({
      kind: GeneratorErrorKinds.OUTPUT_CUT,
    });
    expect(stub.requests).toHaveLength(1);
  });

  it("fails an SDK parse rejection after a max_tokens stop as output-cut", async () => {
    const { stub, run } = generateFrom([
      {
        sdkParseRejection: {
          deltas: [contractPayloads.valid.slice(0, 10)],
          message: "Failed to parse structured output: SyntaxError",
          stopReason: "max_tokens",
        },
      },
      { raw: contractPayloads.valid },
    ]);

    await expect(run).rejects.toMatchObject({
      kind: GeneratorErrorKinds.OUTPUT_CUT,
    });
    expect(stub.requests).toHaveLength(1);
  });
});

describe("AnthropicGenerator user prefix", () => {
  it("sends the shared prefix as a cached first block before the user text", async () => {
    const stub = stubClient([{ raw: contractPayloads.valid }]);
    const dirPrefix = join(tmpdir(), "anthropic-prefix-");
    const dir = mkdtempSync(dirPrefix);
    try {
      const generator = new AnthropicGenerator(stub.client, dir);

      await generator.generate({
        schema: ContractSchema,
        system: "sys",
        user: "usr",
        userPrefix: "shared",
        effort: "medium",
        label: "contract",
      });

      expect(stub.requests[0]?.messages).toEqual([
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "shared",
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: "usr" },
          ],
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends the user text as a plain string without a prefix", async () => {
    const stub = stubClient([{ raw: contractPayloads.valid }]);
    const dirPrefix = join(tmpdir(), "anthropic-prefix-");
    const dir = mkdtempSync(dirPrefix);
    try {
      const generator = new AnthropicGenerator(stub.client, dir);

      await generator.generate({
        schema: ContractSchema,
        system: "sys",
        user: "usr",
        effort: "medium",
        label: "contract",
      });

      expect(stub.requests[0]?.messages).toEqual([
        { role: "user", content: "usr" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
