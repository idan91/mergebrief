// Every session write names a brief span; missing span flags exit 2.
// Keep validation server-owned and receipts verbatim; payload flags remain exclusive with -F.
import { ProductOperations, type ProductActionId } from "contract";
import type { ApiClient } from "../../client";
import type { CommandIo } from "../../types";
import { buildRequestPath } from "../request-path";
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
