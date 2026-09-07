// The drain side of the job-payload handshake (`GenerateJobPayload` in the
// shared `types` package): the ingest serializer writes STRING ids (JSON
// cannot carry bigint); this boundary Zod-validates the untrusted job row
// back into branded ids. Anything that doesn't parse is a poisoned/foreign
// job, not a transient failure — callers drop it rather than retry.
import {
  isGrantRowId,
  isPullRequestRowId,
  parseScopeContext,
  type GrantRowId,
  type OwnerContext,
  type PullRequestRowId,
  type TenantContext,
} from "persistence";
import { z } from "zod";
import type { GenerateJobPayload, Result } from "types";

/** What both job shapes carry: which PR, at which head. */
interface GeneratePayloadTarget {
  readonly pullRequestId: PullRequestRowId;
  readonly headSha: string;
}

/** An App-installation job: tenant ctx, no credential reference. */
export interface TenantGeneratePayload extends GeneratePayloadTarget {
  readonly ctx: TenantContext;
  readonly grantId?: undefined;
}

/** A url-box job: owner ctx plus the grant the worker resolves lazily. */
export interface OwnerGeneratePayload extends GeneratePayloadTarget {
  readonly ctx: OwnerContext;
  readonly grantId: GrantRowId;
}

/** Discriminated on `grantId`. */
export type ParsedGeneratePayload =
  | TenantGeneratePayload
  | OwnerGeneratePayload;

const buildNumericStringSchema = (label: string) =>
  z.string().regex(/^\d+$/, `${label} must be a numeric string`);

/** Shape check only; branding happens below via the persistence guards. */
const RawPayloadSchema = z.union([
  z.object({
    installation_id: buildNumericStringSchema("installation_id"),
    pull_request_id: buildNumericStringSchema("pull_request_id"),
    head_sha: z.string().min(1, "head_sha must not be empty"),
  }),
  z.object({
    owner_user_id: buildNumericStringSchema("owner_user_id"),
    grant_id: buildNumericStringSchema("grant_id"),
    pull_request_id: buildNumericStringSchema("pull_request_id"),
    head_sha: z.string().min(1, "head_sha must not be empty"),
  }),
]);

/**
 * Compile-time pin: every `GenerateJobPayload` (the shared enqueue-side
 * contract) must be valid INPUT to this schema — if the contract gains or
 * renames a field, this line breaks the build here, next to the parser that
 * must follow it.
 */
type ContractIsParseable =
  GenerateJobPayload extends z.input<typeof RawPayloadSchema> ? true : never;
const CONTRACT_PIN: ContractIsParseable = true;
void CONTRACT_PIN;

function parseTenantPayload(
  installationId: string,
  target: GeneratePayloadTarget,
): Result<TenantGeneratePayload, string> {
  let ctx;
  try {
    ctx = parseScopeContext({ installation_id: installationId });
  } catch {
    return {
      ok: false,
      error: "installation_id is not a valid installation id",
    };
  }

  if ("ownerUserId" in ctx) {
    // Unreachable with the schema above; guards the narrowing honestly.
    return { ok: false, error: "installation payload parsed as owner" };
  }

  return { ok: true, value: { ...target, ctx } };
}

function parseOwnerPayload(
  ownerUserId: string,
  rawGrantId: string,
  target: GeneratePayloadTarget,
): Result<OwnerGeneratePayload, string> {
  const grantId = BigInt(rawGrantId);
  if (!isGrantRowId(grantId)) {
    return { ok: false, error: "grant_id is not a valid grant row id" };
  }

  let ctx;
  try {
    ctx = parseScopeContext({ owner_user_id: ownerUserId });
  } catch {
    return { ok: false, error: "owner_user_id is not a valid user id" };
  }

  if ("installationId" in ctx) {
    return { ok: false, error: "owner payload parsed as installation" };
  }

  return { ok: true, value: { ...target, ctx, grantId } };
}

/**
 * Validate an untrusted graphile job payload into branded worker inputs.
 * Never throws; a malformed payload is an expected (drop-the-job) failure.
 */
export function parseGeneratePayload(
  payload: unknown,
): Result<ParsedGeneratePayload, string> {
  const raw = RawPayloadSchema.safeParse(payload);
  if (!raw.success) {
    return {
      ok: false,
      error: raw.error.issues.map((i) => i.message).join("; "),
    };
  }

  const pullRequestId = BigInt(raw.data.pull_request_id);
  if (!isPullRequestRowId(pullRequestId)) {
    return {
      ok: false,
      error: "pull_request_id is not a valid pull_request row id",
    };
  }

  const target: GeneratePayloadTarget = {
    pullRequestId,
    headSha: raw.data.head_sha,
  };

  if ("installation_id" in raw.data) {
    return parseTenantPayload(raw.data.installation_id, target);
  }

  return parseOwnerPayload(raw.data.owner_user_id, raw.data.grant_id, target);
}
