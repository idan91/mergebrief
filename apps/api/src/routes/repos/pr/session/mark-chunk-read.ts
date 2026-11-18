import type { ChunkReadInput } from "persistence";
import type { PullRequestAccess } from "../../../../access/types";
import { openSessionWrite } from "./logic/session-writes";
import type {
  MarkChunkRequest,
  SessionRequestResult,
  SessionStoreDeps,
} from "./types";

export async function markChunkRead(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  request: MarkChunkRequest,
): Promise<SessionRequestResult<ChunkReadInput>> {
  const session = await openSessionWrite(deps, access, request.span);
  if (!session.ok) {
    return session;
  }

  return session.value.work.setChunkRead({
    chunkId: request.chunkId,
    read: true,
  });
}
