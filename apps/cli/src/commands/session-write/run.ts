// Every session write goes to one brief span, which `commands/span` resolves.
// Keep validation server-owned and receipts verbatim; payload flags remain exclusive with -F.
import { ProductOperations, type ProductActionId } from "contract";
import type { ApiClient } from "../../client";
import { CliError } from "../../exit";
import type { CommandIo } from "../../types";
import { buildRequestPath } from "../request-path";
import type { ChunkMarks, SessionOperation } from "./types";

/** The receipt verbatim; a success that carries no body prints nothing. */
function relayReceipt(bodyText: string, io: CommandIo): void {
  if (bodyText === "") {
    return;
  }
  if (io.json) {
    io.stdout(bodyText);
    return;
  }
  io.stdout(`${bodyText}\n`);
}

/** One session operation, its method and path read off the operation table. */
export async function runSessionOperation<Id extends ProductActionId>(
  client: ApiClient,
  operation: SessionOperation<Id>,
  io: CommandIo,
): Promise<void> {
  const path = buildRequestPath(operation.id, operation.params, {
    base: operation.span.base,
    head: operation.span.head,
  });
  const method = ProductOperations[operation.id].method;
  const response = await client.request(
    operation.payload === undefined
      ? { method, path }
      : { method, path, body: operation.payload },
  );
  relayReceipt(response.bodyText, io);
}

/** Where a batch stopped, ahead of the line, whose documented tail stays last; a lone chunk keeps it as is. */
function describeChunkFailure(
  error: unknown,
  chunkId: string,
  done: number,
  total: number,
): unknown {
  const isLoneChunk = total === 1;
  if (isLoneChunk || !(error instanceof CliError)) {
    return error;
  }
  return new CliError(
    error.code,
    `chunk ${chunkId} (${done} of ${total} done before it): ${error.message}`,
  );
}

/** One chunk at a time, stopping at the first failure. A rerun is safe: a mark is idempotent. */
export async function runChunkMarks(
  client: ApiClient,
  { id, repoId, prNumber, span, chunkIds }: ChunkMarks,
  io: CommandIo,
): Promise<void> {
  for (const [done, chunkId] of chunkIds.entries()) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- the first failure stops the rest.
      await runSessionOperation(
        client,
        { id, params: { repoId, prNumber, chunkId }, span },
        io,
      );
    } catch (error) {
      throw describeChunkFailure(error, chunkId, done, chunkIds.length);
    }
  }
}
