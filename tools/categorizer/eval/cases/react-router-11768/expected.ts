import type { EvalProperty } from "../../properties";
import {
  buildLockfileShortening,
  buildPartitionProperties,
} from "../large-pr-props";

/** remix-run/react-router#11768, v7 merged to dev: 724 files bound by input size. */
export const properties: EvalProperty[] = [
  ...buildPartitionProperties(),
  buildLockfileShortening([
    "pnpm-lock.yaml",
    "examples/ssr-data-router/package-lock.json",
  ]),
];
