import type { ValueOf } from "types/utils";

export const BranchNameVariants = {
  BASE: "base",
  HEAD: "head",
} as const;

export type BranchNameVariant = ValueOf<typeof BranchNameVariants>;
