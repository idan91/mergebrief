// Shared utility types come from `types` — a TYPES-ONLY, zero-dependency
// package, so this re-export keeps the no-runtime-coupling guarantee this
// package's no-DB-imports rule exists for (nothing here pulls in the DB layer).
export type { Result, ValueOf } from "types";
