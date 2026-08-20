import { APIUserAbortError } from "openai";
import {
  describeGeneratorContract,
  type ContractTurn,
  type GeneratorContractHarness,
} from "./contract";
import { createOpenAiCore } from "../src/adapters/openai";

/**
 * The shared Generator conformance suite against FETCH-LEVEL fixtures: a
 * real `openai` SDK client whose injected fetch serves scripted SSE bodies —
 * the wire-level fake the API adapters use (deliberate contrast with the
 * anthropic stub-client anchor).
 */

/** One SSE chat-completions stream body. */
function sseBody(content: string, refusal?: string): string {
  const events: string[] = [];
  const push = (payload: unknown) =>
    events.push(`data: ${JSON.stringify(payload)}\n\n`);
  // Split the content across two deltas — accumulation must reassemble.
  const cut = Math.ceil(content.length / 2);
  for (const piece of [content.slice(0, cut), content.slice(cut)]) {
    push({
      choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
    });
  }
  if (refusal !== undefined) {
    push({ choices: [{ index: 0, delta: { refusal }, finish_reason: null }] });
  }
  push({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  events.push("data: [DONE]\n\n");
  return events.join("");
}

interface RecordedRequest {
  messages: { role: string; content: string }[];
}

function getRequestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function isRecordedMessage(
  value: unknown,
): value is { role: string; content: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "role") === "string" &&
    typeof Reflect.get(value, "content") === "string"
  );
}

function getRequestBody(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body !== "string")
    throw new Error("expected a string request body");
  return body;
}

function makeOpenAiHarness(): GeneratorContractHarness {
  let recorded: RecordedRequest[] = [];

  return {
    expectedOrigin: {
      provider: "openai",
      model: "gpt-test-1",
      effort: "medium",
    },
    // Structured outputs surface refusals on a dedicated delta channel.
    supportsRefusal: true,
    isAbortRejection: (error) =>
      error instanceof APIUserAbortError ||
      (typeof error === "object" &&
        error !== null &&
        Reflect.get(error, "name") === "APIUserAbortError"),
    async make(turns: readonly ContractTurn[], failureDir: string) {
      recorded = [];
      const controller = new AbortController();
      const wantsAbort = turns.some((turn) => "abort" in turn);

      let served = 0;
      const fixtureFetch: typeof fetch = async (input, init) => {
        const url = getRequestUrl(input);
        if (url.endsWith("/models/gpt-test-1")) {
          return new Response(JSON.stringify({ id: "gpt-test-1" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const body: unknown = JSON.parse(getRequestBody(init));
        if (typeof body === "object" && body !== null) {
          const messages = Reflect.get(body, "messages");
          recorded.push({
            messages: Array.isArray(messages)
              ? messages.filter(isRecordedMessage)
              : [],
          });
        }
        const turn = turns[served] ?? turns[turns.length - 1];
        served += 1;
        if (turn === undefined) throw new Error("no scripted turn left");
        if ("abort" in turn) {
          // Never respond; abort the caller's signal and reject like fetch
          // does — the SDK converts this into its APIUserAbortError.
          queueMicrotask(() => controller.abort());
          return new Promise<Response>((_resolve, reject) => {
            const fail = () =>
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              );
            if (init?.signal?.aborted) fail();
            else init?.signal?.addEventListener("abort", fail);
          });
        }
        const sse = (content: string, refusal?: string) =>
          new Response(sseBody(content, refusal), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        if ("refusal" in turn) return sse("", "I can't help with that.");
        return sse(turn.raw);
      };

      const core = await createOpenAiCore({
        apiKey: "test-key",
        model: "gpt-test-1",
        failureDir,
        provider: "openai",
        fetch: fixtureFetch,
      });
      if (!core.ok) throw new Error(core.error.issues.join("; "));

      return {
        generator: core.value,
        ...(wantsAbort ? { signal: controller.signal } : {}),
        attempts: () => recorded.length,
        feedbackSeen: () => {
          const retry = recorded[1];
          if (!retry) return null;
          // Everything past the base [system, user] pair is feedback.
          return retry.messages
            .slice(2)
            .map((message) => message.content)
            .join("\n");
        },
      };
    },
  };
}

describeGeneratorContract("openai (fetch fixtures)", makeOpenAiHarness);
