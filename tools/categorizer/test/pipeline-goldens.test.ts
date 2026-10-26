import { fileURLToPath } from "node:url";
import { describePipelineGoldens } from "./pipeline-goldens-suite";

await describePipelineGoldens({
  casesDir: fileURLToPath(new URL("../eval/cases", import.meta.url)),
  pairsDir: fileURLToPath(new URL("../eval/pair-cases", import.meta.url)),
  requiresEveryWarningFamily: true,
});
