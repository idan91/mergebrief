import { describe, expect, it } from "vitest";
import { collectJiraReferences } from "../../../../src/context/trackers/jira/references";
import type { TicketReferenceInput } from "../../../../src/context/trackers/types";
import {
  ReferenceLocations,
  type ReferenceLocation,
} from "../../../../src/types";
import { JIRA_TRACKER } from "../../helpers";

function makeInput(
  overrides: Partial<TicketReferenceInput> = {},
): TicketReferenceInput {
  return {
    title: "",
    body: "",
    branch: "",
    repo: { owner: "acme", repo: "widget" },
    trackers: [JIRA_TRACKER],
    readable: [],
    ...overrides,
  };
}

function collectKeys(
  text: string,
  location: ReferenceLocation = ReferenceLocations.DESCRIPTION,
  input: TicketReferenceInput = makeInput(),
): string[] {
  return collectJiraReferences(text, location, input).map(
    (hit) => hit.reference.key,
  );
}

describe("collectJiraReferences", () => {
  it("reads a listed project's key as a jira reference with no URL yet", () => {
    expect(
      collectJiraReferences(
        "Fixes ACME-12",
        ReferenceLocations.DESCRIPTION,
        makeInput(),
      ),
    ).toEqual([
      { index: 6, reference: { tracker: "jira", key: "ACME-12", url: "" } },
    ]);
  });

  it.each([
    ReferenceLocations.DESCRIPTION,
    ReferenceLocations.TITLE,
    ReferenceLocations.BRANCH,
  ])("counts a key in the %s", (location) => {
    expect(collectKeys("WEB-40 and ACME-12", location)).toEqual([
      "WEB-40",
      "ACME-12",
    ]);
  });

  it("leaves an unlisted project's key as text", () => {
    expect(collectKeys("HR-7 then ACME-12")).toEqual(["ACME-12"]);
  });

  it("stores a lower-case key upper-case", () => {
    expect(collectKeys("acme-12")).toEqual(["ACME-12"]);
  });

  it("does not count a key inside a link", () => {
    expect(
      collectKeys("see https://acme.atlassian.net/browse/ACME-12 and WEB-3"),
    ).toEqual(["WEB-3"]);
  });

  it.each(["feature/ACME-12-fix-login", "feature/acme-12-fix-login"])(
    "reads the key in the branch %s",
    (branch) => {
      expect(collectKeys(branch, ReferenceLocations.BRANCH)).toEqual([
        "ACME-12",
      ]);
    },
  );

  it("matches nothing when the list names no jira tracker", () => {
    const notion = {
      kind: "notion",
      keyPrefix: "ACME",
      databaseId: "a".repeat(32),
    } as const;
    expect(
      collectKeys(
        "ACME-12",
        ReferenceLocations.DESCRIPTION,
        makeInput({ trackers: [notion] }),
      ),
    ).toEqual([]);
  });
});
