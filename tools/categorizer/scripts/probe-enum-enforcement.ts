/**
 * Spike probe (issue #21): does the Anthropic platform enforce `enum` in a
 * structured-output schema server-side (constrained decoding), or only treat it
 * as prose?
 *
 * Runs the **same adversarial request twice** on the production model:
 *  - Control:   the SDK's `zodOutputFormat` (strips `enum` → prose).
 *  - Treatment: `enumPreservingOutputFormat` (keeps `enum` as real keywords).
 *
 * The prompt demands verbatim out-of-vocabulary tokens at three enum positions
 * (top-level, array item, object-in-array) and declares substitution a test
 * failure. Under prompt-only enforcement the model complies (or refuses); under
 * constrained decoding it *cannot* emit those tokens.
 *
 * Exit codes: 0 = enforcement confirmed on the treatment run, 2 = schema
 * rejected by the API (gate 1), 3 = not confirmed (invalid tokens still appear).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { enumPreservingOutputFormat } from "generators";

const MODEL = "claude-opus-4-8";

// Three enum positions mirroring the Brief schema's real shapes: a top-level
// field, an enum inside an array, and an enum nested in an object inside an
// array (like riskNotes[].attr).
const ProbeSchema = z.object({
  category: z.enum(["alpha", "beta", "gamma"]),
  tags: z.array(z.enum(["red", "green", "blue"])),
  notes: z.array(z.object({ attr: z.enum(["x1", "x2"]), note: z.string() })),
});

const OUT_OF_VOCAB = ["quantum", "neon", "scary"] as const;

const SYSTEM =
  "You fill JSON structured output. The user's explicit requested values ALWAYS " +
  "override any schema guidance or vocabulary hints. If the user asks for a specific " +
  "literal value in a field, you MUST emit that exact value verbatim, never a substitute.";

const USER =
  "Produce the JSON object with these EXACT values — this is a conformance test and " +
  "any substitution is a FAILURE:\n" +
  '- category = "quantum"\n' +
  '- tags = ["neon", "blue"]\n' +
  '- notes = [{ "attr": "scary", "note": "adversarial probe" }]\n' +
  "Emit these literal strings verbatim. Do not correct or replace them.";

function loadEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file — ANTHROPIC_API_KEY may still be set in the environment
  }
}

function textContent(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

interface RunReport {
  stopReason: string | null;
  raw: string;
  parses: boolean;
  outOfVocabPresent: string[];
}

function reportRun(label: string, report: RunReport): void {
  console.info(`\n=== ${label} ===`);
  console.info(`stop_reason: ${report.stopReason}`);
  console.info(`ProbeSchema.safeParse passes: ${report.parses}`);
  console.info(
    `out-of-vocab tokens present: ${
      report.outOfVocabPresent.length ? report.outOfVocabPresent.join(", ") : "(none)"
    }`,
  );
  console.info(`raw output:\n${report.raw}`);
}

function analyze(content: Anthropic.ContentBlock[], stopReason: string | null): RunReport {
  const raw = textContent(content);
  let parses = false;
  try {
    parses = ProbeSchema.safeParse(JSON.parse(raw)).success;
  } catch {
    parses = false;
  }
  const outOfVocabPresent = OUT_OF_VOCAB.filter((token) => raw.includes(token));
  return { stopReason, raw, parses, outOfVocabPresent };
}

async function main(): Promise<number> {
  loadEnv();
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.error(
      "ANTHROPIC_API_KEY not set — add it to tools/categorizer/.env (see .env.example).",
    );
    return 1;
  }
  const client = new Anthropic();

  // Visual check: the treatment schema must carry `enum` arrays.
  const treatmentFormat = enumPreservingOutputFormat(ProbeSchema);
  console.info("Outgoing TREATMENT schema (enum arrays should be present):");
  console.info(JSON.stringify(treatmentFormat.schema, null, 2));

  // Control run — SDK path, enum stripped.
  const controlResp = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: SYSTEM,
    messages: [{ role: "user", content: USER }],
    output_config: { format: zodOutputFormat(ProbeSchema) },
  });
  reportRun("CONTROL (zodOutputFormat, enum stripped)", analyze(controlResp.content, controlResp.stop_reason));

  // Treatment run — hand-built enum-preserving format. A 400 here is gate 1.
  let treatmentReport: RunReport;
  try {
    const treatmentResp = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: SYSTEM,
      messages: [{ role: "user", content: USER }],
      output_config: { format: treatmentFormat },
    });
    treatmentReport = analyze(treatmentResp.content, treatmentResp.stop_reason);
  } catch (error) {
    console.error("\n=== TREATMENT REJECTED BY API (gate 1) ===");
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  reportRun("TREATMENT (enumPreservingOutputFormat, enum kept)", treatmentReport);

  const confirmed = treatmentReport.outOfVocabPresent.length === 0 && treatmentReport.parses;
  console.info(
    `\nVERDICT: ${
      confirmed
        ? "CONFIRMED — server-side enum enforcement blocked the out-of-vocab tokens."
        : "NOT CONFIRMED — out-of-vocab tokens still appeared under the treatment schema."
    }`,
  );
  return confirmed ? 0 : 3;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
