/**
 * Live smoke: does every structured-output schema the `anthropic` adapter can
 * send compile at the API? Spends money and needs ANTHROPIC_API_KEY; never run
 * it in vitest or CI. Each variant goes out as the adapter sends it, with a
 * tiny output cap: any answer means it compiled, a 400 means it did not.
 * Exit codes: 0 = every variant compiled, 2 = a variant was refused, 1 = setup.
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
  GroupingWithMediaGenerationSchema,
  RevisionNarrativeGenerationSchema,
} from "brief-core/types";

const DEFAULT_MODEL = "claude-opus-5-5";
const SMOKE_MAX_TOKENS = 16;
const EXIT_SETUP = 1;
const EXIT_REFUSED = 2;
const CUSTOM_ATTRIBUTE = "example-attribute";

const WIRE_VARIANTS: readonly (readonly [string, z.ZodType])[] = [
  ["brief", BriefGenerationSchema],
  ["custom brief", briefGenerationSchemaWith([CUSTOM_ATTRIBUTE])],
  ["media brief", briefGenerationSchemaWith([], true)],
  ["custom media brief", briefGenerationSchemaWith([CUSTOM_ATTRIBUTE], true)],
  ["grouping", GroupingGenerationSchema],
  ["media grouping", GroupingWithMediaGenerationSchema],
  ["detail", DetailGenerationSchema],
  ["custom detail", detailGenerationSchemaWith([CUSTOM_ATTRIBUTE])],
  ["delta", DeltaBriefGenerationSchema],
  ["revision narrative", RevisionNarrativeGenerationSchema],
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

interface VariantOutcome {
  compiled: boolean;
  line: string;
}

/** A 400 is the API refusing the schema; any other failure ends the smoke. */
async function sendVariant(
  client: Anthropic,
  model: string,
  [name, schema]: readonly [string, z.ZodType],
): Promise<VariantOutcome> {
  try {
    const response = await client.messages.create({
      model,
      max_tokens: SMOKE_MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: {
        format: {
          type: "json_schema",
          schema: enumPreservingJsonSchema(schema),
        },
        effort: "low",
      },
      messages: [{ role: "user", content: "Answer with any valid object." }],
    });
    return {
      compiled: true,
      line: `ok       ${name} (stop: ${response.stop_reason})`,
    };
  } catch (error) {
    if (error instanceof BadRequestError) {
      return { compiled: false, line: `REFUSED  ${name}: ${error.message}` };
    }
    throw error;
  }
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
    WIRE_VARIANTS.map((variant) => sendVariant(client, model, variant)),
  );
  for (const outcome of outcomes) {
    console.info(outcome.line);
  }

  const refused = outcomes.filter((outcome) => !outcome.compiled).length;
  console.info(
    `\n${WIRE_VARIANTS.length - refused} compiled, ${refused} refused`,
  );
  return refused === 0 ? 0 : EXIT_REFUSED;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(EXIT_SETUP);
  });
