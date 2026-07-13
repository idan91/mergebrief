// The drain side of the job-payload handshake (see `GenerateJobPayload` in
// the shared `types` package): `persistence/src/stores/ingest.ts` serializes
// `{ installation_id, pull_request_id, head_sha }` with STRING ids (JSON
// cannot carry bigint); this boundary Zod-validates the untrusted job row
// back into branded ids. Anything that doesn't parse is a poisoned/foreign
// job, not a transient failure — callers drop it rather than retry.
import {
  isPullRequestRowId,
  parseTenantContext,
  type PullRequestRowId,
  type TenantContext,
} from "persistence";
import { z } from "zod";
import type { GenerateJobPayload, Result } from "types";

export interface ParsedGeneratePayload {
  readonly ctx: TenantContext;
  readonly pullRequestId: PullRequestRowId;
  readonly headSha: string;
}

/** Shape check only; branding happens below via the persistence guards. */
const RawPayloadSchema = z.object({
  installation_id: z.string().regex(/^\d+$/, "installation_id must be a numeric string"),
  pull_request_id: z.string().regex(/^\d+$/, "pull_request_id must be a numeric string"),
  head_sha: z.string().min(1, "head_sha must not be empty"),
});

/**
 * Compile-time pin: every `GenerateJobPayload` (the shared enqueue-side
 * contract) must be valid INPUT to this schema — if the contract gains or
 * renames a field, this line breaks the build here, next to the parser that
 * must follow it.
 */
type ContractIsParseable = GenerateJobPayload extends z.input<typeof RawPayloadSchema>
  ? true
  : never;
const CONTRACT_PIN: ContractIsParseable = true;
void CONTRACT_PIN;

/**
 * Validate an untrusted graphile job payload into branded worker inputs.
 * Never throws; a malformed payload is an expected (drop-the-job) failure.
 */
export function parseGeneratePayload(payload: unknown): Result<ParsedGeneratePayload, string> {
  const raw = RawPayloadSchema.safeParse(payload);
  if (!raw.success) {
    return { ok: false, error: raw.error.issues.map((i) => i.message).join("; ") };
  }
  let ctx: TenantContext;
  try {
    ctx = parseTenantContext({ installation_id: raw.data.installation_id });
  } catch {
    return { ok: false, error: "installation_id is not a valid installation id" };
  }
  const prId = BigInt(raw.data.pull_request_id);
  if (!isPullRequestRowId(prId)) {
    return { ok: false, error: "pull_request_id is not a valid pull_request row id" };
  }
  return {
    ok: true,
    value: { ctx, pullRequestId: prId, headSha: raw.data.head_sha },
  };
}
