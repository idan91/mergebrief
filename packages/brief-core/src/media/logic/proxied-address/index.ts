import { parseAttachmentSource } from "contract/attachments";

import {
  isCommittedFileInRepository,
  isServableCommittedFile,
  parseCommittedFileUrl,
} from "../../../media-address";
import { ProxiedMediaSourceKinds, type ProxiedMediaSource } from "./types";

/**
 * What the API's same-origin proxy serves at `address`: a pasted attachment,
 * or a file committed to `repoSlug` in a format the committed-file read
 * serves. The page's proxy step and its keep-a-player check both read this
 * one decision.
 */
export function readProxiedMediaSource(
  address: string,
  repoSlug: string | undefined,
): ProxiedMediaSource | undefined {
  const attachment = parseAttachmentSource(address);
  if (attachment.ok) {
    const kind = ProxiedMediaSourceKinds.ATTACHMENT;
    return { kind, attachment: attachment.value };
  }
  const committed = parseCommittedFileUrl(address);
  if (repoSlug === undefined || !committed.ok) {
    return undefined;
  }
  const file = committed.value;
  const isServedFile =
    isServableCommittedFile(file) &&
    isCommittedFileInRepository(file, repoSlug);
  return isServedFile
    ? { kind: ProxiedMediaSourceKinds.COMMITTED_FILE, file }
    : undefined;
}

/** A page plays a video only from the proxy, so a video anywhere else is no Media item and renders as a link. */
export function isProxiedMediaAddress(
  address: string,
  repoSlug: string | undefined,
): boolean {
  return readProxiedMediaSource(address, repoSlug) !== undefined;
}
