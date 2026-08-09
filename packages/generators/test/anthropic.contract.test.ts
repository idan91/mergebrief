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
import { GeneratorError, GeneratorErrorKind } from "../src/contract/errors";
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
 * The fake is a stub SDK CLIENT (not wire-level) — a deliberate asymmetry
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
  | { sdkParseRejection: { deltas: string[]; message: string } }
  | { rejectWith: unknown };

interface StubClient {
  client: AnthropicStreamingClient;
  requests: { messages: { role: string; content: unknown }[] }[];
}

function stubClient(turns: readonly StubTurn[]): StubClient {
  const requests: { messages: { role: string; content: unknown }[] }[] = [];
  const client = {
    messages: {
      stream(body: Parameters<Anthropic["messages"]["stream"]>[0]) {
        requests.push({
          messages: body.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        });
        const turn = turns[requests.length - 1];
        if (!turn) throw new Error("anthropic harness: no scripted turn left");
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
            if ("abort" in turn) throw ABORT_ERROR;
            if ("rejectWith" in turn) throw turn.rejectWith;
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
              throw new AnthropicError(turn.sdkParseRejection.message);
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
  return { client, requests };
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
      if (!retry) return null;
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
      model: "claude-opus-4-8",
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
    [401, GeneratorErrorKind.AUTH],
    [403, GeneratorErrorKind.AUTH],
    [400, GeneratorErrorKind.CONFIG],
    [404, GeneratorErrorKind.CONFIG],
    [429, GeneratorErrorKind.PROVIDER_TRANSIENT],
    [529, GeneratorErrorKind.PROVIDER_TRANSIENT],
  ])("maps SDK status %d to kind %s", async (status, kind) => {
    const sdkError = Object.assign(new Error(`http ${status}`), { status });
    const error = await rejectionFor(sdkError);
    expect(error).toBeInstanceOf(GeneratorError);
    expect(error).toMatchObject({ kind, cause: sdkError });
  });

  it("maps a connection-level failure to provider-transient", async () => {
    const connectionError = new APIConnectionError({
      cause: new Error("boom"),
    });
    const error = await rejectionFor(connectionError);
    expect(error).toMatchObject({
      kind: GeneratorErrorKind.PROVIDER_TRANSIENT,
      cause: connectionError,
    });
  });

  it("maps a statusless RetryableError to provider-transient", async () => {
    const retryable = new RetryableError("middleware retries exhausted");
    const error = await rejectionFor(retryable);
    expect(error).toMatchObject({
      kind: GeneratorErrorKind.PROVIDER_TRANSIENT,
      cause: retryable,
    });
  });

  it("wraps a statusless non-abort AnthropicError as opaque", async () => {
    const statusless = new AnthropicError("stream ended without a message");
    const error = await rejectionFor(statusless);
    expect(error).toBeInstanceOf(GeneratorError);
    expect(error).toMatchObject({
      kind: GeneratorErrorKind.OPAQUE,
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
      kind: GeneratorErrorKind.CONFIG,
    });
    expect(stub.requests).toHaveLength(0);
  });

  it("leaves an unrecognized rejection untouched", async () => {
    const weird = { odd: true };
    const error = await rejectionFor(weird);
    expect(error).toBe(weird);
  });
});

describe("AnthropicGenerator SDK eager-parse rejection (SDK >= 0.101)", () => {
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
