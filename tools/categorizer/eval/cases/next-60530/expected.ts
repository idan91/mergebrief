import type { EvalProperty } from "../../properties";
import {
  buildOutlineFormRead,
  buildPartitionProperties,
} from "../large-pr-props";

/** vercel/next.js#60530, a prettier reformat of 2,559 example files: the outline-form case. */
export const properties: EvalProperty[] = [
  ...buildPartitionProperties(),
  buildOutlineFormRead(),
];
