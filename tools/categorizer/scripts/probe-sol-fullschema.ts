/**
 * One-off probe: run a single eval fixture through the configured generator
 * (openrouter gpt-5.6-sol) and print the raw generation result, success or
 * the full error, without the eval harness's baseline gate. Verifies
 * metadata.raw surfacing on the strict-json_schema 400.
 *
 *   pnpm -C tools/categorizer exec tsx scripts/probe-sol-fullschema.ts
 */
import { generateBrief } from "brief-core";
import { createGenerator, loadGeneratorConfigFile } from "generators";
import { loadCases } from "../eval/loadCase";

function loadEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // key may be in the ambient environment
  }
}

async function main(): Promise<void> {
  loadEnv();
  const loaded = loadGeneratorConfigFile("../../mergebrief.config.yaml");
  if (!loaded.ok) {
    console.error(`config: ${loaded.error.issues.join("; ")}`);
    process.exit(2);
  }
  const constructed = await createGenerator(loaded.value.generator, {
    env: process.env,
    failureDir: "out",
  });
  if (!constructed.ok) {
    console.error(`generator: ${constructed.error.issues.join("; ")}`);
    process.exit(2);
  }
  const cases = await loadCases("eval/cases", "copybutton-new-export");
  if (!cases.ok) {
    console.error(cases.error);
    process.exit(2);
  }
  const probeCase = cases.value[0];
  if (probeCase === undefined) {
    console.error("probe case not found in eval/cases");
    process.exit(2);
  }
  const { fixture } = probeCase;
  console.error("[probe] generating…");
  try {
    const { brief } = await generateBrief({
      pr: fixture.pr,
      headIndex: 1,
      commitRange: fixture.commitRange,
      generator: constructed.value,
      log: (m: string) => console.error(`[progress] ${m}`),
      repoContext: fixture.repoContext,
      effort: loaded.value.generator.effort,
    });
    console.info(JSON.stringify(brief, null, 2).slice(0, 2000));
    console.error("[probe] SUCCESS — full schema accepted");
  } catch (error) {
    console.error("[probe] FAILURE — full error follows:");
    console.error(error);
    process.exit(1);
  }
}

void main();
