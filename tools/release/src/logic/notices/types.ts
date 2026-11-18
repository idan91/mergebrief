import type { Result } from "types/utils";

/** One file of the notices folder, by name. */
export interface NoticeFile {
  readonly fileName: string;
  readonly text: string;
}

/** One download the libvips build makes: a library's source archive, or a patch it applies to one. */
export interface SourceDownload {
  readonly library: string;
  /** The version the archive's URL names; absent for a patch. */
  readonly version?: string;
  readonly url: string;
}

/** Reads one file over HTTPS; injected so the folder builds against a fake. */
export type FetchText = (url: string) => Promise<Result<string, string>>;

/** The versions the notices folder records; a package absent here does not ship. */
export interface NoticedVersions {
  readonly libvips?: string;
  readonly elkjs?: string;
}
