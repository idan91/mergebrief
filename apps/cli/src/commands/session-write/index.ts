// Every session write names a brief span; missing span flags exit 2.
// Keep validation server-owned and receipts verbatim; payload flags remain exclusive with -F.
import { ProductOperations, type ProductActionId } from "contract";
import type { ApiClient } from "../../client";
import type { ReadIo } from "../read";
import { buildRequestPath } from "../request-path";
import { spanQuery, type BriefSpan } from "../write";
import type { SessionOperation } from "./types";

export {
  buildCreateDraftPayload,
  buildReanchorPayload,
  buildRiskPayload,
  buildUpdateDraftPayload,
  resolveReadFlag,
} from "./utils";
export type {
  AnchorFlags,
  CreateDraftInput,
  ReanchorInput,
  RiskOperationId,
  SessionOperation,
  UpdateDraftInput,
} from "./types";

/** The receipt verbatim; a success that carries no body prints nothing. */
function relayReceipt(bodyText: string, io: ReadIo): void {
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
  io: ReadIo,
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

/** `chunk-read`'s own request, until it splits into a pair of operations. */
export async function runSessionWrite(
  client: ApiClient,
  options: {
    readonly method: "POST" | "PATCH" | "PUT" | "DELETE";
    readonly repoId: string;
    readonly prNumber: number;
    /** Path under `…/session`. */
    readonly subpath: string;
    readonly span: BriefSpan;
    readonly payload?: unknown;
  },
  io: ReadIo,
): Promise<void> {
  const path = `/api/repos/${options.repoId}/pulls/${options.prNumber}/session${options.subpath}${spanQuery(options.span)}`;
  const response = await client.request(
    options.payload === undefined
      ? { method: options.method, path }
      : { method: options.method, path, body: options.payload },
  );
  relayReceipt(response.bodyText, io);
}
