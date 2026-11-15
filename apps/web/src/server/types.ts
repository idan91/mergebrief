import type { ValueOf } from "types/utils";

/** The codings a compressed reply may take. */
export const ReplyCodings = {
  BROTLI: "br",
  GZIP: "gzip",
} as const;
export type ReplyCoding = ValueOf<typeof ReplyCodings>;
