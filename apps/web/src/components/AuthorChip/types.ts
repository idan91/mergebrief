import type { ValueOf } from "types/utils";

export const AuthorChipSizes = {
  SM: "sm",
  MD: "md",
} as const;
export type AuthorChipSize = ValueOf<typeof AuthorChipSizes>;
