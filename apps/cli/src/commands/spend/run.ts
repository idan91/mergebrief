// `spend`: the Instance's started runs today against its daily cap, for its
// Operators. Passthrough under --json; the TTY line reads only what it prints.
import { ProductOperations, ProductQueryIds } from "contract";
import { z } from "zod/v4";
import type { ApiClient } from "../../client";
import { CliError, ExitCodes } from "../../exit";
import type { CommandIo } from "../../types";

const spendSliceSchema = z.object({
  startedRuns: z.number(),
  cap: z.number().optional(),
});

type SpendSlice = z.infer<typeof spendSliceSchema>;

function parseSpendSlice(bodyText: string): SpendSlice {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(bodyText);
  } catch {
    parsedJson = undefined;
  }
  const slice = spendSliceSchema.safeParse(parsedJson);
  if (!slice.success) {
    throw new CliError(
      ExitCodes.GENERIC,
      "the server's spend response did not match the documented shape (version skew? check `mergebrief auth status`)",
    );
  }
  return slice.data;
}

/** `37 of 50 runs started today · resets at 00:00 UTC`, or `... · no daily cap`. */
export function formatSpendLine(slice: SpendSlice): string {
  if (slice.cap === undefined) {
    const uncapped = `${slice.startedRuns} runs started today · no daily cap\n`;
    return uncapped;
  }
  const capped = `${slice.startedRuns} of ${slice.cap} runs started today · resets at 00:00 UTC\n`;
  return capped;
}

export async function runSpend(
  client: ApiClient,
  io: CommandIo,
): Promise<void> {
  const response = await client.request({
    path: ProductOperations[ProductQueryIds.READ_SPEND].path,
  });
  if (io.json) {
    io.stdout(response.bodyText);
    return;
  }
  const slice = parseSpendSlice(response.bodyText);
  const line = formatSpendLine(slice);
  io.stdout(line);
}
