import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { APIUserAbortError } from "openai";
import { GeneratorError, GeneratorErrorKinds } from "../src/contract/errors";
import { createOpenRouterCore } from "../src/adapters/openrouter";
import { createGenerator, Providers } from "../src/config/registry";
import {
  describeGeneratorContract,
  type ContractGeneratorHandle,
  type ContractTurn,
  type GeneratorContractHarness,
} from "./contract";

/**
 * Fetch fixtures cover preflight plus transport assembly and shared conformance.
 * The OpenAI contract suite separately pins the shared streaming pipeline.
 */

const SLUG = "test-lab/test-model-1";

const Schema = z.object({ ok: z.boolean() });

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function getRequestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function getRequestBody(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body !== "string")
    throw new Error("expected a string request body");
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelsResponse(supported: string[]): Response {
  return new Response(
    JSON.stringify({
      data: [
        { id: "other/model", supported_parameters: ["tools"] },
        { id: SLUG, supported_parameters: supported },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function sse(content: string, servedModel = SLUG, refusal?: string): string {
  const events: string[] = [];
  const push = (payload: unknown) =>
    events.push(`data: ${JSON.stringify(payload)}\n\n`);
  push({
    model: servedModel,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  });
  if (refusal !== undefined) {
    push({
      model: servedModel,
      choices: [{ index: 0, delta: { refusal }, finish_reason: null }],
    });
  }
  push({
    model: servedModel,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });
  events.push("data: [DONE]\n\n");
  return events.join("");
}

interface Scripted {
  bodies: Record<string, unknown>[];
  fetch: typeof fetch;
}

function scriptedFetch(
  respond: (body: Record<string, unknown>, call: number) => Response,
  supported: string[] = ["structured_outputs", "reasoning"],
): Scripted {
  const bodies: Record<string, unknown>[] = [];
  const fixture: typeof fetch = async (input, init) => {
    if (getRequestUrl(input).endsWith("/models"))
      return modelsResponse(supported);
    const parsed: unknown = JSON.parse(getRequestBody(init));
    if (!isRecord(parsed)) throw new Error("unexpected request body");
    bodies.push(parsed);
    return respond(parsed, bodies.length);
  };
  return { bodies, fetch: fixture };
}

async function mustCore(
  scripted: Scripted,
  overrides?: Partial<Parameters<typeof createOpenRouterCore>[0]>,
) {
  const core = await createOpenRouterCore({
    apiKey: "test-key",
    model: SLUG,
    failureDir: tempDir("openrouter-fail-"),
    fetch: scripted.fetch,
    ...overrides,
  });
  if (!core.ok) throw new Error(core.error.issues.join("; "));
  return core.value;
}

function request() {
  return {
    schema: Schema,
    system: "sys",
    user: "usr",
    effort: "high" as const,
    label: "probe",
  };
}

describe("OpenRouter request translation", () => {
  it("forces require_parameters over routing options and translates effort", async () => {
    const scripted = scriptedFetch(
      () =>
        new Response(sse('{"ok":true}'), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const generator = await mustCore(scripted, {
      providerRouting: { order: ["some-lab"], require_parameters: false },
    });
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    const body = scripted.bodies[0];
    if (!body) throw new Error("no request recorded");
    // Forced last, the configured false must lose.
    expect(body["provider"]).toEqual({
      order: ["some-lab"],
      require_parameters: true,
    });
    // OpenRouter reasoning shape; the core's knob never hits the wire.
    expect(body["reasoning"]).toEqual({ effort: "high" });
    expect(body["reasoning_effort"]).toBeUndefined();
    expect(body["model"]).toBe(SLUG);
  });

  it("omits reasoning and records the origin gap when unsupported", async () => {
    const scripted = scriptedFetch(
      () =>
        new Response(sse('{"ok":true}'), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ["structured_outputs"], // no reasoning
    );
    const generator = await mustCore(scripted);
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(scripted.bodies[0]?.["reasoning"]).toBeUndefined();
    expect(generator.origin("high")).toEqual({
      provider: "openrouter",
      model: SLUG,
      effort: null,
    });
  });
});

describe("OpenRouter reasoning backstop", () => {
  it("recovers from provider rejection of advertised reasoning support", async () => {
    // The listing lied: reasoning is in supported_parameters, so the first
    // request carries reasoning:{effort}, OpenRouter answers 400 naming
    // `reasoning`. The transport-aware backstop retries without the knob
    // and origin records the gap.
    const scripted = scriptedFetch((body) =>
      body["reasoning"] !== undefined
        ? new Response(
            JSON.stringify({
              error: { message: "reasoning is not supported for this model" },
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          )
        : new Response(sse('{"ok":true}'), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
    );
    const generator = await mustCore(scripted);
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(scripted.bodies).toHaveLength(2);
    expect(scripted.bodies[1]?.["reasoning"]).toBeUndefined();
    expect(generator.origin("high").effort).toBeNull();
  });

  it("recovers when the knob rejection arrives wrapped in metadata.raw", async () => {
    // The catalog listed reasoning, the upstream provider rejects it, but
    // OpenRouter wraps that as a generic 400 whose top-level message never
    // names `reasoning`; only metadata.raw does. Without scanning the raw,
    // this is a permanent CONFIG failure instead of an honest effort: null.
    const scripted = scriptedFetch((body) =>
      body["reasoning"] !== undefined
        ? wrapped400(
            '{"error": {"message": "reasoning is not supported for this model", "type": "invalid_request_error"}}',
            "SomeLab",
          )
        : new Response(sse('{"ok":true}'), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
    );
    const generator = await mustCore(scripted);
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(scripted.bodies).toHaveLength(2);
    expect(scripted.bodies[1]?.["reasoning"]).toBeUndefined();
    expect(generator.origin("high").effort).toBeNull();
  });
});

// A real failing body captured from a live repro: OpenRouter wraps the
// upstream rejection as a generic 400, the actual cause lives only in
// error.metadata.raw.
const CAPTURED_RAW =
  '{\n  "error": {\n    "message": "Invalid schema for response_format \'brief\': In context=(\'properties\', \'chunks\', \'items\'), \'required\' is required to be supplied and to be an array including every key in properties. Missing \'riskNotes\'.",\n    "type": "invalid_request_error",\n    "param": "text.format.schema",\n    "code": "invalid_json_schema"\n  }\n}';

function wrapped400(raw: string, providerName = "Azure"): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: "Provider returned error",
        code: 400,
        metadata: {
          raw,
          provider_name: providerName,
          is_byok: false,
          previous_errors: [
            {
              code: 400,
              message: "Provider returned error",
              provider_name: "OpenAI",
              raw,
            },
          ],
        },
      },
      user_id: "user_test",
    }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

async function caughtFrom(generator: {
  generate: (req: ReturnType<typeof request>) => Promise<unknown>;
}): Promise<GeneratorError> {
  const caught = await generator.generate(request()).then(
    () => {
      throw new Error("expected rejection");
    },
    (error: unknown) => error,
  );
  if (!(caught instanceof GeneratorError))
    throw new Error("wrong rejection type");
  return caught;
}

describe("OpenRouter wrapped-400 metadata surfacing", () => {
  it("folds metadata.raw and provider_name into the classified message", async () => {
    const scripted = scriptedFetch(() => wrapped400(CAPTURED_RAW));
    const generator = await mustCore(scripted);
    const caught = await caughtFrom(generator);
    expect(caught.kind).toBe(GeneratorErrorKinds.CONFIG);
    expect(caught.message).toContain("Azure");
    expect(caught.message).toContain("Missing 'riskNotes'");
  });

  it("keeps today's message when the 400 carries no metadata", async () => {
    const scripted = scriptedFetch(
      () =>
        new Response(
          JSON.stringify({
            error: { message: "plain bad request", code: 400 },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    );
    const generator = await mustCore(scripted);
    const caught = await caughtFrom(generator);
    expect(caught.kind).toBe(GeneratorErrorKinds.CONFIG);
    expect(caught.message).toContain("plain bad request");
  });

  it("redacts secrets inside the surfaced raw text", async () => {
    const scripted = scriptedFetch(() =>
      wrapped400("upstream rejected: api_key=sk-SENTINELSECRET123 is invalid"),
    );
    const generator = await mustCore(scripted);
    const caught = await caughtFrom(generator);
    expect(caught.message).toContain("(redacted)");
    const chain: string[] = [];
    let node: unknown = caught;
    while (node instanceof Error) {
      chain.push(node.message);
      node = node.cause;
    }
    expect(chain.join("\n")).not.toContain("SENTINELSECRET123");
  });

  it("bounds the surfaced message even for a huge raw body", async () => {
    // Short repeated words survive every redaction rule (a single long run
    // would be collapsed by redactSecrets before the slice, making the
    // bound assertion vacuous), the 800 chars must come from the slice.
    const scripted = scriptedFetch(() =>
      wrapped400("missing key ".repeat(500)),
    );
    const generator = await mustCore(scripted);
    const caught = await caughtFrom(generator);
    expect(caught.message).toContain("missing key");
    expect(caught.message.length).toBe(800);
  });
});

describe("OpenRouter served-model verification", () => {
  it("fires the mismatch hook and warns through the REQUEST log", async () => {
    const scripted = scriptedFetch(
      () =>
        new Response(sse('{"ok":true}', "other-lab/shadow-model"), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const assemblyLogs: string[] = [];
    const requestLogs: string[] = [];
    const mismatches: Array<[string, string]> = [];
    const generator = await mustCore(scripted, {
      log: (m) => assemblyLogs.push(m),
      onModelMismatch: (requested, served) =>
        mismatches.push([requested, served]),
    });
    await expect(
      generator.generate({ ...request(), log: (m) => requestLogs.push(m) }),
    ).resolves.toEqual({ ok: true });
    expect(mismatches).toEqual([[SLUG, "other-lab/shadow-model"]]);
    // The per-request log carries the warning, that is the caller's
    // artifact-warning collection surface; the
    // construction-time log does NOT double-log it.
    expect(requestLogs.join("\n")).toContain(
      "warning: requested model test-lab/test-model-1 but the stream reports other-lab/shadow-model",
    );
    expect(assemblyLogs.join("\n")).not.toContain("stream reports");
    expect(generator.origin("medium").model).toBe(SLUG);
  });

  it("falls back to the construction log when the caller gave no request log", async () => {
    const scripted = scriptedFetch(
      () =>
        new Response(sse('{"ok":true}', "other-lab/shadow-model"), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const assemblyLogs: string[] = [];
    const generator = await mustCore(scripted, {
      log: (m) => assemblyLogs.push(m),
    });
    // No req.log: the mismatch warning must still reach SOME log.
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(assemblyLogs.join("\n")).toContain(
      "stream reports other-lab/shadow-model",
    );
  });

  it("stays quiet when the served model matches", async () => {
    const scripted = scriptedFetch(
      () =>
        new Response(sse('{"ok":true}'), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const mismatches: string[] = [];
    const generator = await mustCore(scripted, {
      onModelMismatch: (requested) => mismatches.push(requested),
    });
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(mismatches).toEqual([]);
  });
});

describe("OpenRouter preflight", () => {
  it("refuses boot when the model lacks structured_outputs", async () => {
    const result = await createOpenRouterCore({
      apiKey: "test-key",
      model: SLUG,
      failureDir: tempDir("openrouter-nostructured-"),
      fetch: async (input) =>
        getRequestUrl(input).endsWith("/models")
          ? modelsResponse(["tools"])
          : new Response("{}", { status: 500 }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("structured_outputs");
  });

  it("refuses boot when the slug is not listed", async () => {
    const result = await createOpenRouterCore({
      apiKey: "test-key",
      model: "missing/slug",
      failureDir: tempDir("openrouter-noslug-"),
      fetch: async () => modelsResponse(["structured_outputs"]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain(
      '"missing/slug" not found',
    );
  });

  it("refuses boot on a rejected key without echoing it", async () => {
    const result = await createOpenRouterCore({
      apiKey: "sk-or-SENTINEL",
      model: SLUG,
      failureDir: tempDir("openrouter-badkey-"),
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: "bad key" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.error.issues.join("; ");
    expect(text).toContain("rejected the API key");
    expect(text).not.toContain("SENTINEL");
    // Deterministic, must stay down, never restart.
    expect(result.error.transient).toBeUndefined();
  });

  it("tags 5xx and network preflight failures transient", async () => {
    const on503 = await createOpenRouterCore({
      apiKey: "test-key",
      model: SLUG,
      failureDir: tempDir("openrouter-503-"),
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: "overloaded" } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(on503.ok).toBe(false);
    if (on503.ok) return;
    expect(on503.error.transient).toBe(true);

    const onNetwork = await createOpenRouterCore({
      apiKey: "test-key",
      model: SLUG,
      failureDir: tempDir("openrouter-net-"),
      fetch: async () => {
        throw new Error("getaddrinfo ENOTFOUND openrouter.ai");
      },
    });
    expect(onNetwork.ok).toBe(false);
    if (onNetwork.ok) return;
    expect(onNetwork.error.transient).toBe(true);
  });

  it("sends attribution headers on requests", async () => {
    let headersSeen: Record<string, string> = {};
    const scripted = scriptedFetch(
      () =>
        new Response(sse('{"ok":true}'), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const wrapped: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      headersSeen = {
        referer: headers.get("HTTP-Referer") ?? "",
        title: headers.get("X-Title") ?? "",
      };
      return scripted.fetch(input, init);
    };
    const generator = await mustCore(
      { bodies: scripted.bodies, fetch: wrapped },
      { referer: "https://mergebrief.dev", title: "MergeBrief" },
    );
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(headersSeen).toEqual({
      referer: "https://mergebrief.dev",
      title: "MergeBrief",
    });
  });
});

describe("openrouter registry entry", () => {
  it("refuses boot when the key env var is unset", async () => {
    const env = { ...process.env };
    delete env["OPENROUTER_API_KEY"];
    const result = await createGenerator(
      { provider: Providers.OPENROUTER, model: SLUG },
      { env, failureDir: tempDir("openrouter-nokey-") },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("OPENROUTER_API_KEY");
  });

  it("requires model in the options", async () => {
    const result = await createGenerator(
      { provider: Providers.OPENROUTER },
      { env: { ...process.env }, failureDir: tempDir("openrouter-nomodel-") },
    );
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The shared conformance suite, over the full assembly (preflight + wrapper).
// ---------------------------------------------------------------------------

function makeOpenRouterHarness(): GeneratorContractHarness {
  let recorded: { messages: { role: string; content: string }[] }[] = [];

  return {
    expectedOrigin: {
      provider: "openrouter",
      model: SLUG,
      effort: "medium",
    },
    supportsRefusal: true,
    isAbortRejection: (error) => error instanceof APIUserAbortError,
    async make(turns: readonly ContractTurn[], failureDir: string) {
      recorded = [];
      const controller = new AbortController();
      const wantsAbort = turns.some((turn) => "abort" in turn);
      let served = 0;
      const fixture: typeof fetch = async (input, init) => {
        if (getRequestUrl(input).endsWith("/models")) {
          return modelsResponse(["structured_outputs", "reasoning"]);
        }
        const parsed: unknown = JSON.parse(getRequestBody(init));
        if (isRecord(parsed)) {
          const messages = Reflect.get(parsed, "messages");
          recorded.push({
            messages: Array.isArray(messages)
              ? messages.filter(
                  (m): m is { role: string; content: string } =>
                    isRecord(m) &&
                    typeof m["role"] === "string" &&
                    typeof m["content"] === "string",
                )
              : [],
          });
        }
        const turn = turns[served] ?? turns[turns.length - 1];
        served += 1;
        if (turn === undefined) throw new Error("no scripted turn left");
        if ("abort" in turn) {
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
        const respond = (content: string, refusal?: string) =>
          new Response(sse(content, SLUG, refusal), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        if ("refusal" in turn) return respond("", "I can't help with that.");
        return respond(turn.raw);
      };

      const core = await createOpenRouterCore({
        apiKey: "test-key",
        model: SLUG,
        failureDir,
        fetch: fixture,
      });
      if (!core.ok) throw new Error(core.error.issues.join("; "));

      const handle: ContractGeneratorHandle = {
        generator: core.value,
        attempts: () => recorded.length,
        feedbackSeen: () => {
          const retry = recorded[1];
          if (!retry) return null;
          return retry.messages
            .slice(2)
            .map((message) => message.content)
            .join("\n");
        },
      };

      if (wantsAbort) handle.signal = controller.signal;

      return handle;
    },
  };
}

describeGeneratorContract("openrouter (fetch fixtures)", makeOpenRouterHarness);
