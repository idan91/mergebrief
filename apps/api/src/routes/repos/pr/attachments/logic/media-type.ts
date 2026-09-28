import { AttachmentMediaTypes, type AttachmentMediaType } from "contract";

const UPLOAD_MEDIA_TYPES: ReadonlySet<string> = new Set(
  Object.values(AttachmentMediaTypes),
);

function isAttachmentMediaType(value: string): value is AttachmentMediaType {
  return UPLOAD_MEDIA_TYPES.has(value);
}

/** The allowlisted image type a `content-type` header declares, parameters dropped. */
export function readDeclaredMediaType(
  header: string | undefined,
): AttachmentMediaType | undefined {
  if (header === undefined) {
    return undefined;
  }
  const [mediaType = ""] = header.split(";");
  const normalized = mediaType.trim().toLowerCase();
  return isAttachmentMediaType(normalized) ? normalized : undefined;
}
