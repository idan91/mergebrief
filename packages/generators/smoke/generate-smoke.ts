/**
 * Manual live adapter smoke spends money and needs credentials; never run it in vitest or CI.
 * Use pnpm -C packages/generators smoke -- --adapter <name> or --config <path>.
 * Paths resolve from packages/generators; failures, including schema violations, exit nonzero.
 */
import { z } from "zod/v4";
import { createGenerator } from "../src/config/registry";
import { loadGeneratorConfigFile } from "../src/config/loader";

/** The generator block the `--adapter` flags assemble in place of a config file. */
interface SmokeGeneratorConfig {
  provider: string;
  model?: string;
  command?: string;
}

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
    "usage: pnpm -C packages/generators smoke -- --adapter <anthropic|claude-code|codex|cursor|openai|openrouter> [--model <id>] [--command <path>]\n" +
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
    const flagConfig: SmokeGeneratorConfig = { provider: adapter };

    if (model) flagConfig.model = model;
    if (command) flagConfig.command = command;

    generatorConfig = flagConfig;
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
  // Any throw here, schema floor, auth, timeout, is a FAILED smoke.
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
  // Origin prints AFTER generation: run-time capability discovery
  // (openai's effort-knob 400 sniff) can change it mid-run.
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  console.error(`[smoke] origin: ${JSON.stringify(generator.origin("low"))}`);
  console.error(`[smoke] OK in ${seconds}s — schema-valid output received`);
}

main().catch((error: unknown) => {
  console.error(
    `[smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
