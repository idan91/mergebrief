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
      notion: false,
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

  it("leaves the primary absent when nothing references a ticket", () => {
    const query = buildContextQuery({
      title: "t",
      body: "plain",
      branch: "",
      repo: REPO,
      notion: false,
    });
    expect("primary" in query).toBe(false);
  });
});
