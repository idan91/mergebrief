import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { APIUserAbortError } from "openai";
import { createOpenRouterCore } from "../src/openrouter";
import { createGenerator, Providers } from "../src/registry";
import {
  describeGeneratorContract,
  type ContractTurn,
  type GeneratorContractHarness,
} from "./contract";

/**
 * OpenRouter assembly on fetch-level fixtures: /models preflight arms
 * (structured_outputs requirement, reasoning gating), the forced
 * require_parameters, reasoning:{effort} translation, served-model
 * verification — plus the shared contract suite. The streaming core's
 * pipeline behavior is already pinned by openai.contract.test.ts; the
 * contract run here guards the ASSEMBLY (preflight + transport wrapper).
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

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function bodyOf(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body !== "string") throw new Error("expected a string request body");
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
    if (urlOf(input).endsWith("/models")) return modelsResponse(supported);
    const parsed: unknown = JSON.parse(bodyOf(init));
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
    const scripted = scriptedFetch(() =>
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
    // Forced last — the configured false must lose.
    expect(body["provider"]).toEqual({
      order: ["some-lab"],
      require_parameters: true,
    });
    // OpenRouter reasoning shape; the core's knob never hits the wire.
    expect(body["reasoning"]).toEqual({ effort: "high" });
    expect(body["reasoning_effort"]).toBeUndefined();
    expect(body["model"]).toBe(SLUG);
  });

  it("omits reasoning and records the provenance gap when unsupported", async () => {
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
    expect(generator.provenance("high")).toEqual({
      provider: "openrouter",
      model: SLUG,
      effort: null,
    });
  });
});

describe("OpenRouter reasoning backstop", () => {
  it("recovers when the listing advertised reasoning but the provider rejects it", async () => {
    // The listing lied: reasoning is in supported_parameters, so the first
    // request carries reasoning:{effort} — OpenRouter answers 400 naming
    // `reasoning`. The transport-aware backstop retries without the knob
    // and provenance records the gap.
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
    expect(generator.provenance("high").effort).toBeNull();
  });
});

describe("OpenRouter served-model verification", () => {
  it("fires the mismatch hook and warns through the REQUEST log", async () => {
    const scripted = scriptedFetch(() =>
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
      onModelMismatch: (requested, served) => mismatches.push([requested, served]),
    });
    await expect(
      generator.generate({ ...request(), log: (m) => requestLogs.push(m) }),
    ).resolves.toEqual({ ok: true });
    expect(mismatches).toEqual([[SLUG, "other-lab/shadow-model"]]);
    // The per-request log carries the warning — that is the caller's
    // artifact-warning collection surface (BRIEF-11 UI surfacing); the
    // construction-time log does NOT double-log it.
    expect(requestLogs.join("\n")).toContain(
      "warning: requested model test-lab/test-model-1 but the stream reports other-lab/shadow-model",
    );
    expect(assemblyLogs.join("\n")).not.toContain("stream reports");
    expect(generator.provenance("medium").model).toBe(SLUG);
  });

  it("falls back to the construction log when the caller gave no request log", async () => {
    const scripted = scriptedFetch(() =>
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
    expect(assemblyLogs.join("\n")).toContain("stream reports other-lab/shadow-model");
  });

  it("stays quiet when the served model matches", async () => {
    const scripted = scriptedFetch(() =>
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
        urlOf(input).endsWith("/models")
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
    expect(result.error.issues.join("; ")).toContain('"missing/slug" not found');
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
  });

  it("sends attribution headers on requests", async () => {
    let headersSeen: Record<string, string> = {};
    const scripted = scriptedFetch(() =>
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
    expectedProvenance: {
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
        if (urlOf(input).endsWith("/models")) {
          return modelsResponse(["structured_outputs", "reasoning"]);
        }
        const parsed: unknown = JSON.parse(bodyOf(init));
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
              reject(new DOMException("The operation was aborted.", "AbortError"));
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

      return {
        generator: core.value,
        ...(wantsAbort ? { signal: controller.signal } : {}),
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
    },
  };
}

describeGeneratorContract("openrouter (fetch fixtures)", makeOpenRouterHarness);
