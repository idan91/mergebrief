/**
 * Live smoke: does every structured-output schema the `anthropic` adapter can
 * send compile at the API, with room to grow? Spends money and needs
 * ANTHROPIC_API_KEY; never run it in vitest or CI. Each variant goes out as the
 * adapter sends it, then again with HEADROOM_FIELDS extra required strings,
 * each with a tiny output cap: any answer means it compiled, a 400 means not.
 * Exit codes: 0 = every variant compiled with headroom, 2 = refused or no
 * headroom, 1 = setup.
 */
import { BadRequestError, type Anthropic } from "@anthropic-ai/sdk";
import type { z } from "zod/v4";
import { createAnthropicClient, enumPreservingJsonSchema } from "generators";
import {
  BriefGenerationSchema,
  briefGenerationSchemaWith,
  DeltaBriefGenerationSchema,
  DetailGenerationSchema,
  detailGenerationSchemaWith,
  GroupingGenerationSchema,
  RevisionNarrativeGenerationSchema,
  SummaryMediaAnswerSchema,
} from "brief-core/types";

const DEFAULT_MODEL = "claude-opus-5-5";
const SMOKE_MAX_TOKENS = 16;
const EXIT_SETUP = 1;
const EXIT_REFUSED = 2;
const CUSTOM_ATTRIBUTE = "example-attribute";
/** The brief fit 8 more required strings and not 12 when this was set: a variant under it is one small field from refusal. */
const HEADROOM_FIELDS = 8;

type WireSchema = Record<string, unknown>;

const WIRE_VARIANTS: readonly (readonly [string, z.ZodType])[] = [
  ["brief", BriefGenerationSchema],
  ["custom brief", briefGenerationSchemaWith([CUSTOM_ATTRIBUTE])],
  ["grouping", GroupingGenerationSchema],
  ["detail", DetailGenerationSchema],
  ["custom detail", detailGenerationSchemaWith([CUSTOM_ATTRIBUTE])],
  ["delta", DeltaBriefGenerationSchema],
  ["revision narrative", RevisionNarrativeGenerationSchema],
  ["summary media", SummaryMediaAnswerSchema],
];

function loadEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file: ANTHROPIC_API_KEY may still be set in the environment
  }
}

function readModelFlag(args: readonly string[]): string {
  const index = args.indexOf("--model");
  return index === -1 ? DEFAULT_MODEL : (args[index + 1] ?? DEFAULT_MODEL);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  const isObject = typeof value === "object" && value !== null;
  return isObject && !Array.isArray(value);
}

function readRequired(wire: WireSchema): string[] {
  const required = wire["required"];
  return Array.isArray(required) ? required.map(String) : [];
}

/** The wire schema with HEADROOM_FIELDS more required string properties at its root. */
function addHeadroomFields(wire: WireSchema): WireSchema {
  const properties = isRecord(wire["properties"]) ? wire["properties"] : {};
  const padded: Record<string, unknown> = { ...properties };
  const names: string[] = [];
  for (let index = 0; index < HEADROOM_FIELDS; index += 1) {
    const name = `headroom${index}`;
    padded[name] = { type: "string" };
    names.push(name);
  }
  return {
    ...wire,
    properties: padded,
    required: [...readRequired(wire), ...names],
  };
}

/** Undefined when the schema compiled; the API's message when it refused one. */
async function sendSchema(
  client: Anthropic,
  model: string,
  schema: WireSchema,
): Promise<string | undefined> {
  try {
    await client.messages.create({
      model,
      max_tokens: SMOKE_MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: {
        format: { type: "json_schema", schema },
        effort: "low",
      },
      messages: [{ role: "user", content: "Answer with any valid object." }],
    });
    return undefined;
  } catch (error) {
    if (error instanceof BadRequestError) {
      return error.message;
    }
    throw error;
  }
}

interface VariantOutcome {
  passed: boolean;
  line: string;
}

/** A 400 is the API refusing the schema; any other failure ends the smoke. */
async function checkVariant(
  client: Anthropic,
  model: string,
  [name, schema]: readonly [string, z.ZodType],
): Promise<VariantOutcome> {
  const wire = enumPreservingJsonSchema(schema);
  const [refusal, headroomRefusal] = await Promise.all([
    sendSchema(client, model, wire),
    sendSchema(client, model, addHeadroomFields(wire)),
  ]);
  if (refusal !== undefined) {
    return { passed: false, line: `REFUSED  ${name}: ${refusal}` };
  }
  if (headroomRefusal !== undefined) {
    return {
      passed: false,
      line: `LOW      ${name}: compiles, but not with ${HEADROOM_FIELDS} more required fields`,
    };
  }
  return {
    passed: true,
    line: `ok       ${name} (and with ${HEADROOM_FIELDS} more fields)`,
  };
}

async function main(): Promise<number> {
  loadEnv();
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY not set: add it to tools/categorizer/.env (see .env.example).",
    );
    return EXIT_SETUP;
  }
  const client = createAnthropicClient({ apiKey });
  const model = readModelFlag(process.argv.slice(2));
  console.info(`Compiling ${WIRE_VARIANTS.length} wire schemas on ${model}`);

  const outcomes = await Promise.all(
    WIRE_VARIANTS.map((variant) => checkVariant(client, model, variant)),
  );
  for (const outcome of outcomes) {
    console.info(outcome.line);
  }

  const failed = outcomes.filter((outcome) => !outcome.passed).length;
  console.info(`\n${WIRE_VARIANTS.length - failed} passed, ${failed} failed`);
  return failed === 0 ? 0 : EXIT_REFUSED;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(EXIT_SETUP);
  });
