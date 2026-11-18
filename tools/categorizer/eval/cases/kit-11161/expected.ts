import type { EvalProperty } from "../../properties";
import {
  buildLockfileShortening,
  buildPartitionProperties,
} from "../large-pr-props";

/** sveltejs/kit#11161, SvelteKit 2.0: 342 files whose brief is bound by output size. */
export const properties: EvalProperty[] = [
  ...buildPartitionProperties(),
  buildLockfileShortening(["pnpm-lock.yaml"]),
];
