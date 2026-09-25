// Hono-free. The row is looked up in the resolved world, then the
// reviewer's archive is set or cleared through the tenant-scoped store.
import {
  createTenantRepository,
  type PullRequestRowId,
  type TenantRepository,
} from "persistence";
import type { Result } from "types/utils";
import type {
  ArchiveControllerDeps,
  ArchivePullFailure,
  ArchivePullInput,
} from "./types";

type ArchivePullResult = Result<
  { readonly pullRequestId: PullRequestRowId },
  ArchivePullFailure
>;

const NOT_FOUND: ArchivePullResult = {
  ok: false,
  error: { kind: "not-found" },
};

type ArchiveWrite = (
  tenant: TenantRepository,
  pullRequestId: PullRequestRowId,
) => Promise<{ readonly ok: boolean }>;

async function writeArchive(
  deps: ArchiveControllerDeps,
  input: ArchivePullInput,
  write: ArchiveWrite,
): Promise<ArchivePullResult> {
  const tenant = createTenantRepository(deps.handle, input.ctx);
  const row = await tenant.pullRequests.getByNumber(
    input.repoId,
    input.prNumber,
  );
  if (row === undefined) {
    return NOT_FOUND;
  }

  const written = await write(tenant, row.id);
  if (!written.ok) {
    return NOT_FOUND;
  }
  return { ok: true, value: { pullRequestId: row.id } };
}

function archivePull(
  deps: ArchiveControllerDeps,
  input: ArchivePullInput,
): Promise<ArchivePullResult> {
  return writeArchive(deps, input, (tenant, pullRequestId) =>
    tenant.archives.set(pullRequestId, input.reviewerId),
  );
}

function unarchivePull(
  deps: ArchiveControllerDeps,
  input: ArchivePullInput,
): Promise<ArchivePullResult> {
  return writeArchive(deps, input, (tenant, pullRequestId) =>
    tenant.archives.clear(pullRequestId, input.reviewerId),
  );
}

export const archiveController = { archivePull, unarchivePull };
