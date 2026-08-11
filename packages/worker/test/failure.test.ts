import { APIConnectionError } from "@anthropic-ai/sdk";
import { GeneratorError, GeneratorErrorKind } from "generators";
import { GenerationFailureCode } from "persistence";
import { describe, expect, it } from "vitest";
import {
  classifyFailure,
  PermanentJobError,
  TransientJobError,
} from "../src/task/failure";

describe("classifyFailure", () => {
  it("an explicit stamp wins over every probe", () => {
    const stamped = new PermanentJobError("diff too large", {
      failure: { code: GenerationFailureCode.DIFF_TOO_LARGE },
      cause: Object.assign(new Error("406"), { status: 406 }),
    });
    expect(classifyFailure(stamped)).toEqual({
      code: GenerationFailureCode.DIFF_TOO_LARGE,
    });
    const transient = new TransientJobError("gh 502", {
      failure: { code: GenerationFailureCode.GITHUB_UNAVAILABLE },
    });
    expect(classifyFailure(transient)).toEqual({
      code: GenerationFailureCode.GITHUB_UNAVAILABLE,
    });
  });

  it("classifies through an unstamped wrapper's cause", () => {
    const wrapped = new PermanentJobError("model refused", {
      cause: new GeneratorError(GeneratorErrorKind.REFUSAL, "model refused"),
    });
    expect(classifyFailure(wrapped)).toEqual({
      code: GenerationFailureCode.PROVIDER_REFUSAL,
    });
  });

  it.each([
    [GeneratorErrorKind.AUTH, GenerationFailureCode.PROVIDER_AUTH],
    [
      GeneratorErrorKind.PROVIDER_TRANSIENT,
      GenerationFailureCode.PROVIDER_UNAVAILABLE,
    ],
    [GeneratorErrorKind.TIMEOUT, GenerationFailureCode.PROVIDER_TIMEOUT],
    [GeneratorErrorKind.SCHEMA_FLOOR, GenerationFailureCode.OUTPUT_INVALID],
    [GeneratorErrorKind.REFUSAL, GenerationFailureCode.PROVIDER_REFUSAL],
  ])("maps GeneratorError kind %s to %s", (kind, code) => {
    expect(classifyFailure(new GeneratorError(kind, "boom"))).toEqual({
      code,
    });
  });

  it("config and cli-missing both land on generation-config with detail", () => {
    for (const kind of [
      GeneratorErrorKind.CONFIG,
      GeneratorErrorKind.CLI_MISSING,
    ]) {
      expect(
        classifyFailure(new GeneratorError(kind, "MODEL env var unknown")),
      ).toEqual({
        code: GenerationFailureCode.GENERATION_CONFIG,
        params: { detail: "MODEL env var unknown" },
      });
    }
  });

  it("opaque generator errors keep their message as unknown detail", () => {
    expect(
      classifyFailure(
        new GeneratorError(GeneratorErrorKind.OPAQUE, "exit code 7"),
      ),
    ).toEqual({
      code: GenerationFailureCode.UNKNOWN,
      params: { detail: "exit code 7" },
    });
  });

  it("recovers rate-limit and timeout from a transient GeneratorError's cause", () => {
    expect(
      classifyFailure(
        new GeneratorError(GeneratorErrorKind.PROVIDER_TRANSIENT, "429", {
          cause: Object.assign(new Error("rate limited"), { status: 429 }),
        }),
      ),
    ).toEqual({ code: GenerationFailureCode.PROVIDER_RATE_LIMIT });
    expect(
      classifyFailure(
        new GeneratorError(GeneratorErrorKind.PROVIDER_TRANSIENT, "408", {
          cause: Object.assign(new Error("timeout"), { status: 408 }),
        }),
      ),
    ).toEqual({ code: GenerationFailureCode.PROVIDER_TIMEOUT });
    expect(
      classifyFailure(
        new GeneratorError(GeneratorErrorKind.PROVIDER_TRANSIENT, "529"),
      ),
    ).toEqual({ code: GenerationFailureCode.PROVIDER_UNAVAILABLE });
  });

  it("maps a connection-level SDK failure to provider-unavailable", () => {
    expect(classifyFailure(new APIConnectionError({}))).toEqual({
      code: GenerationFailureCode.PROVIDER_UNAVAILABLE,
    });
  });

  it.each([
    [429, GenerationFailureCode.PROVIDER_RATE_LIMIT],
    [408, GenerationFailureCode.PROVIDER_TIMEOUT],
    [401, GenerationFailureCode.PROVIDER_AUTH],
    [403, GenerationFailureCode.PROVIDER_AUTH],
    [500, GenerationFailureCode.PROVIDER_UNAVAILABLE],
    [529, GenerationFailureCode.PROVIDER_UNAVAILABLE],
  ])("probes a bare status %i", (status, code) => {
    expect(
      classifyFailure(Object.assign(new Error("http"), { status })),
    ).toEqual({ code });
  });

  it("falls back to unknown{detail} for a plain error and a thrown string", () => {
    expect(classifyFailure(new Error("something odd"))).toEqual({
      code: GenerationFailureCode.UNKNOWN,
      params: { detail: "something odd" },
    });
    expect(classifyFailure("thrown string")).toEqual({
      code: GenerationFailureCode.UNKNOWN,
      params: { detail: "thrown string" },
    });
  });
});
