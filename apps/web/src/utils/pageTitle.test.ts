import { describe, expect, it } from "vitest";

import { appI18n } from "../i18n/I18nProvider";
import { buildPageTitle, buildPrPageTitle } from "./pageTitle";

const translate = appI18n.t;

describe("buildPrPageTitle", () => {
  it("leads with the PR title, then number, repo and product", () => {
    const title = buildPrPageTitle(translate, {
      title: "Fix the login redirect",
      prNumber: 42,
      repoSlug: "acme/shop",
    });

    expect(title).toBe("Fix the login redirect · #42 · acme/shop · MergeBrief");
  });

  it("drops a missing PR title", () => {
    const title = buildPrPageTitle(translate, {
      prNumber: 42,
      repoSlug: "acme/shop",
    });

    expect(title).toBe("#42 · acme/shop · MergeBrief");
  });

  it("drops a missing repo slug", () => {
    const title = buildPrPageTitle(translate, {
      title: "Fix the login redirect",
      prNumber: 42,
    });

    expect(title).toBe("Fix the login redirect · #42 · MergeBrief");
  });

  it("drops a blank PR title", () => {
    const title = buildPrPageTitle(translate, {
      title: "   ",
      prNumber: 7,
    });

    expect(title).toBe("#7 · MergeBrief");
  });

  it("passes markup in a PR title through unescaped", () => {
    const title = buildPrPageTitle(translate, {
      title: "</title><script>alert(1)</script> & more",
      prNumber: 1,
    });

    expect(title).toBe(
      "</title><script>alert(1)</script> & more · #1 · MergeBrief",
    );
  });
});

describe("buildPageTitle", () => {
  it("reads as the product name alone with no segments", () => {
    expect(buildPageTitle(translate, [])).toBe("MergeBrief");
  });
});
