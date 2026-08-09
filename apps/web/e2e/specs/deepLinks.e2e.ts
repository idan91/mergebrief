// The View/Compare deep-link contract. `validateSearch` treats an
// unrecognized value as absent, and `resolveBriefSearch` normalizes an
// explicit-but-unavailable pair down instead of erroring, because this state
// is user-editable and shareable. Both halves are asserted here.
import { expect, test } from "@playwright/test";

import { FIXTURE_BRIEF_REV1, FIXTURE_BRIEF_REV2 } from "../fixtures/ids";
import { gotoBrief } from "../support/page";

test("a Changes Only deep link renders the comparison span", async ({
  page,
}) => {
  await gotoBrief(
    page,
    `/briefs/${FIXTURE_BRIEF_REV2}?view=changes&compare=previous-brief`,
  );

  await expect(
    page.getByRole("button", { name: "Changes Only" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Previous brief", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  // The revision narrative for this span, not the whole brief's story.
  await expect(page.locator("#main-content")).toContainText(
    "Changes Only · since the previous Brief",
  );
  await expect(page.locator("#main-content")).toContainText(
    "This revision extracts the chunk scroller",
  );
});

test("unrecognized params fall back to the product default", async ({
  page,
}) => {
  await gotoBrief(
    page,
    `/briefs/${FIXTURE_BRIEF_REV2}?view=bogus&compare=bogus`,
  );

  // Unparseable keys read as "nothing chosen yet", so the fresh-arrival
  // default applies — the page renders rather than 404ing or erroring.
  await expect(page.getByTestId("view-changes")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Previous brief", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("a comparison the revision cannot offer normalizes down", async ({
  page,
}) => {
  // Revision 1 has no baseline, so `changes + previous-brief` is not
  // satisfiable: it collapses to the full brief with comparison off.
  await gotoBrief(
    page,
    `/briefs/${FIXTURE_BRIEF_REV1}?view=changes&compare=previous-brief`,
  );

  await expect(
    page.getByRole("button", { name: "Full brief" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Off" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Both Compare options are off the table at revision 1, and each says why.
  const previousBrief = page.getByRole("button", {
    name: "Previous brief",
    exact: true,
  });
  await expect(previousBrief).toBeDisabled();
  await expect(previousBrief).toHaveAttribute(
    "title",
    "No previous brief for this revision",
  );
  await expect(
    page.getByRole("button", { name: "Your last review", exact: true }),
  ).toBeDisabled();
});

test("the timeline navigates between the fixture's revisions", async ({
  page,
}) => {
  await gotoBrief(page, `/briefs/${FIXTURE_BRIEF_REV2}`);

  await page.getByRole("link", { name: "Brief 1", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/briefs/${FIXTURE_BRIEF_REV1}`));
  await expect(
    page.getByRole("heading", {
      name: "Add J/K/Z/? keyboard navigation and CSS-only focus mode to the brief screen",
    }),
  ).toBeVisible();
});
