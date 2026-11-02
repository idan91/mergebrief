import type { MediaItem } from "../media";
import type { Brief, PrimaryTicket, SummaryMedia } from "../types";
import type { BriefValidationContext } from "./final-validation/types";
import { validateIntentCheck } from "./validate";

const PRIMARY_TICKET_FIELDS = [
  "key",
  "url",
  "tracker",
  "foundIn",
  "title",
  "header",
  "status",
  "reason",
] as const satisfies readonly (keyof PrimaryTicket)[];

function isSamePrimaryTicket(
  previous: PrimaryTicket | undefined,
  current: PrimaryTicket | undefined,
): boolean {
  if (previous === undefined || current === undefined) {
    return previous === current;
  }
  return PRIMARY_TICKET_FIELDS.every(
    (field) => previous[field] === current[field],
  );
}

function listSummaryMediaKeys(summaryMedia: SummaryMedia): string[] {
  const shown = summaryMedia.shown.map((item) => item.key);
  return [...shown, ...(summaryMedia.pointer?.items ?? [])];
}

/** The previous intent check holds over this run's sources when re-checking it finds nothing to fix. */
function holdsIntentCheck(
  previous: Brief,
  context: BriefValidationContext,
): boolean {
  if (previous.intentCheck === undefined) {
    return true;
  }
  const checked = validateIntentCheck(
    previous.intentCheck,
    previous.changeGroups,
    context.injectedUrls,
    context.corpus,
    [],
    context.primaryFacts,
  );
  return checked.issues.length === 0;
}

/**
 * True when what the previous brief read beside the diff still holds, so
 * carrying its prose and intent cannot state what this run's inputs no
 * longer say: the same primary ticket, an intent check this run's sources
 * still back, and every summary Media key still in the description.
 */
export function holdsCarriedInputs(
  previous: Brief,
  context: BriefValidationContext,
  media: readonly MediaItem[],
): boolean {
  const previousTicket = previous.intentCheck?.primaryTicket;
  if (!isSamePrimaryTicket(previousTicket, context.primaryTicket)) {
    return false;
  }
  if (!holdsIntentCheck(previous, context)) {
    return false;
  }
  if (previous.summaryMedia === undefined) {
    return true;
  }
  const keys = new Set<string>(media.map((item) => item.key));
  return listSummaryMediaKeys(previous.summaryMedia).every((key) =>
    keys.has(key),
  );
}
