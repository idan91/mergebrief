import type { Brand, ValueOf } from "types";

export type AttachmentAssetId = Brand<string, "AttachmentAssetId">;

export const AttachmentParseErrorCodes = {
  NOT_AN_ATTACHMENT: "not-an-attachment",
} as const;
export type AttachmentParseErrorCode = ValueOf<
  typeof AttachmentParseErrorCodes
>;

/** The raster types an attachment may be; the upload accepts and the proxy serves only these. */
export const AttachmentMediaTypes = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  GIF: "image/gif",
  WEBP: "image/webp",
} as const;
export type AttachmentMediaType = ValueOf<typeof AttachmentMediaTypes>;

export const AttachmentSourceKinds = {
  /** GitHub's own `user-attachments` asset, as its editor pastes one. */
  ASSET: "asset",
  /** A file MergeBrief committed to the repository's attachments branch. */
  BRANCH: "branch",
} as const;
export type AttachmentSourceKind = ValueOf<typeof AttachmentSourceKinds>;

/** A file on the attachments branch: `<assetId>.<ext>`, the extension naming its type. */
export interface AttachmentFile {
  readonly assetId: AttachmentAssetId;
  readonly fileName: string;
  readonly mediaType: AttachmentMediaType;
}

export interface AssetAttachmentSource {
  readonly kind: typeof AttachmentSourceKinds.ASSET;
  readonly assetId: AttachmentAssetId;
}

export interface BranchAttachmentSource extends AttachmentFile {
  readonly kind: typeof AttachmentSourceKinds.BRANCH;
  readonly owner: string;
  readonly repo: string;
}

export type AttachmentSource = AssetAttachmentSource | BranchAttachmentSource;

export interface AttachmentBranchLocation {
  readonly owner: string;
  readonly repo: string;
  readonly fileName: string;
}

/**
 * What `list-video-assets` answers: the pasted assets GitHub rendered as a
 * video in the description and the last 100 comments, reviews and threads.
 */
export interface VideoAssetsResponse {
  readonly assetIds: readonly AttachmentAssetId[];
}

/** What `upload-attachment` answers, with 201. */
export interface UploadAttachmentResponse {
  /** The branch URL a comment carries; GitHub renders it inline. */
  readonly url: string;
}
