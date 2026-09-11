import type { ValueOf } from "types";

export const BranchNameVariants = {
  BASE: "base",
  HEAD: "head",
} as const;

export type BranchNameVariant = ValueOf<typeof BranchNameVariants>;
