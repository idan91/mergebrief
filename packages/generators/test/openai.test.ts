import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APIUserAbortError } from "openai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { GeneratorError, GeneratorErrorKinds } from "../src/contract/errors";
import {
  GeneratorWarningKinds,
  type GeneratorWarning,
} from "../src/contract/types";
import { createOpenAiCore } from "../src/adapters/openai";
import { createGenerator, Providers } from "../src/config/registry";
import {
  expectNoAmbientAccountHeaders,
  getRequestUrl,
  stubAmbientOpenAiEnv,
  stubCapturingFetch,
  type CapturingFetch,
} from "./helpers";

/**
 * Adapter-specific behavior on fetch-level fixtures: request construction, the
 * 400-sniff no-knob discovery with its instance-lifetime cache and origin gap,
 * error-status mapping, /models preflight arms, and the baseUrl escape hatch.
 * Pipeline conformance lives in openai.contract.test.ts.
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

function stubSse(content: string): Response {
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

function getRequestBody(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new Error("expected a string request body");
  }
  return body;
}

function fetchWith(models: (url: string) => Response): typeof fetch {
  return async (input) => models(getRequestUrl(input));
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
    const models = modelsOk(getRequestUrl(input));
    if (models) {
      return models;
    }
    const parsed: unknown = JSON.parse(getRequestBody(init));
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
  if (!core.ok) {
    throw new Error(core.error.issues.join("; "));
  }
  return core.value;
}

/** Answers the `/models` preflight per `models` and the chat call with valid output. */
function stubOpenAiFetch(
  models: (url: string) => Response | null = modelsOk,
): CapturingFetch {
  return stubCapturingFetch((url) => {
    if (url.includes("/models/")) {
      return models(url) ?? jsonError(500, "no models fixture");
    }
    return stubSse('{"ok":true}');
  });
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

function stubSseFinishing(content: string, finishReason: string): Response {
  const events = [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(events, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("OpenAiCompatibleCore request construction", () => {
  it("sends no output cap, even when the request names one", async () => {
    const { generator, recorded } = await coreWith(() =>
      stubSse('{"ok":true}'),
    );

    await generator.generate(request());
    await generator.generate({ ...request(), maxOutputTokens: 128000 });

    expect(recorded.bodies[0]).not.toHaveProperty("max_completion_tokens");
    expect(recorded.bodies[1]).not.toHaveProperty("max_completion_tokens");
  });

  it("sends strict json_schema, reasoning_effort, and system/user messages", async () => {
    const { generator, recorded } = await coreWith(() =>
      stubSse('{"ok":true}'),
    );
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    const body = recorded.bodies[0];
    if (!body) {
      throw new Error("no request recorded");
    }
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

  it("prepends the shared user prefix to the user message", async () => {
    const { generator, recorded } = await coreWith(() =>
      stubSse('{"ok":true}'),
    );

    await generator.generate({ ...request(), userPrefix: "shared" });

    expect(recorded.bodies[0]?.["messages"]).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "shared\n\nusr" },
    ]);
  });
});

describe("OpenAiCompatibleCore effort-knob discovery", () => {
  it("retries without reasoning_effort on a 400 naming it and caches the gap", async () => {
    let calls = 0;
    const { generator, recorded } = await coreWith(() => {
      calls += 1;
      if (calls === 1) {
        return jsonError(
          400,
          "Unsupported parameter: 'reasoning_effort' is not supported with this model.",
        );
      }
      return stubSse('{"ok":true}');
    });
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(recorded.bodies[0]?.["reasoning_effort"]).toBe("high");
    expect(recorded.bodies[1]?.["reasoning_effort"]).toBeUndefined();
    // Instance-lifetime cache: the NEXT generate never sends the knob…
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(recorded.bodies[2]?.["reasoning_effort"]).toBeUndefined();
    // …and origin records the capability gap.
    expect(generator.origin("high")).toEqual({
      provider: "openai",
      model: "gpt-test-1",
      effort: null,
    });
  });

  it("reports a rejected reasoning_effort as a typed warning", async () => {
    const warnings: GeneratorWarning[] = [];
    const { generator } = await coreWith((body) =>
      body["reasoning_effort"] !== undefined
        ? jsonError(400, "Unsupported parameter: 'reasoning_effort'.")
        : stubSse('{"ok":true}'),
    );

    await expect(
      generator.generate({
        ...request(),
        onWarning: (warning) => warnings.push(warning),
      }),
    ).resolves.toEqual({ ok: true });

    expect(warnings).toEqual([
      {
        kind: GeneratorWarningKinds.EFFORT_REJECTED,
        message: expect.stringContaining(
          "gpt-test-1 rejected reasoning_effort",
        ),
      },
    ]);
  });

  it("keeps effort in the origin once the provider accepted the knob", async () => {
    const { generator } = await coreWith(() => stubSse('{"ok":true}'));
    await generator.generate(request());
    expect(generator.origin("low")).toEqual({
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
        : stubSse('{"ok":true}'),
    );
    const results = await Promise.all([
      generator.generate(request()),
      generator.generate(request()),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(generator.origin("high").effort).toBeNull();
  });

  it("does not treat an unrelated 400 as a knob rejection", async () => {
    const { generator, recorded } = await coreWith(() =>
      jsonError(400, "Invalid schema: something else entirely."),
    );
    await expect(generator.generate(request())).rejects.toMatchObject({
      kind: GeneratorErrorKinds.CONFIG,
    });
    expect(recorded.bodies).toHaveLength(1);
  });
});

describe("OpenAiCompatibleCore usage-option discovery", () => {
  function makeUsageRequest() {
    return { ...request(), onUsage: () => undefined };
  }

  it("retries without stream_options on a 400 naming it and caches the gap", async () => {
    const { generator, recorded } = await coreWith((body) =>
      body["stream_options"] === undefined
        ? stubSse('{"ok":true}')
        : jsonError(
            400,
            "Unrecognized request argument supplied: stream_options",
          ),
    );

    const warnings: GeneratorWarning[] = [];
    const first = generator.generate({
      ...makeUsageRequest(),
      onWarning: (warning) => warnings.push(warning),
    });
    await expect(first).resolves.toEqual({ ok: true });
    const later = makeUsageRequest();
    await generator.generate(later);

    const sent = recorded.bodies.map((body) => body["stream_options"]);
    expect(sent).toEqual([{ include_usage: true }, undefined, undefined]);
    expect(warnings).toEqual([
      {
        kind: GeneratorWarningKinds.USAGE_REJECTED,
        message: expect.stringContaining("gpt-test-1 rejected stream_options"),
      },
    ]);
  });

  it("drops both rejected parameters, one retry each", async () => {
    const { generator, recorded } = await coreWith((body) => {
      if (body["reasoning_effort"] !== undefined) {
        return jsonError(400, "Unsupported parameter: 'reasoning_effort'.");
      }
      if (body["stream_options"] !== undefined) {
        return jsonError(400, "Unknown parameter: stream_options");
      }
      return stubSse('{"ok":true}');
    });

    const call = generator.generate(makeUsageRequest());

    await expect(call).resolves.toEqual({ ok: true });
    expect(recorded.bodies).toHaveLength(3);
  });

  it("does not drop stream_options for an unrelated 400", async () => {
    const { generator, recorded } = await coreWith(() =>
      jsonError(400, "Invalid schema: something else entirely."),
    );

    const call = generator.generate(makeUsageRequest());

    await expect(call).rejects.toMatchObject({
      kind: GeneratorErrorKinds.CONFIG,
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
      kind: GeneratorErrorKinds.PROVIDER_TRANSIENT,
    });
  });
});

describe("OpenAiCompatibleCore mid-stream abort", () => {
  it("never accepts accumulated output from an aborted stream", async () => {
    // Headers and a full valid payload arrive, THEN the caller aborts. If the
    // SDK swallows the AbortError and ends the iterable, the coincidentally
    // valid output must still be rejected as an abort. The stream aborts on
    // first pull, so the abort lands while generate() is consuming.
    const controller = new AbortController();
    const fixtureFetch: typeof fetch = async (input) => {
      const models = modelsOk(getRequestUrl(input));
      if (models) {
        return models;
      }
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
          // The consumer pulled the payload, abort NOW, mid-consumption,
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
    // does not set .name, instanceof is the reliable check.)
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
      const models = modelsOk(getRequestUrl(input));
      if (models) {
        return models;
      }
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
      return stubSse('{"ok":true}');
    };
    const generator = await mustCore(fixtureFetch);
    await expect(generator.generate(request())).resolves.toEqual({ ok: true });
    expect(calls).toBe(2); // truncated attempt failed, retry recovered
  });

  it("fails a length finish as output-cut, never salvaging the fragment", async () => {
    // finish_reason=length + salvageable payload: salvage would return the
    // FRAGMENT as a completed generation, and a retry at the same cap is
    // cut the same way.
    const SalvageSchema = z.object({
      title: z.string(),
      tags: z.array(z.enum(["bugfix"])),
    });
    let calls = 0;
    const fixtureFetch: typeof fetch = async (input) => {
      const models = modelsOk(getRequestUrl(input));
      if (models) {
        return models;
      }
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
    ).rejects.toMatchObject({ kind: GeneratorErrorKinds.OUTPUT_CUT });
    expect(calls).toBe(1);
  });

  it("fails schema-valid output ending with finish_reason=length as cut", async () => {
    const { generator, recorded } = await coreWith(() =>
      stubSseFinishing('{"ok":true}', "length"),
    );

    await expect(generator.generate(request())).rejects.toMatchObject({
      kind: GeneratorErrorKinds.OUTPUT_CUT,
    });
    expect(recorded.bodies).toHaveLength(1);
  });

  it.each(["content_filter"])(
    "treats schema-valid output ending with finish_reason=%s as failed",
    async (reason) => {
      // Valid JSON + a filtered terminal reason: the output must fail the
      // attempt (retry), never complete the generation.
      let calls = 0;
      const fixtureFetch: typeof fetch = async (input) => {
        const models = modelsOk(getRequestUrl(input));
        if (models) {
          return models;
        }
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
        return stubSse('{"ok":true}');
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
    if (!(caught instanceof GeneratorError)) {
      throw new Error("wrong rejection");
    }
    expect(caught.kind).toBe(GeneratorErrorKinds.AUTH);
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
      const models = modelsOk(getRequestUrl(input));
      if (models) {
        return models;
      }
      throw Object.assign(new TypeError("fetch failed"), { cause: nested });
    };
    const generator = await mustCore(fixtureFetch);
    const caught = await generator.generate(request()).then(
      () => {
        throw new Error("expected rejection");
      },
      (error: unknown) => error,
    );
    if (!(caught instanceof GeneratorError)) {
      throw new Error("wrong rejection");
    }
    expect(caught.kind).toBe(GeneratorErrorKinds.PROVIDER_TRANSIENT);
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
  it("keeps the abort landing with the discovery 400 and caches the gap", async () => {
    const controller = new AbortController();
    let calls = 0;
    const { generator, recorded } = await coreWith((body) => {
      calls += 1;
      if (calls === 1 && body["reasoning_effort"] !== undefined) {
        // Abort lands together with the discovery 400.
        controller.abort(new Error("aborted at discovery"));
        return jsonError(400, "Unsupported parameter: 'reasoning_effort'.");
      }
      return stubSse('{"ok":true}');
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
    [401, GeneratorErrorKinds.AUTH],
    [403, GeneratorErrorKinds.AUTH],
    [404, GeneratorErrorKinds.CONFIG],
    [429, GeneratorErrorKinds.PROVIDER_TRANSIENT],
    [500, GeneratorErrorKinds.PROVIDER_TRANSIENT],
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
    if (direct.ok) {
      return;
    }
    const text = direct.error.issues.join("; ");
    expect(text).toContain("rejected");
    expect(text).not.toContain("SENTINEL");
    // Deterministic, must stay down, never restart.
    expect(direct.error.transient).toBeUndefined();
  });

  it("tags 5xx and network preflight failures transient", async () => {
    const on503 = await createOpenAiCore({
      apiKey: "test-key",
      model: "gpt-test-1",
      failureDir: tempDir("openai-503-"),
      provider: "openai",
      fetch: fetchWith(() => jsonError(503, "upstream overloaded")),
    });
    expect(on503.ok).toBe(false);
    if (on503.ok) {
      return;
    }
    expect(on503.error.transient).toBe(true);

    const onNetwork = await createOpenAiCore({
      apiKey: "test-key",
      model: "gpt-test-1",
      failureDir: tempDir("openai-net-"),
      provider: "openai",
      fetch: fetchWith(() => {
        throw new Error("getaddrinfo ENOTFOUND api.openai.com");
      }),
    });
    expect(onNetwork.ok).toBe(false);
    if (onNetwork.ok) {
      return;
    }
    expect(onNetwork.error.transient).toBe(true);
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
    if (direct.ok) {
      return;
    }
    expect(direct.error.issues.join("; ")).toContain('"gpt-nope" not found');
    expect(direct.error.transient).toBeUndefined();
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
    if (result.ok) {
      return;
    }
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
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("OPENAI_API_KEY");
  });
});

describe("openai client ignores ambient provider env", () => {
  beforeEach(() => {
    stubAmbientOpenAiEnv();
  });

  it("sends to the canonical host with no org or project header", async () => {
    const capturing = stubOpenAiFetch();
    const core = await createOpenAiCore({
      apiKey: "test-key",
      model: "gpt-test-1",
      failureDir: tempDir("openai-env-"),
      provider: "openai",
      fetch: capturing.fetch,
    });
    expect(core.ok).toBe(true);
    if (!core.ok) {
      return;
    }
    await core.value.generate(request());

    const urls = capturing.requests.map((sent) => sent.url);
    expect(urls).toEqual([
      "https://api.openai.com/v1/models/gpt-test-1",
      "https://api.openai.com/v1/chat/completions",
    ]);
    for (const sent of capturing.requests) {
      expectNoAmbientAccountHeaders(sent.headers);
    }
  });

  it("sends to the configured baseUrl and keeps its preflight warning", async () => {
    const logs: string[] = [];
    const capturing = stubOpenAiFetch(() => jsonError(404, "no /models here"));
    const core = await createOpenAiCore({
      apiKey: "test-key",
      model: "local-model",
      failureDir: tempDir("openai-env-base-"),
      provider: "openai",
      baseUrl: "https://gateway.example/v1",
      log: (message) => logs.push(message),
      fetch: capturing.fetch,
    });

    expect(core.ok).toBe(true);
    expect(capturing.requests[0]?.url).toBe(
      "https://gateway.example/v1/models/local-model",
    );
    expect(logs.join("\n")).toContain("continuing because baseUrl is set");
  });
});

describe("OpenAiCompatibleCore strict-mode optionality", () => {
  const OptionalSchema = z.object({
    ok: z.boolean(),
    note: z.string().optional(),
  });

  it("sends every property as required, optionals as null-unions", async () => {
    const { generator, recorded } = await coreWith(() =>
      stubSse('{"ok":true}'),
    );
    await generator.generate({ ...request(), schema: OptionalSchema });
    const body = recorded.bodies[0];
    if (!body) {
      throw new Error("no request recorded");
    }
    const wire = JSON.stringify(body["response_format"]);
    expect(wire).toContain('"required":["ok","note"]');
    expect(wire).toContain('{"type":"null"}');
  });

  it("accepts a null in a formerly-optional slot as absent", async () => {
    const { generator } = await coreWith(() =>
      stubSse('{"ok":true,"note":null}'),
    );
    await expect(
      generator.generate({ ...request(), schema: OptionalSchema }),
    ).resolves.toEqual({ ok: true });
  });
});
