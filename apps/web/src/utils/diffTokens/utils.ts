import { CHUNK_ROW_CEILING } from "./consts";

/** Above the ceiling the tokenize cost outruns what a reader can scan. */
export function isChunkTokenizable(rowCount: number): boolean {
  return rowCount > 0 && rowCount <= CHUNK_ROW_CEILING;
}
