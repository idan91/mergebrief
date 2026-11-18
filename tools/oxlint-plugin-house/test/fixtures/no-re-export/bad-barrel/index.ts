export { a } from "../sibling"; // reports
export * from "pkg"; // reports
export type { T } from "pkg/sub"; // reports
import { b } from "pkg";
export { b }; // reports
export * from "./sub/../../escape"; // reports
import { c } from "../shared";
export const d = c; // reports
export * from "./a\\..\\..\\x"; // reports
export * from "./index"; // reports
export { a as b2 } from "./index.ts"; // reports
