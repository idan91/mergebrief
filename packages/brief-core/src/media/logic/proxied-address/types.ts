import type { AttachmentSource } from "contract/attachments";

import type { CommittedFileSource } from "../../../media-address";

export const ProxiedMediaSourceKinds = {
  ATTACHMENT: "attachment",
  COMMITTED_FILE: "committed-file",
} as const;

/** A pasted attachment, which the attachment read serves. */
export interface ProxiedAttachmentSource {
  readonly kind: typeof ProxiedMediaSourceKinds.ATTACHMENT;
  readonly attachment: AttachmentSource;
}

/** A servable file committed to the pull request's repository, which the committed-file read serves. */
export interface ProxiedCommittedFileSource {
  readonly kind: typeof ProxiedMediaSourceKinds.COMMITTED_FILE;
  readonly file: CommittedFileSource;
}

/** An address the API's same-origin proxy serves, read once for every caller that asks. */
export type ProxiedMediaSource =
  | ProxiedAttachmentSource
  | ProxiedCommittedFileSource;
