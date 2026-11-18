import type { ValueOf } from "types/utils";

export const CommittedFileParseErrorCodes = {
  NOT_A_COMMITTED_FILE: "not-a-committed-file",
  UNSAFE_PATH: "unsafe-path",
} as const;
export type CommittedFileParseErrorCode = ValueOf<
  typeof CommittedFileParseErrorCodes
>;

/** A file committed to a GitHub repository, named by one of its raw addresses. */
export interface CommittedFileSource {
  readonly owner: string;
  readonly repo: string;
  /**
   * The ref, then the file's path, each segment decoded once. A ref may hold
   * a slash, so where the ref ends is for the repository's refs to say.
   */
  readonly pathSegments: readonly string[];
}

/** The ref namespaces a fully qualified ref (`refs/<namespace>/<name>`) may name in an address. */
export const QualifiedRefNamespaces = {
  HEADS: "heads",
  TAGS: "tags",
} as const;
export type QualifiedRefNamespace = ValueOf<typeof QualifiedRefNamespaces>;

/** An address whose ref is written `refs/<namespace>/<name>`, as GitHub's Raw button writes it. */
export interface QualifiedRef {
  readonly namespace: QualifiedRefNamespace;
  /** The ref's name then the file's path, the `refs/<namespace>` segments dropped. */
  readonly unqualifiedSegments: readonly string[];
}

/** The file extensions the committed-file proxy serves; a file in any other format keeps loading from GitHub as written. */
export const CommittedMediaExtensions = {
  PNG: "png",
  JPG: "jpg",
  JPEG: "jpeg",
  GIF: "gif",
  WEBP: "webp",
  SVG: "svg",
  MP4: "mp4",
  WEBM: "webm",
  MOV: "mov",
} as const;
export type CommittedMediaExtension = ValueOf<typeof CommittedMediaExtensions>;
