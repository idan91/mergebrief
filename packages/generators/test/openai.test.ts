import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APIUserAbortError } from "openai";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { GeneratorError, GeneratorErrorKind } from "../src/contract/errors";
import { createOpenAiCore } from "../src/adapters/openai";
import { createGenerator, Providers } from "../src/config/registry";

/**
 * Adapter-specific behavior on fetch-level fixtures: request construction
 * (strict json_schema, reasoning_effort), the 400-sniff no-knob discovery
 * with its instance-lifetime cache and provenance gap, error-status
 * mapping, /models preflight arms, and the baseUrl escape hatch. Pipeline
 * conformance lives in openai.contract.test.ts.
 */

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

function sse(content: string): Response {
  const events = [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
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
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function bodyOf(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body !== "string")
    throw new Error("expected a string request body");
  return body;
}

function fetchWith(models: (url: string) => Response): typeof fetch {
  return async (input) => models(urlOf(input));
}

function modelsOk(url: string): Response | null {
  if (url.includes("/models/")) {
    return new Response(JSON.stringify({ id: "m" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}

interface Recorded {
  bodies: Record<string, unknown>[];
}

/** Build a core whose chat endpoint plays the scripted responses in order. */
async function coreWith(
  responses: (body: Record<string, unknown>) => Response | Promise<Response>,
): Promise<{
  generator: Awaited<ReturnType<typeof mustCore>>;
  recorded: Recorded;
}> {
  const recorded: Recorded = { bodies: [] };
  const fixtureFetch: typeof fetch = async (input, init) => {
    const models = modelsOk(urlOf(input));
    if (models) return models;
    const parsed: unknown = JSON.parse(bodyOf(init));
    if (!isRecord(parsed)) {
      throw new Error("unexpected request body");
    }
    recorded.bodies.push(parsed);
    return responses(parsed);
  };
  const generator = await mustCore(fixtureFetch);
  return { generator, recorded };
}

async function mustCore(fixtureFetch: typeof fetch) {
  const core = await createOpenAiCore({
    apiKey: "test-key",
    model: "gpt-test-1",
    failureDir: tempDir("openai-fail-"),
    provider: "openai",
    fetch: fixtureFetch,
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

describe("OpenAiCompatibleCore request construction", () => {
  it("sends strict json_schema, reasoning_effort, and system/user messages", async () => {
    const { generator, recorded } = await coreWith(() => sse('{"ok":true}'));
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    const body = recorded.bodies[0];
    if (!body) throw new Error("no request recorded");
    expect(body["model"]).toBe("gpt-test-1");
    expect(body["reasoning_effort"]).toBe("high");
    expect(body["stream"]).toBe(true);
    const format = body["response_format"];
    expect(format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "probe", strict: true },
    });
    expect(JSON.stringify(format)).toContain('"ok"');
    expect(body["messages"]).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
  });
});

describe("OpenAiCompatibleCore effort-knob discovery", () => {
  it("retries once without reasoning_effort on a 400 naming it, and caches the gap", async () => {
    let calls = 0;
    const { generator, recorded } = await coreWith(() => {
      calls += 1;
      if (calls === 1) {
        return jsonError(
          400,
          "Unsupported parameter: 'reasoning_effort' is not supported with this model.",
        );
      }
      return sse('{"ok":true}');
    });
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(recorded.bodies[0]?.["reasoning_effort"]).toBe("high");
    expect(recorded.bodies[1]?.["reasoning_effort"]).toBeUndefined();
    // Instance-lifetime cache: the NEXT generate never sends the knob…
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(recorded.bodies[2]?.["reasoning_effort"]).toBeUndefined();
    // …and provenance records the capability gap (ADR 0013 #5).
    expect(generator.provenance("high")).toEqual({
      provider: "openai",
      model: "gpt-test-1",
      effort: null,
    });
  });

  it("keeps effort in provenance once the provider accepted the knob", async () => {
    const { generator } = await coreWith(() => sse('{"ok":true}'));
    await generator.generate(request());
    expect(generator.provenance("low")).toEqual({
      provider: "openai",
      model: "gpt-test-1",
      effort: "low",
    });
  });

  it("lets concurrent first requests each retry their own knob rejection", async () => {
    // Both in-flight requests sent the knob before either discovered the
    // gap; the SECOND must still retry even though its sibling already
    // flipped the shared cache (the race the per-request condition fixes).
    const { generator } = await coreWith((body) =>
      body["reasoning_effort"] !== undefined
        ? jsonError(400, "Unsupported parameter: 'reasoning_effort'.")
        : sse('{"ok":true}'),
    );
    const results = await Promise.all([
      generator.generate(request()),
      generator.generate(request()),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(generator.provenance("high").effort).toBeNull();
  });

  it("does not treat an unrelated 400 as a knob rejection", async () => {
    const { generator, recorded } = await coreWith(() =>
      jsonError(400, "Invalid schema: something else entirely."),
    );
    await expect(generator.generate(request())).rejects.toMatchObject({
      kind: GeneratorErrorKind.CONFIG,
    });
    expect(recorded.bodies).toHaveLength(1);
  });
});

describe("OpenAiCompatibleCore effort-retry classification boundary", () => {
  it("classifies a transient failure on the knob-less retry", async () => {
    let calls = 0;
    const { generator } = await coreWith(() => {
      calls += 1;
      return calls === 1
        ? jsonError(400, "Unsupported parameter: 'reasoning_effort'.")
        : jsonError(429, "rate limited");
    });
    await expect(generator.generate(request())).rejects.toMatchObject({
      kind: GeneratorErrorKind.PROVIDER_TRANSIENT,
    });
  });
});

describe("OpenAiCompatibleCore mid-stream abort", () => {
  it("never accepts accumulated output from an aborted stream", async () => {
    // Headers + a full valid payload arrive, THEN the caller aborts; if the
    // SDK swallows the AbortError and ends the iterable, the accumulated
    // (coincidentally valid) output must still be rejected as an abort.
    // The stream is built INSIDE the fetch and aborts on first pull, so the
    // abort demonstrably lands while generate() is consuming.
    const controller = new AbortController();
    const fixtureFetch: typeof fetch = async (input) => {
      const models = modelsOk(urlOf(input));
      if (models) return models;
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(streamController) {
          pulls += 1;
          const push = (payload: unknown) =>
            streamController.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`),
            );
          if (pulls === 1) {
            push({
              choices: [
                {
                  index: 0,
                  delta: { content: '{"ok":true}' },
                  finish_reason: null,
                },
              ],
            });
            return;
          }
          // The consumer pulled the payload — abort NOW, mid-consumption,
          // then end cleanly (the swallow case the SDK can produce).
          controller.abort(new Error("mid-stream abort"));
          push({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
          streamController.enqueue(
            new TextEncoder().encode("data: [DONE]\n\n"),
          );
          streamController.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const generator = await mustCore(fixtureFetch);
    const caught = await generator
      .generate({ ...request(), signal: controller.signal })
      .then(
        () => {
          throw new Error("expected the aborted generation to reject");
        },
        (error: unknown) => error,
      );
    // Abort-shaped, never a schema-floor success or failure. (The SDK class
    // does not set .name — instanceof is the reliable check.)
    expect(
      caught instanceof APIUserAbortError ||
        (typeof caught === "object" &&
          caught !== null &&
          Reflect.get(caught, "message") === "mid-stream abort"),
    ).toBe(true);
  });
});

describe("OpenAiCompatibleCore truncated streams", () => {
  it("treats EOF without a terminal finish_reason as a failed attempt", async () => {
    // A cleanly-truncated SSE body (no finish_reason, no [DONE]) whose
    // partial content is coincidentally valid JSON: the floor must see a
    // failed attempt (retry), never a completed generation.
    let calls = 0;
    const fixtureFetch: typeof fetch = async (input) => {
      const models = modelsOk(urlOf(input));
      if (models) return models;
      calls += 1;
      if (calls === 1) {
        const truncated = `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: '{"ok":true}' },
              finish_reason: null,
            },
          ],
        })}\n\n`;
        return new Response(truncated, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return sse('{"ok":true}');
    };
    const generator = await mustCore(fixtureFetch);
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(calls).toBe(2); // truncated attempt failed, retry recovered
  });

  it("never salvages truncated output, even with a droppable enum slip", async () => {
    // finish_reason=length + salvageable payload: without the salvageable
    // gate the floor would drop the bad enum and return the FRAGMENT as a
    // completed generation. It must retry instead.
    const SalvageSchema = z.object({
      title: z.string(),
      tags: z.array(z.enum(["bugfix"])),
    });
    let calls = 0;
    const fixtureFetch: typeof fetch = async (input) => {
      const models = modelsOk(urlOf(input));
      if (models) return models;
      calls += 1;
      const payload =
        calls === 1
          ? '{"title":"t","tags":["bugfix","scary"]}'
          : '{"title":"t","tags":["bugfix"]}';
      const reason = calls === 1 ? "length" : "stop";
      const events = [
        `data: ${JSON.stringify({
          choices: [
            { index: 0, delta: { content: payload }, finish_reason: null },
          ],
        })}\n\n`,
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: {}, finish_reason: reason }],
        })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");
      return new Response(events, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const generator = await mustCore(fixtureFetch);
    await expect(
      generator.generate({
        schema: SalvageSchema,
        system: "s",
        user: "u",
        effort: "medium",
        label: "salvage-trunc",
        salvageFields: ["tags"],
      }),
    ).resolves.toEqual({ title: "t", tags: ["bugfix"] });
    expect(calls).toBe(2); // retried — never salvaged the truncated first arm
  });

  it.each(["length", "content_filter"])(
    "treats schema-valid output ending with finish_reason=%s as failed",
    async (reason) => {
      // Valid JSON + a non-stop terminal reason: truncated/filtered output
      // must fail the attempt (retry), never complete the generation.
      let calls = 0;
      const fixtureFetch: typeof fetch = async (input) => {
        const models = modelsOk(urlOf(input));
        if (models) return models;
        calls += 1;
        if (calls === 1) {
          const events = [
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: { content: '{"ok":true}' },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
            `data: ${JSON.stringify({
              choices: [{ index: 0, delta: {}, finish_reason: reason }],
            })}\n\n`,
            "data: [DONE]\n\n",
          ].join("");
          return new Response(events, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        return sse('{"ok":true}');
      };
      const generator = await mustCore(fixtureFetch);
      await expect(generator.generate(request())).resolves.toEqual({
        ok: true,
      });
      expect(calls).toBe(2);
    },
  );
});

describe("OpenAiCompatibleCore message hygiene", () => {
  it("redacts credential-shaped provider text from classified errors", async () => {
    const { generator } = await coreWith(() =>
      jsonError(
        401,
        "Incorrect API key provided: sk-proj-SENTINELSECRETVALUE0000",
      ),
    );
    const caught = await generator.generate(request()).then(
      () => {
        throw new Error("expected rejection");
      },
      (error: unknown) => error,
    );
    if (!(caught instanceof GeneratorError)) throw new Error("wrong rejection");
    expect(caught.kind).toBe(GeneratorErrorKind.AUTH);
    expect(caught.message).not.toContain("SENTINELSECRETVALUE");
    // The WHOLE cause chain must be clean too: console.error prints cause
    // chains recursively, so a raw SDK cause would undo the redaction at
    // any full-object log sink.
    const chain: string[] = [];
    let node: unknown = caught;
    while (node instanceof Error) {
      chain.push(node.message);
      node = node.cause;
    }
    expect(chain.join("\n")).not.toContain("SENTINELSECRETVALUE");
  });
});

describe("OpenAiCompatibleCore statusless cause hygiene", () => {
  it("drops sentinel-bearing nested chains from connection failures", async () => {
    // A body-read TypeError whose nested cause carries credential-shaped
    // text: the classified error's WHOLE chain must be clean.
    const nested = new Error(
      "connect failed to https://user:SENTINELPASS@proxy.internal",
    );
    const fixtureFetch: typeof fetch = async (input) => {
      const models = modelsOk(urlOf(input));
      if (models) return models;
      throw Object.assign(new TypeError("fetch failed"), { cause: nested });
    };
    const generator = await mustCore(fixtureFetch);
    const caught = await generator.generate(request()).then(
      () => {
        throw new Error("expected rejection");
      },
      (error: unknown) => error,
    );
    if (!(caught instanceof GeneratorError)) throw new Error("wrong rejection");
    expect(caught.kind).toBe(GeneratorErrorKind.PROVIDER_TRANSIENT);
    const chain: string[] = [];
    let node: unknown = caught;
    while (node instanceof Error) {
      chain.push(node.message);
      node = node.cause;
    }
    expect(chain.join("\n")).not.toContain("SENTINELPASS");
  });
});

describe("OpenAiCompatibleCore abort during knob discovery", () => {
  it("keeps the abort when it lands with the discovery 400, and caches the gap", async () => {
    const controller = new AbortController();
    let calls = 0;
    const { generator, recorded } = await coreWith((body) => {
      calls += 1;
      if (calls === 1 && body["reasoning_effort"] !== undefined) {
        // Abort lands together with the discovery 400.
        controller.abort(new Error("aborted at discovery"));
        return jsonError(400, "Unsupported parameter: 'reasoning_effort'.");
      }
      return sse('{"ok":true}');
    });
    const caught = await generator
      .generate({ ...request(), signal: controller.signal })
      .then(
        () => {
          throw new Error("expected rejection");
        },
        (error: unknown) => error,
      );
    // Abort-shaped, never a CONFIG error built from the discovery response.
    expect(caught instanceof APIUserAbortError).toBe(true);
    // The discovery still stuck: the next call must not resend the knob.
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(recorded.bodies.at(-1)?.["reasoning_effort"]).toBeUndefined();
  });
});

describe("OpenAiCompatibleCore error classification", () => {
  it.each([
    [401, GeneratorErrorKind.AUTH],
    [403, GeneratorErrorKind.AUTH],
    [404, GeneratorErrorKind.CONFIG],
    [429, GeneratorErrorKind.PROVIDER_TRANSIENT],
    [500, GeneratorErrorKind.PROVIDER_TRANSIENT],
  ])("maps status %d to kind %s", async (status, kind) => {
    const { generator } = await coreWith(() =>
      jsonError(status, `http ${status}`),
    );
    const caught = await generator.generate(request()).then(
      () => {
        throw new Error("expected rejection");
      },
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(GeneratorError);
    expect(caught).toMatchObject({ kind });
  });
});

describe("openai preflight and registry entry", () => {
  it("refuses boot on a rejected key without echoing it", async () => {
    const direct = await createOpenAiCore({
      apiKey: "sk-test-SENTINEL",
      model: "gpt-test-1",
      failureDir: tempDir("openai-direct-"),
      provider: "openai",
      fetch: fetchWith(() => jsonError(401, "Incorrect API key provided")),
    });
    expect(direct.ok).toBe(false);
    if (direct.ok) return;
    const text = direct.error.issues.join("; ");
    expect(text).toContain("rejected");
    expect(text).not.toContain("SENTINEL");
  });

  it("refuses boot when the model does not exist", async () => {
    const direct = await createOpenAiCore({
      apiKey: "test-key",
      model: "gpt-nope",
      failureDir: tempDir("openai-404-"),
      provider: "openai",
      fetch: fetchWith(() =>
        jsonError(404, "The model 'gpt-nope' does not exist"),
      ),
    });
    expect(direct.ok).toBe(false);
    if (direct.ok) return;
    expect(direct.error.issues.join("; ")).toContain('"gpt-nope" not found');
  });

  it("downgrades preflight failures to warnings when baseUrl is set", async () => {
    const logs: string[] = [];
    const direct = await createOpenAiCore({
      apiKey: "test-key",
      model: "local-model",
      failureDir: tempDir("openai-base-"),
      provider: "openai",
      baseUrl: "http://localhost:8080/v1",
      log: (m) => logs.push(m),
      fetch: fetchWith(() => jsonError(404, "no /models here")),
    });
    expect(direct.ok).toBe(true);
    expect(logs.join("\n")).toContain("continuing because baseUrl is set");
  });

  it("requires model in the registry options", async () => {
    const result = await createGenerator(
      { provider: Providers.OPENAI },
      { env: { ...process.env }, failureDir: tempDir("openai-nomodel-") },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("model");
  });

  it("refuses boot when the key env var is unset", async () => {
    const env = { ...process.env };
    delete env["OPENAI_API_KEY"];
    const result = await createGenerator(
      { provider: Providers.OPENAI, model: "gpt-test-1" },
      { env, failureDir: tempDir("openai-nokey-") },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("OPENAI_API_KEY");
  });
});

describe("OpenAiCompatibleCore strict-mode optionality (BRIEF-77)", () => {
  const OptionalSchema = z.object({
    ok: z.boolean(),
    note: z.string().optional(),
  });

  it("sends every property as required, optionals as null-unions", async () => {
    const { generator, recorded } = await coreWith(() => sse('{"ok":true}'));
    await generator.generate({ ...request(), schema: OptionalSchema });
    const body = recorded.bodies[0];
    if (!body) throw new Error("no request recorded");
    const wire = JSON.stringify(body["response_format"]);
    expect(wire).toContain('"required":["ok","note"]');
    expect(wire).toContain('{"type":"null"}');
  });

  it("accepts a null in a formerly-optional slot as absent", async () => {
    const { generator } = await coreWith(() => sse('{"ok":true,"note":null}'));
    await expect(
      generator.generate({ ...request(), schema: OptionalSchema }),
    ).resolves.toEqual({ ok: true });
  });
});
