import type { ChunkReadInput } from "persistence";
import type { PullRequestAccess } from "../../../../access/types";
import { openSessionWrite } from "./logic/session-writes";
import type {
  SetChunkReadRequest,
  SessionRequestResult,
  SessionStoreDeps,
} from "./types";

/**
 * One operation carrying a boolean, not a mark/unmark pair: a retry is the
 * same action again, and both halves are idempotent.
 */
export async function setChunkRead(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  request: SetChunkReadRequest,
): Promise<SessionRequestResult<ChunkReadInput>> {
  const session = await openSessionWrite(deps, access, request.span);
  if (!session.ok) {
    return session;
  }

  return session.value.work.setChunkRead(request.chunkRead);
}
