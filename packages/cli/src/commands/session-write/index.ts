// The session-authoring writes: `draft create|update|reanchor|delete` and
// `chunk-read` — thin requests over the server's locked validation, each
// naming its brief span (`requireSpan`, exit 2). This file holds the main
// act — `runSessionWrite`, the one wire call every session write goes
// through; `utils.ts` assembles payloads (convenience flags XOR `-F`, the
// `submit` pattern); `types.ts` the shapes. Receipts pass through VERBATIM.
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
