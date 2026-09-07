// Every session write names a brief span; missing span flags exit 2.
// Keep validation server-owned and receipts verbatim; payload flags remain exclusive with -F.
import type { ApiClient } from "../../client";
import type { ReadIo } from "../read";
import { spanQuery, type BriefSpan } from "../write";

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
  UpdateDraftInput,
} from "./types";

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
  if (io.json) {
    io.stdout(response.bodyText); // verbatim receipt
    return;
  }
  io.stdout(`${response.bodyText}\n`);
}
