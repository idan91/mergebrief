import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { GeneratorError, GeneratorErrorKind } from "../src/contract/errors";
import type { Generator } from "../src/contract/generator";
import { GenerationSchema, type Generation } from "../src/contract/provenance";

/**
 * The shared Generator conformance suite (BRIEF-11 testing strategy): every
 * adapter must pass these cases through its own transport fake — stub SDK
 * client for Anthropic, real-process shim binaries for the harness CLIs,
 * fetch-level fixtures for the API adapters. The suite asserts the pipeline
 * BEHAVIOR (schema floor, salvage, retry-once, dump, abort passthrough,
 * provenance), never transport internals.
 */

/** The schema every contract run generates against. */
export const ContractSchema = z.object({
  title: z.string(),
  tags: z.array(z.enum(["bugfix", "new-feature"])),
});

/** Canned payloads the cases feed through the transport. */
export const contractPayloads = {
  valid: JSON.stringify({ title: "t", tags: ["bugfix"] }),
  validParsed: { title: "t", tags: ["bugfix"] },
  /** One out-of-vocabulary token in the droppable `tags` field. */
  salvageable: JSON.stringify({ title: "t", tags: ["bugfix", "scary"] }),
  salvagedParsed: { title: "t", tags: ["bugfix"] },
  /** Structurally invalid (title must be a string) — unsalvageable. */
  invalid: JSON.stringify({ title: 42, tags: [] }),
} as const;

/**
 * One scripted transport turn: a raw model output, an abort-shaped
 * rejection, or a provider refusal (only for harnesses that declare
 * `supportsRefusal` — not every transport has a refusal signal).
 */
export type ContractTurn = { raw: string } | { abort: true } | { refusal: true };

/** What a harness hands back for one scripted generator. */
export interface ContractGeneratorHandle {
  generator: Generator;
  /** Signal to thread into generate() — harnesses that abort supply one. */
  signal?: AbortSignal;
  /** Transport attempts served so far. */
  attempts(): number;
  /**
   * The feedback surface the SECOND attempt saw (retry prompt / feedback
   * turn), serialized; null when no second attempt happened.
   */
  feedbackSeen(): string | null;
}

/** What each adapter provides to run the shared suite against itself. */
export interface GeneratorContractHarness {
  make(
    turns: readonly ContractTurn[],
    failureDir: string,
  ): ContractGeneratorHandle | Promise<ContractGeneratorHandle>;
  /** True when the rejection is this transport's untouched abort shape. */
  isAbortRejection(error: unknown): boolean;
  /** The provenance this adapter must declare at effort "medium". */
  expectedProvenance: Generation;
  /**
   * Whether the transport can script a `{ refusal: true }` turn. CLIs with
   * no in-band refusal signal leave this false and skip the refusal case.
   */
  supportsRefusal?: boolean;
}

function dumps(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".failed.json"));
}

