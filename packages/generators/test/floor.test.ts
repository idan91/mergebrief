import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { GeneratorError, GeneratorErrorKind } from "../src/contract/errors";
import { runWithSchemaFloor } from "../src/validation/enforceSchema";

/**
 * Pipeline edge cases the shared contract suite can't reach through a real
 * adapter: transport-parsed passthrough, empty-output no-retry, and
 * transport rejections passing through untouched.
 */

const Schema = z.object({ title: z.string() });

describe("runWithSchemaFloor", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "floor-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a valid transport-parsed value without re-parsing raw", async () => {
    let calls = 0;
    const value = await runWithSchemaFloor({
      schema: Schema,
      label: "floor",
      failureDir: dir,
      attempt: async () => {
        calls++;
        // Valid parsed candidate short-circuits (raw would fail JSON.parse).
        return { raw: "not json", parsed: { title: "from transport" } };
      },
    });
    expect(value).toEqual({ title: "from transport" });
    expect(calls).toBe(1);
  });

  it("still validates a transport-parsed candidate against the schema", async () => {
    // An adapter claiming native enforcement can't smuggle invalid data past
    // the floor: the bad candidate falls through to the raw
    // path, which here succeeds — proving the floor, not the transport,
    // decided.
    const value = await runWithSchemaFloor({
      schema: Schema,
      label: "floor",
      failureDir: dir,
      attempt: async () => ({
        raw: JSON.stringify({ title: "from raw" }),
        // Invalid candidate — `parsed` is `unknown` by design (untrusted).
        parsed: { title: 42 },
      }),
    });
    expect(value).toEqual({ title: "from raw" });
  });

  it("salvages from the parsed candidate when raw is not the payload itself", async () => {
    const Tagged = z.object({
      title: z.string(),
      tags: z.array(z.enum(["a", "b"])),
    });
    let calls = 0;
    const value = await runWithSchemaFloor({
      schema: Tagged,
      label: "floor",
      failureDir: dir,
      salvageFields: ["tags"],
      attempt: async () => {
        calls++;
        return {
          // Envelope raw — JSON.parse(raw) would NOT yield the payload.
          raw: "<envelope>not the payload</envelope>",
          parsed: { title: "t", tags: ["a", "zzz"] },
        };
      },
    });
    expect(value).toEqual({ title: "t", tags: ["a"] });
    expect(calls).toBe(1);
  });

  it("retries a candidate-only failure with the candidate's own errors", async () => {
    // No raw text at all: feedback carries the serialized candidate and the
    // candidate's Zod issues, not a JSON.parse error about empty input.
    const seen: { raw: string; error: string }[] = [];
    const value = await runWithSchemaFloor({
      schema: Schema,
      label: "floor",
      failureDir: dir,
      attempt: async (feedback) => {
        if (feedback) {
          seen.push(feedback);
          return { raw: JSON.stringify({ title: "fixed" }) };
        }
        return { raw: "", parsed: { title: 7 } };
      },
    });
    expect(value).toEqual({ title: "fixed" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.raw).toBe(JSON.stringify({ title: 7 }));
    expect(seen[0]?.error).toContain("Failed to parse structured output");
    expect(seen[0]?.error).toContain("title");
  });

  it("survives a candidate that throws from both toJSON and coercion", async () => {
    const hostile = {
      toJSON() {
        throw new Error("no json");
      },
      [Symbol.toPrimitive]() {
        throw new Error("no primitive");
      },
    };
    await expect(
      runWithSchemaFloor({
        schema: Schema,
        label: "floor",
        failureDir: dir,
        attempt: async () => ({ raw: "", parsed: hostile }),
      }),
    ).rejects.toMatchObject({ kind: GeneratorErrorKind.SCHEMA_FLOOR });
  });

  it("survives a non-serializable candidate-only failure", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    await expect(
      runWithSchemaFloor({
        schema: Schema,
        label: "floor",
        failureDir: dir,
        attempt: async () => ({ raw: "", parsed: cyclic }),
      }),
    ).rejects.toMatchObject({ kind: GeneratorErrorKind.SCHEMA_FLOOR });
    // Still dumped (with the fallback serialization), not rejected opaquely.
    expect(
      readdirSync(dir).filter((f) => f.endsWith(".failed.json")),
    ).toHaveLength(2);
  });

  it("uses a transport-supplied invalidReason over its own parse error", async () => {
    let feedbackError: string | undefined;
    await expect(
      runWithSchemaFloor({
        schema: Schema,
        label: "floor",
        failureDir: dir,
        attempt: async (feedback) => {
          if (feedback) feedbackError = feedback.error;
          return {
            raw: "some output",
            invalidReason:
              "No structured output for floor (stop_reason=max_tokens).",
          };
        },
      }),
    ).rejects.toThrow(/No structured output for floor/);
    expect(feedbackError).toContain("No structured output for floor");
  });

  it("does not retry when the failed attempt produced no output", async () => {
    let calls = 0;
    await expect(
      runWithSchemaFloor({
        schema: Schema,
        label: "floor",
        failureDir: dir,
        attempt: async () => {
          calls++;
          return { raw: "" };
        },
      }),
    ).rejects.toMatchObject({ kind: GeneratorErrorKind.SCHEMA_FLOOR });
    expect(calls).toBe(1);
  });

  it("lets transport rejections through untouched", async () => {
    const boom = new Error("transport exploded");
    await expect(
      runWithSchemaFloor({
        schema: Schema,
        label: "floor",
        failureDir: dir,
        attempt: async () => {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("hands the failed raw and validation error to the retry attempt", async () => {
    const seen: (string | undefined)[] = [];
    const value = await runWithSchemaFloor({
      schema: Schema,
      label: "floor",
      failureDir: dir,
      attempt: async (feedback) => {
        seen.push(feedback?.raw);
        if (!feedback) return { raw: JSON.stringify({ title: 1 }) };
        expect(feedback.error).toContain("Failed to parse structured output");
        return { raw: JSON.stringify({ title: "fixed" }) };
      },
    });
    expect(value).toEqual({ title: "fixed" });
    expect(seen).toEqual([undefined, JSON.stringify({ title: 1 })]);
  });

  it("classifies pipeline exhaustion as schema-floor with the cause attached", async () => {
    const bad = JSON.stringify({ title: 1 });
    const promise = runWithSchemaFloor({
      schema: Schema,
      label: "floor",
      failureDir: dir,
      attempt: async () => ({ raw: bad }),
    });
    await expect(promise).rejects.toBeInstanceOf(GeneratorError);
    await expect(promise).rejects.toMatchObject({
      kind: GeneratorErrorKind.SCHEMA_FLOOR,
      cause: expect.any(Error),
    });
  });
});
