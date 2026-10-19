// `generation <n>`: the current head's claims against the claim limit, its
// last stored failure and its takeover job. Passthrough under --json; the
// TTY line reads only the fields it prints.
import { ProductQueryIds } from "contract";
import { z } from "zod/v4";
import type { ApiClient } from "../../client";
import { CliError, ExitCodes } from "../../exit";
import type { CommandIo } from "../../types";
import { buildRequestPath } from "../request-path";

const SHORT_SHA_LENGTH = 7;

const claimsSliceSchema = z.object({
  generation: z
    .object({
      headSha: z.string(),
      status: z.string(),
      claims: z.number(),
      claimLimit: z.number(),
      exhausted: z.boolean(),
      errorCode: z.string().optional(),
      takeover: z
        .object({ state: z.string(), runsAt: z.string().optional() })
        .optional(),
    })
    .optional(),
});

type ClaimsSlice = z.infer<typeof claimsSliceSchema>;

function parseClaimsSlice(bodyText: string): ClaimsSlice {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(bodyText);
  } catch {
    parsedJson = undefined;
  }
  const slice = claimsSliceSchema.safeParse(parsedJson);
  if (!slice.success) {
    throw new CliError(
      ExitCodes.GENERIC,
      "the server's generation response did not match the documented shape (version skew? check `mergebrief auth status`)",
    );
  }
  return slice.data;
}

/** One line per head: `PR 7 · head abc1234 · failed · claims 3 of 3 · exhausted · ...`. */
export function formatClaimsLine(prNumber: number, slice: ClaimsSlice): string {
  const generation = slice.generation;
  if (generation === undefined) {
    const noBrief = `PR ${prNumber} · no brief queued yet\n`;
    return noBrief;
  }

  const parts = [
    `PR ${prNumber}`,
    `head ${generation.headSha.slice(0, SHORT_SHA_LENGTH)}`,
    generation.status,
    `claims ${generation.claims} of ${generation.claimLimit}`,
  ];
  if (generation.exhausted) {
    parts.push("exhausted");
  }
  if (generation.errorCode !== undefined) {
    parts.push(`last failure ${generation.errorCode}`);
  }
  if (generation.takeover !== undefined) {
    const runsAt = generation.takeover.runsAt;
    const when = runsAt === undefined ? "" : ` at ${runsAt}`;
    parts.push(`takeover ${generation.takeover.state}${when}`);
  }
  const line = `${parts.join(" · ")}\n`;
  return line;
}

export async function runGenerationClaims(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  io: CommandIo,
): Promise<void> {
  const response = await client.request({
    path: buildRequestPath(ProductQueryIds.READ_GENERATION_CLAIMS, {
      repoId,
      prNumber,
    }),
  });
  if (io.json) {
    io.stdout(response.bodyText);
    return;
  }
  const slice = parseClaimsSlice(response.bodyText);
  const line = formatClaimsLine(prNumber, slice);
  io.stdout(line);
}
