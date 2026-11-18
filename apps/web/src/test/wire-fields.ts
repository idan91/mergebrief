import type { Equals } from "types/utils";

/** Every field the parser reads is one the contract sends. */
export type ReadsWireFields<Parsed, Wire> = Equals<
  Exclude<keyof Parsed, keyof Wire>,
  never
>;
