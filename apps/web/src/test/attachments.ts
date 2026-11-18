import { isAttachmentAssetId, type AttachmentAssetId } from "contract";

import type { AttachmentScope } from "@web/components/Markdown/context";

/** One GitHub user-attachment, shared by every test that renders or routes one. */
export const ATTACHMENT_ASSET_ID = "3e5dffc4-bd05-4a01-98e8-1c519ba4cf00";
export const ATTACHMENT_ASSET_URL = `https://github.com/user-attachments/assets/${ATTACHMENT_ASSET_ID}`;
/** The same asset as a file MergeBrief committed to the repo's attachments branch. */
export const ATTACHMENT_FILE_NAME = `${ATTACHMENT_ASSET_ID}.png`;
export const ATTACHMENT_BRANCH_URL = `https://github.com/octo/hello/blob/mergebrief/attachments/${ATTACHMENT_FILE_NAME}?raw=true`;
/** An image committed to an ordinary branch of the pull request's repository, in its blob form. */
export const COMMITTED_IMAGE_URL =
  "https://github.com/octo/hello/blob/assets/brief-362/after.png?raw=true";
/** The address every committed form of that image normalises to. */
export const COMMITTED_IMAGE_NORMALISED_URL =
  "https://github.com/octo/hello/raw/assets/brief-362/after.png";

/** The pull request every proxy test renders under, and the read paths its proxy answers on. */
export const ATTACHMENT_SCOPE: AttachmentScope = {
  repoId: "555",
  prNumber: 7,
  installed: true,
  repoSlug: "octo/hello",
};
export const ATTACHMENT_READ_PATH = "/api/repos/555/pulls/7";
export const COMMITTED_IMAGE_PROXY_PATH = `${ATTACHMENT_READ_PATH}/committed-file?source=${encodeURIComponent(COMMITTED_IMAGE_NORMALISED_URL)}`;
/** An image on an outside host: neither the proxy nor GitHub serves it, so it is never loaded. */
export const OUTSIDE_IMAGE_URL = "https://example.com/shot.png";

/** An image on a GitHub host, in a repository the proxy does not serve, so the browser loads it directly. */
export function buildUnservedGitHubImageUrl(fileName: string): string {
  return `https://raw.githubusercontent.com/other/repo/main/${fileName}`;
}
export const UNSERVED_GITHUB_IMAGE_URL =
  buildUnservedGitHubImageUrl("shot.png");
export const MERMAID_SEQUENCE_FENCE =
  "```mermaid\nsequenceDiagram\n  A->>B: hi\n```";

/** A fixture id as the branded id a video lookup holds. */
export function requireAttachmentAssetId(value: string): AttachmentAssetId {
  if (!isAttachmentAssetId(value)) {
    throw new Error("fixture asset id failed its guard");
  }
  return value;
}