export function describeGeneratorContract(
  name: string,
  makeHarness: () => GeneratorContractHarness,
): void {
  describe(`Generator contract: ${name}`, () => {
    let harness: GeneratorContractHarness;
    let dir: string;

    beforeEach(async () => {
      harness = makeHarness();
      dir = await mkdtemp(join(tmpdir(), "generator-contract-"));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    async function generate(handle: ContractGeneratorHandle) {
      return handle.generator.generate({
        schema: ContractSchema,
        system: "sys",
        user: "usr",
        effort: "medium",
        label: "contract",
        salvageFields: ["tags"],
        ...(handle.signal ? { signal: handle.signal } : {}),
      });
    }

    it("passes valid output through untouched", async () => {
      const handle = await harness.make([{ raw: contractPayloads.valid }], dir);
      await expect(generate(handle)).resolves.toEqual(
        contractPayloads.validParsed,
      );
      expect(handle.attempts()).toBe(1);
      expect(dumps(dir)).toHaveLength(0);
    });

    it("salvages a droppable enum slip without a second attempt", async () => {
      const handle = await harness.make(
        [{ raw: contractPayloads.salvageable }],
        dir,
      );
      await expect(generate(handle)).resolves.toEqual(
        contractPayloads.salvagedParsed,
      );
      expect(handle.attempts()).toBe(1);
      // Salvage is a recovery, not a failure — nothing may be dumped.
      expect(dumps(dir)).toHaveLength(0);
    });

    it("retries exactly once with the failed output as feedback", async () => {
      const handle = await harness.make(
        [{ raw: contractPayloads.invalid }, { raw: contractPayloads.valid }],
        dir,
      );
      await expect(generate(handle)).resolves.toEqual(
        contractPayloads.validParsed,
      );
      expect(handle.attempts()).toBe(2);
      const feedback = handle.feedbackSeen();
      expect(feedback).not.toBeNull();
      expect(feedback).toContain(contractPayloads.invalid);
      // Pin the shared retry wording (schemaFeedbackMessage), not just a
      // fragment: preamble + full closing instruction.
      expect(feedback).toContain("Your previous response failed schema validation:");
      expect(feedback).toContain(
        "Produce the corrected JSON object conforming exactly to the schema. " +
          "Use ONLY tokens from the closed vocabularies — never invent a token.",
      );
      // The failed FIRST attempt is dumped even though the retry recovered.
      const files = dumps(dir);
      expect(files).toHaveLength(1);
      const first = files[0];
      if (!first) throw new Error("expected a dump file");
      const dumped: unknown = JSON.parse(readFileSync(join(dir, first), "utf8"));
      expect(dumped).toMatchObject({ raw: contractPayloads.invalid });
    });

    it("throws a schema-floor GeneratorError with both attempts dumped", async () => {
      const handle = await harness.make(
        [{ raw: contractPayloads.invalid }, { raw: contractPayloads.invalid }],
        dir,
      );
      const promise = generate(handle);
      await expect(promise).rejects.toBeInstanceOf(GeneratorError);
      await expect(promise).rejects.toMatchObject({
        kind: GeneratorErrorKind.SCHEMA_FLOOR,
      });
      await expect(promise).rejects.toThrow(/raw output saved to/);
      expect(handle.attempts()).toBe(2);
      const files = dumps(dir);
      expect(files).toHaveLength(2);
      for (const file of files) {
        // Label-prefixed name and the exact {error, raw} shape — no extra
        // fields, raw byte-identical to the failed output.
        expect(file).toMatch(/^contract-/);
        const dumped: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
        if (typeof dumped !== "object" || dumped === null || Array.isArray(dumped)) {
          throw new Error(`dump ${file} is not an object`);
        }
        expect(Object.keys(dumped).toSorted()).toEqual(["error", "raw"]);
        expect(dumped).toMatchObject({
          raw: contractPayloads.invalid,
          error: expect.stringContaining("Failed to parse structured output"),
        });
      }
    });

    it("fails a no-output attempt once: schema-floor, no retry, dumped", async () => {
      const handle = await harness.make([{ raw: "" }], dir);
      await expect(generate(handle)).rejects.toMatchObject({
        kind: GeneratorErrorKind.SCHEMA_FLOOR,
      });
      expect(handle.attempts()).toBe(1);
      const files = dumps(dir);
      expect(files).toHaveLength(1);
      const first = files[0];
      if (!first) throw new Error("expected a dump file");
      const dumped: unknown = JSON.parse(readFileSync(join(dir, first), "utf8"));
      expect(dumped).toMatchObject({ raw: "" });
    });

    it("classifies a provider refusal: kind refusal, no retry, no dump", async (ctx) => {
      if (!harness.supportsRefusal) {
        ctx.skip();
        return;
      }
      const handle = await harness.make([{ refusal: true }], dir);
      const promise = generate(handle);
      await expect(promise).rejects.toBeInstanceOf(GeneratorError);
      await expect(promise).rejects.toMatchObject({
        kind: GeneratorErrorKind.REFUSAL,
      });
      expect(handle.attempts()).toBe(1);
      expect(dumps(dir)).toHaveLength(0);
    });

    it("propagates an abort untouched: no retry, no dump", async () => {
      const handle = await harness.make([{ abort: true }], dir);
      const caught = await generate(handle).then(
        () => {
          throw new Error("expected the aborted generation to reject");
        },
        (error: unknown) => error,
      );
      expect(harness.isAbortRejection(caught)).toBe(true);
      expect(handle.attempts()).toBe(1);
      expect(dumps(dir)).toHaveLength(0);
    });

    it("declares provenance matching the Generation schema", async () => {
      const handle = await harness.make([{ raw: contractPayloads.valid }], dir);
      const provenance = handle.generator.provenance("medium");
      expect(provenance).toEqual(harness.expectedProvenance);
      expect(GenerationSchema.safeParse(provenance).success).toBe(true);
    });
  });
}
