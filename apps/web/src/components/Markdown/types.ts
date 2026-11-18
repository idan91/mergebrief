import type { Root } from "hast";

/** One rehype step over the parsed tree; every step here mutates in place. */
export type RehypeTransform = (tree: Root) => void;
