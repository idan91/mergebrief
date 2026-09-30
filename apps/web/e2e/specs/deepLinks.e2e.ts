// The View/Compare deep-link contract. `validateSearch` treats an
// unrecognized value as absent, and `resolveBriefSearch` normalizes an
// explicit-but-unavailable pair down instead of erroring, because this state
// is user-editable and shareable. Both halves are asserted here.
import { expect, type Page, test } from "@playwright/test";

import {
  FIXTURE_PR_TITLE,
  FIXTURE_ROUTE_REV1,
  FIXTURE_ROUTE_REV1_LEGACY_SPAN,
  FIXTURE_ROUTE_REV2,
} from "../fixtures/ids";
import { gotoBrief } from "../support/page";

test("a Changes Only deep link renders the comparison span", async ({
  page,
}) => {
  await gotoBrief(
    page,
    `${FIXTURE_ROUTE_REV2}&view=changes&compare=previous-brief`,
  );

  await expect(page.getByRole("radio", { name: "Changes Only" })).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Previous brief", exact: true }),
  ).toBeChecked();

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
  await gotoBrief(page, `${FIXTURE_ROUTE_REV2}&view=bogus&compare=bogus`);

  // Unparseable keys read as "nothing chosen yet", so the fresh-arrival
  // default applies: the page renders rather than 404ing or erroring.
  await expect(page.getByRole("radio", { name: "Changes Only" })).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Previous brief", exact: true }),
  ).toBeChecked();
});

test("a comparison the revision cannot offer normalizes down", async ({
  page,
}) => {
  // Revision 1 has no baseline, so `changes + previous-brief` is not
  // satisfiable: it collapses to the full brief with comparison off.
  await gotoBrief(
    page,
    `${FIXTURE_ROUTE_REV1}&view=changes&compare=previous-brief`,
  );

  await expect(page.getByRole("radio", { name: "Full brief" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Off" })).toBeChecked();
  // Both Compare options are unavailable at revision 1, but stay focusable
  // so the reason is keyboard-reachable.
  const previousBrief = page.getByRole("radio", {
    name: "Previous brief",
    exact: true,
  });
  await expect(previousBrief).toHaveAttribute("aria-disabled", "true");
  // Not HARD-disabled: it must still take focus.
  await previousBrief.focus();
  await expect(previousBrief).toBeFocused();
  const reasonId = await previousBrief.getAttribute("aria-describedby");
  await expect(page.locator(`#${String(reasonId)}`)).toHaveText(
    "No previous brief for this revision",
  );
  await expect(
    page.getByRole("radio", { name: "Your last review", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
});

test("the Revisions tab navigates between the fixture's revisions", async ({
  page,
}) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);

  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page.getByRole("tab", { name: "Revisions" }).click();
  await page.getByRole("button", { name: /^Revision 1\b/ }).click();
  // The repo route encodes the revision as `rev`, not in the path.
  await expect(page).toHaveURL(/[?&]rev=1(?:&|$)/);
  await expect(page).not.toHaveURL(/head=/);
  await expect(
    page.getByRole("heading", {
      name: "Add J/K/Z/? keyboard navigation and CSS-only focus mode to the brief screen",
    }),
  ).toBeVisible();
});

test("a rev link lands on that revision", async ({ page }) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV1);

  await expect(
    page.getByRole("heading", {
      name: "Add J/K/Z/? keyboard navigation and CSS-only focus mode to the brief screen",
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/[?&]rev=1(?:&|$)/);
});

test("an old span link lands on its revision and is rewritten to rev", async ({
  page,
}) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV1_LEGACY_SPAN);

  await expect(
    page.getByRole("heading", {
      name: "Add J/K/Z/? keyboard navigation and CSS-only focus mode to the brief screen",
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/[?&]rev=1(?:&|$)/);
  await expect(page).not.toHaveURL(/head=/);
  await expect(page).not.toHaveURL(/base=/);
});

test("a chunk link lands on that chunk's card", async ({ page }) => {
  // Plain goto: the interactive wait opens and closes the shortcuts dialog,
  // which would move focus off the landed card.
  await page.goto(`${FIXTURE_ROUTE_REV1}&l=c3`);

  const card = page.locator("#c3");
  await expect(card).toBeFocused({ timeout: 15_000 });
  await expect(card).toHaveAttribute("data-state", "open");
  await expect(card).toBeInViewport();
});

test("a chunk link lands after leaving Changes Only", async ({ page }) => {
  await page.goto(
    `${FIXTURE_ROUTE_REV2}&view=changes&compare=previous-brief&l=c2`,
  );

  const card = page.locator("#c2");
  await expect(card).toBeFocused({ timeout: 15_000 });
  await expect(page.getByRole("radio", { name: "Full brief" })).toBeChecked();
  await expect(card).toBeInViewport();

  // The scope exit replaced the arrival entry: one Back leaves the brief.
  await page.goBack();
  await expect(page).not.toHaveURL(/\/repos\//);
});

function findRowShowing(page: Page, side: "old" | "new", line: number) {
  return page.locator(`tr:has(> td[data-line-${side}="${String(line)}"])`);
}

test("a line link lands on that line, selected and focused", async ({
  page,
}) => {
  await page.goto(`${FIXTURE_ROUTE_REV1}&l=c1.R45`);

  const row = findRowShowing(page, "new", 45);
  await expect(row).toHaveAttribute("data-selected", "", { timeout: 15_000 });
  await expect(row).toBeFocused();
  await expect(row).toBeInViewport();
  await expect(page).toHaveURL(/[?&]l=c1\.R45(?:&|$)/);
});

test("an old-side range link selects every line of the range", async ({
  page,
}) => {
  await page.goto(`${FIXTURE_ROUTE_REV1}&l=c1.L295-L300`);

  await expect(findRowShowing(page, "old", 295)).toHaveAttribute(
    "data-selected",
    "",
    { timeout: 15_000 },
  );
  await expect(findRowShowing(page, "old", 300)).toHaveAttribute(
    "data-selected",
    "",
  );
  await expect(findRowShowing(page, "old", 295)).toBeFocused();
});

test("a context line the chunk shows lands like a changed one", async ({
  page,
}) => {
  await page.goto(`${FIXTURE_ROUTE_REV1}&l=c1.R43`);

  const row = findRowShowing(page, "new", 43);
  await expect(row).toHaveAttribute("data-selected", "", { timeout: 15_000 });
  await expect(row).toBeFocused();
});

test("a folded line expands its hunk edge before landing", async ({ page }) => {
  // 150 sits in the gap between the chunk's first two hunks.
  await page.goto(`${FIXTURE_ROUTE_REV1}&l=c1.R150`);

  const row = findRowShowing(page, "new", 150);
  await expect(row).toHaveAttribute("data-selected", "", { timeout: 15_000 });
  await expect(row).toBeFocused();
});

test("a line link this brief cannot land drops the param and says so", async ({
  page,
}) => {
  await page.goto(`${FIXTURE_ROUTE_REV1}&l=c9.R1`);

  await expect(page.getByTestId("line-link-notice")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page).not.toHaveURL(/[?&]l=/);
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByTestId("line-link-notice")).toBeHidden();
});

test("the tab title leads with the PR title, then names the home page", async ({
  page,
}) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);

  await expect(page).toHaveTitle(new RegExp(`^${FIXTURE_PR_TITLE} · #\\d+`));

  await page.goto("/");

  await expect(page).toHaveTitle("Briefs · MergeBrief");
});
