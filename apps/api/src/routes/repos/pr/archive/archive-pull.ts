import {
  createTenantRepository,
  type AppDatabase,
  type InboxArchiveStore,
  type PullRequestRowId,
} from "persistence";
import type { Result } from "types/utils";
import type { PullRequestAccess } from "../../../../access/types";
import type { ArchivePullFailure } from "./types";

type ArchiveWrite = (
  archives: InboxArchiveStore,
  access: PullRequestAccess,
) => ReturnType<InboxArchiveStore["set"]>;

/** The row left its scope after the access step read it: absence, as before. */
async function writeArchive(
  handle: AppDatabase,
  access: PullRequestAccess,
  write: ArchiveWrite,
): Promise<Result<PullRequestRowId, ArchivePullFailure>> {
  const { archives } = createTenantRepository(handle, access.rowScope);
  const written = await write(archives, access);
  if (!written.ok) {
    return { ok: false, error: { kind: "not-found" } };
  }
  return { ok: true, value: access.row.id };
}

/** The viewer's own archive of the row; another reviewer's Inbox is untouched. */
export function archivePull(
  handle: AppDatabase,
  access: PullRequestAccess,
): Promise<Result<PullRequestRowId, ArchivePullFailure>> {
  return writeArchive(handle, access, (archives, { row, session }) =>
    archives.set(row.id, session.reviewerId),
  );
}

export function unarchivePull(
  handle: AppDatabase,
  access: PullRequestAccess,
): Promise<Result<PullRequestRowId, ArchivePullFailure>> {
  return writeArchive(handle, access, (archives, { row, session }) =>
    archives.clear(row.id, session.reviewerId),
  );
}
