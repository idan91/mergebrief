import { AttachmentMediaTypes, type AttachmentMediaType } from "contract";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50];
const WEBP_TAG_OFFSET = 8;

function startsWith(
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0,
): boolean {
  const signatureFits = offset + signature.length <= bytes.byteLength;
  if (!signatureFits) {
    return false;
  }
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** The raster type the leading bytes declare, or undefined for anything else. */
export function sniffImageMediaType(
  bytes: Uint8Array,
): AttachmentMediaType | undefined {
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return AttachmentMediaTypes.PNG;
  }
  if (startsWith(bytes, JPEG_SIGNATURE)) {
    return AttachmentMediaTypes.JPEG;
  }
  if (startsWith(bytes, GIF_SIGNATURE)) {
    return AttachmentMediaTypes.GIF;
  }
  if (
    startsWith(bytes, RIFF_SIGNATURE) &&
    startsWith(bytes, WEBP_TAG, WEBP_TAG_OFFSET)
  ) {
    return AttachmentMediaTypes.WEBP;
  }
  return undefined;
}
