import { VideoMediaTypes, type VideoMediaType } from "../types";

const FILE_TYPE_BOX = "ftyp";
const FILE_TYPE_BOX_OFFSET = 4;
const BRAND_OFFSET = 8;
const BRAND_END = 12;
const QUICKTIME_BRAND = "qt  ";
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const DOC_TYPE_ID = [0x42, 0x82];
const WEBM_DOC_TYPE = "webm";
/** A one-byte EBML size carries its length in the low seven bits. */
const ONE_BYTE_SIZE_MARKER = 0x80;
const ONE_BYTE_SIZE_MASK = 0x7f;

function readAscii(head: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...head.subarray(start, end));
}

function startsWithBytes(
  head: Uint8Array,
  bytes: readonly number[],
  offset: number,
): boolean {
  return bytes.every((byte, index) => head[offset + index] === byte);
}

/** The ISO base media file's major brand: QuickTime's own, else an mp4. */
function sniffIsoMedia(head: Uint8Array): VideoMediaType | undefined {
  const hasFileTypeBox =
    head.byteLength >= BRAND_END &&
    readAscii(head, FILE_TYPE_BOX_OFFSET, BRAND_OFFSET) === FILE_TYPE_BOX;
  if (!hasFileTypeBox) {
    return undefined;
  }
  const brand = readAscii(head, BRAND_OFFSET, BRAND_END);
  if (brand === QUICKTIME_BRAND) {
    return VideoMediaTypes.QUICKTIME;
  }
  return VideoMediaTypes.MP4;
}

/** An EBML header whose DocType element, with a one-byte size, reads `webm`. */
function isWebmHead(head: Uint8Array): boolean {
  if (!startsWithBytes(head, EBML_MAGIC, 0)) {
    return false;
  }
  for (let offset = EBML_MAGIC.length; offset < head.byteLength; offset += 1) {
    if (!startsWithBytes(head, DOC_TYPE_ID, offset)) {
      continue;
    }
    const sizeByte = head[offset + DOC_TYPE_ID.length] ?? 0;
    const start = offset + DOC_TYPE_ID.length + 1;
    const length = sizeByte & ONE_BYTE_SIZE_MASK;
    const isOneByteSize = (sizeByte & ONE_BYTE_SIZE_MARKER) !== 0;
    const namesWebm =
      isOneByteSize && readAscii(head, start, start + length) === WEBM_DOC_TYPE;
    return namesWebm;
  }
  return false;
}

/** The video type the leading bytes declare; text such as a Git LFS pointer is none. */
export function sniffVideoMediaType(
  head: Uint8Array,
): VideoMediaType | undefined {
  const isoMedia = sniffIsoMedia(head);
  if (isoMedia !== undefined) {
    return isoMedia;
  }
  if (isWebmHead(head)) {
    return VideoMediaTypes.WEBM;
  }
  return undefined;
}
