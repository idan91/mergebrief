import type { EvalProperty } from "../../../eval/properties";

/** Placeholder case used by the loader tests — real cases land in PR 3. */
export const properties: EvalProperty[] = [
  {
    id: "has-at-least-one-group",
    description: "the brief has at least one change group",
    check: (brief) => brief.changeGroups.length >= 1,
  },
];
