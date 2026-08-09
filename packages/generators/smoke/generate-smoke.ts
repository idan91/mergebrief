/**
 * Manual live smoke for generator adapters (BRIEF-11 PR 11). ONE real
 * `generate()` against a real backend with a tiny schema; prints the origin stamp
 * and the output; exits nonzero on any failure (a schema-floor violation
 * included). NEVER wired into vitest or CI — it spends money and needs
 * live auth (see docs/dev/generator-smoke-recipe.md for when to run it).
 *
 *   pnpm -C packages/generators smoke -- --adapter anthropic
 *   pnpm -C packages/generators smoke -- --adapter claude-code
 *   pnpm -C packages/generators smoke -- --adapter codex
 *   pnpm -C packages/generators smoke -- --adapter openai --model gpt-5.2
 *   pnpm -C packages/generators smoke -- --adapter openrouter --model anthropic/claude-sonnet-5
 *   pnpm -C packages/generators smoke -- --config ../../mergebrief.config.yaml
 *   (paths resolve relative to packages/generators because of -C)
 */
import { z } from "zod/v4";
import { createGenerator } from "../src/config/registry";
import { loadGeneratorConfigFile } from "../src/config/loader";

const SmokeSchema = z.object({
  greeting: z.string(),
  tags: z.array(z.enum(["friendly", "formal"])),
});

/** Absent flag → undefined; present-without-a-value → usage (exit 2). */
function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) usage();
  return value;
}

function usage(): never {
  console.error(
    "usage: pnpm -C packages/generators smoke -- --adapter <anthropic|claude-code|codex|openai|openrouter> [--model <id>] [--command <path>]\n" +
      "       pnpm -C packages/generators smoke -- --config <mergebrief.config.yaml>",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const configPath = flagValue(args, "--config");
  const adapter = flagValue(args, "--adapter");

  let generatorConfig: unknown;
  if (configPath !== undefined) {
    const loaded = loadGeneratorConfigFile(configPath);
    if (!loaded.ok) {
      console.error(`config: ${loaded.error.issues.join("; ")}`);
      process.exit(1);
    }
    generatorConfig = loaded.value.generator;
  } else if (adapter !== undefined) {
    const model = flagValue(args, "--model");
    const command = flagValue(args, "--command");
    generatorConfig = {
      provider: adapter,
      ...(model ? { model } : {}),
      ...(command ? { command } : {}),
    };
  } else {
    usage();
  }

  const constructed = await createGenerator(generatorConfig, {
    env: process.env,
    failureDir: "out",
    log: (message) => console.error(`[smoke] ${message}`),
  });
  if (!constructed.ok) {
    console.error(`boot refused: ${constructed.error.issues.join("; ")}`);
    process.exit(1);
  }
  const generator = constructed.value;

  const started = Date.now();
  // Any throw here — schema floor, auth, timeout — is a FAILED smoke.
  const output = await generator.generate({
    schema: SmokeSchema,
    system:
      "You produce tiny JSON greetings for a smoke test. Output only the JSON object.",
    user: 'Greet the MergeBrief smoke test. Use only tags from ["friendly","formal"].',
    effort: "low",
    label: "smoke",
    salvageFields: ["tags"],
    log: (message) => console.error(`[smoke] ${message}`),
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  // stdout carries the payload (pipeable); progress/status ride stderr.
  // Provenance prints AFTER generation: run-time capability discovery
  // (openai's effort-knob 400 sniff) can change it mid-run.
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  console.error(
    `[smoke] provenance: ${JSON.stringify(generator.provenance("low"))}`,
  );
  console.error(`[smoke] OK in ${seconds}s — schema-valid output received`);
}

main().catch((error: unknown) => {
  console.error(
    `[smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
