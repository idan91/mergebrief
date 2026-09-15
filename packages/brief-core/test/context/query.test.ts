import { describe, expect, it } from "vitest";
import { buildContextQuery } from "../../src/context/query";

const REPO = { owner: "acme", repo: "widget" };

describe("buildContextQuery", () => {
  it("carries the metadata tier and the resolved primary", () => {
    const query = buildContextQuery({
      title: "Add thing",
      body: "Fixes #12\nsee https://docs.example/x",
      branch: "feature/12-thing",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect(query).toMatchObject({
      title: "Add thing",
      headRef: "feature/12-thing",
      repo: REPO,
    });
    expect(query.primary).toMatchObject({
      number: 12,
      url: "https://github.com/acme/widget/issues/12",
      foundIn: "description",
      closing: true,
    });
  });

  it("ranks a key on the repo's tracker above a bare #N in the description", () => {
    const query = buildContextQuery({
      title: "[BRIEF-239] Add thing",
      body: "on #467",
      branch: "",
      repo: REPO,
      trackers: [
        { kind: "notion", keyPrefix: "BRIEF", databaseId: "a".repeat(32) },
      ],
      readable: ["github"],
    });
    expect(query.primary).toMatchObject({
      tracker: "notion",
      key: "BRIEF-239",
    });
  });

  it("leaves the primary absent when nothing references a ticket", () => {
    const query = buildContextQuery({
      title: "t",
      body: "plain",
      branch: "",
      repo: REPO,
      trackers: [],
      readable: ["github"],
    });
    expect("primary" in query).toBe(false);
  });
});
