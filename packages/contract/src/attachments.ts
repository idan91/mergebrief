import type { Brand, Result, ValueOf } from "types";

export const ATTACHMENT_ASSET_ORIGIN = "https://github.com";
export const ATTACHMENT_ASSET_PATH_PREFIX = "/user-attachments/assets/";

export type AttachmentAssetId = Brand<string, "AttachmentAssetId">;

export const AttachmentParseErrorCodes = {
  NOT_AN_ATTACHMENT: "not-an-attachment",
} as const;
export type AttachmentParseErrorCode = ValueOf<
  typeof AttachmentParseErrorCodes
>;

const ASSET_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type ParseResult<T> = Result<T, AttachmentParseErrorCode>;

const NOT_AN_ATTACHMENT: ParseResult<never> = {
  ok: false,
  error: AttachmentParseErrorCodes.NOT_AN_ATTACHMENT,
};

export function isAttachmentAssetId(value: string): value is AttachmentAssetId {
  return ASSET_ID_PATTERN.test(value);
}

export function parseAttachmentAssetId(
  url: string,
): ParseResult<AttachmentAssetId> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NOT_AN_ATTACHMENT;
  }

  const onAssetOrigin =
    parsed.origin === ATTACHMENT_ASSET_ORIGIN &&
    parsed.search === "" &&
    parsed.hash === "" &&
    parsed.pathname.startsWith(ATTACHMENT_ASSET_PATH_PREFIX);
  if (!onAssetOrigin) {
    return NOT_AN_ATTACHMENT;
  }

  const id = parsed.pathname.slice(ATTACHMENT_ASSET_PATH_PREFIX.length);
  if (!isAttachmentAssetId(id)) {
    return NOT_AN_ATTACHMENT;
  }
  return { ok: true, value: id };
}
