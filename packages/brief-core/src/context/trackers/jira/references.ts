import { TicketTrackers } from "types/trackers";
import type { TrackerConfig } from "generators/trackers";
import type { ReferenceLocation } from "../../../types";
import { collectTicketKeys } from "../ticket-keys";
import type { ReferenceHit, TicketReferenceInput } from "../types";

function listProjectKeys(trackers: readonly TrackerConfig[]): string[] {
  return trackers.flatMap((tracker) =>
    tracker.kind === TicketTrackers.JIRA ? tracker.projectKeys : [],
  );
}

/** Keys under the listed project keys, in every location; any other prefix stays text. */
export function collectJiraReferences(
  text: string,
  _location: ReferenceLocation,
  input: TicketReferenceInput,
): ReferenceHit[] {
  const projectKeys = listProjectKeys(input.trackers);

  return collectTicketKeys(text, projectKeys).map(({ index, key }) => ({
    index,
    reference: { tracker: TicketTrackers.JIRA, key, url: "" },
  }));
}

/** A Jira link is not a reference, so it has no canonical form. */
export function canonicalizeJiraUrl(): undefined {
  return undefined;
}
