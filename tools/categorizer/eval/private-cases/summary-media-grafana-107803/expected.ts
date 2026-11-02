import type { EvalProperty } from "../../properties";
import {
  buildSummaryMediaGuards,
  listShownKeys,
  readItemKey,
} from "../../summary-media-props";

/**
 * grafana/grafana#107803: the description's one Media item is a Mermaid
 * sequence diagram of the write path the PR adds, the one place the flow is
 * drawn. AGPL-3.0, so it sits with the private cases; its LICENSE is beside
 * the fixture.
 */
const SEQUENCE_DIAGRAM_ITEM = 1;

export const properties: EvalProperty[] = [
  ...buildSummaryMediaGuards(),
  {
    id: "shows-sequence-diagram",
    description:
      "the explanatory sequence diagram is shown in the Brief summary",
    check: (brief) =>
      listShownKeys(brief).includes(readItemKey(brief, SEQUENCE_DIAGRAM_ITEM)),
  },
];
