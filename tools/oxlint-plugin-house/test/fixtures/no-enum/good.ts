import type { ValueOf } from "types";

export const Colors = { RED: "red" } as const;

export type Color = ValueOf<typeof Colors>;
