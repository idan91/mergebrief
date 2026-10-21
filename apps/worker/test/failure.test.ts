import { GeneratorError, GeneratorErrorKinds } from "generators";
import { GenerationFailureCodes } from "types/generations";
import { describe, expect, it } from "vitest";
import {
  classifyFailure,
  PermanentJobError,
  TransientJobError,
} from "../src/task/failure";

describe("classifyFailure", () => {
  it("an explicit stamp wins over every probe", () => {
    const stamped = new PermanentJobError("diff too large", {
      failure: { code: GenerationFailureCodes.DIFF_TOO_LARGE },
      cause: Object.assign(new Error("406"), { status: 406 }),
    });
    expect(classifyFailure(stamped)).toEqual({
      code: GenerationFailureCodes.DIFF_TOO_LARGE,
    });
    const transient = new TransientJobError("gh 502", {
      failure: { code: GenerationFailureCodes.GITHUB_UNAVAILABLE },
    });
    expect(classifyFailure(transient)).toEqual({
      code: GenerationFailureCodes.GITHUB_UNAVAILABLE,
    });
  });

  it("classifies through an unstamped wrapper's cause", () => {
    const wrapped = new PermanentJobError("model refused", {
      cause: new GeneratorError(GeneratorErrorKinds.REFUSAL, "model refused"),
    });
    expect(classifyFailure(wrapped)).toEqual({
      code: GenerationFailureCodes.PROVIDER_REFUSAL,
    });
  });

  it.each([
    [GeneratorErrorKinds.AUTH, GenerationFailureCodes.PROVIDER_AUTH],
    [
      GeneratorErrorKinds.PROVIDER_TRANSIENT,
      GenerationFailureCodes.PROVIDER_UNAVAILABLE,
    ],
    [GeneratorErrorKinds.TIMEOUT, GenerationFailureCodes.PROVIDER_TIMEOUT],
    [GeneratorErrorKinds.SCHEMA_FLOOR, GenerationFailureCodes.OUTPUT_INVALID],
    [GeneratorErrorKinds.REFUSAL, GenerationFailureCodes.PROVIDER_REFUSAL],
  ])("maps GeneratorError kind %s to %s", (kind, code) => {
    expect(classifyFailure(new GeneratorError(kind, "boom"))).toEqual({
      code,
    });
  });

  it("config and cli-missing both land on generation-config with detail", () => {
    for (const kind of [
      GeneratorErrorKinds.CONFIG,
      GeneratorErrorKinds.CLI_MISSING,
    ]) {
      expect(
        classifyFailure(new GeneratorError(kind, "MODEL env var unknown")),
      ).toEqual({
        code: GenerationFailureCodes.GENERATION_CONFIG,
        params: { detail: "MODEL env var unknown" },
      });
    }
  });

  it("opaque generator errors keep their message as unknown detail", () => {
    expect(
      classifyFailure(
        new GeneratorError(GeneratorErrorKinds.OPAQUE, "exit code 7"),
      ),
    ).toEqual({
      code: GenerationFailureCodes.UNKNOWN,
      params: { detail: "exit code 7" },
    });
  });

  it("recovers rate-limit and timeout from a transient GeneratorError cause", () => {
    expect(
      classifyFailure(
        new GeneratorError(GeneratorErrorKinds.PROVIDER_TRANSIENT, "429", {
          cause: Object.assign(new Error("rate limited"), { status: 429 }),
        }),
      ),
    ).toEqual({ code: GenerationFailureCodes.PROVIDER_RATE_LIMIT });
    expect(
      classifyFailure(
        new GeneratorError(GeneratorErrorKinds.PROVIDER_TRANSIENT, "408", {
          cause: Object.assign(new Error("timeout"), { status: 408 }),
        }),
      ),
    ).toEqual({ code: GenerationFailureCodes.PROVIDER_TIMEOUT });
    expect(
      classifyFailure(
        new GeneratorError(GeneratorErrorKinds.PROVIDER_TRANSIENT, "529"),
      ),
    ).toEqual({ code: GenerationFailureCodes.PROVIDER_UNAVAILABLE });
  });

  it.each([
    [429, GenerationFailureCodes.PROVIDER_RATE_LIMIT],
    [408, GenerationFailureCodes.PROVIDER_TIMEOUT],
    [401, GenerationFailureCodes.PROVIDER_AUTH],
    [403, GenerationFailureCodes.PROVIDER_AUTH],
    [500, GenerationFailureCodes.PROVIDER_UNAVAILABLE],
    [529, GenerationFailureCodes.PROVIDER_UNAVAILABLE],
  ])("probes a bare status %i", (status, code) => {
    expect(
      classifyFailure(Object.assign(new Error("http"), { status })),
    ).toEqual({ code });
  });

  it("falls back to unknown{detail} for a plain error and a thrown string", () => {
    expect(classifyFailure(new Error("something odd"))).toEqual({
      code: GenerationFailureCodes.UNKNOWN,
      params: { detail: "something odd" },
    });
    expect(classifyFailure("thrown string")).toEqual({
      code: GenerationFailureCodes.UNKNOWN,
      params: { detail: "thrown string" },
    });
  });
});
