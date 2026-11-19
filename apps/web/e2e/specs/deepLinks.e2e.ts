// The View/Compare deep-link contract. `validateSearch` treats an
// unrecognized value as absent, and `resolveBriefSearch` normalizes an
// explicit-but-unavailable pair down instead of erroring, because this state
// is user-editable and shareable. Both halves are asserted here.
import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  FIXTURE_ROUTE_REV1,
  FIXTURE_ROUTE_REV1_LEGACY_SPAN,
  FIXTURE_ROUTE_REV2,
} from "../fixtures/ids";
import { gotoBrief } from "../support/page";

test("unrecognized params fall back to the product default", async ({
  page,
}) => {
  await page.goto(`${FIXTURE_ROUTE_REV2}&view=bogus&compare=bogus`);

  // Unparseable keys read as "nothing chosen yet", so the fresh-arrival
  // default applies: the page renders rather than 404ing or erroring.
  await expect(page.getByRole("radio", { name: "Full brief" })).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Off", exact: true }),
  ).toBeChecked();
});

test("a comparison the revision cannot offer normalizes down", async ({
  page,
}) => {
  // Revision 1 has no baseline, so `changes + previous-brief` is not
  // satisfiable: it collapses to the full brief with comparison off.
  await page.goto(`${FIXTURE_ROUTE_REV1}&view=changes&compare=previous-brief`);

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

test("an old span link opens its revision and is rewritten to rev", async ({
  page,
}) => {
  await page.goto(FIXTURE_ROUTE_REV1_LEGACY_SPAN);

  await expect(
    page.getByRole("heading", {
      name: "Add J/K/Z/? keyboard navigation and CSS-only focus mode to the brief screen",
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/[?&]rev=1(?:&|$)/);
  await expect(page).not.toHaveURL(/head=/);
  await expect(page).not.toHaveURL(/base=/);
});

test("a chunk link scrolls to that chunk's card", async ({ page }) => {
  // Plain goto: the interactive wait opens and closes the shortcuts dialog,
  // which would move focus off the target card.
  await page.goto(`${FIXTURE_ROUTE_REV1}&l=c3`);

  const card = page.locator("#c3");
  await expect(card).toBeFocused({ timeout: 15_000 });
  await expect(card).toHaveAttribute("data-state", "open");
  await expect(card).toBeInViewport();
});

test("a chunk link scrolls after leaving Changes Only", async ({ page }) => {
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

async function isHitAtCentre(button: Locator): Promise<boolean> {
  return button.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.x + box.width / 2,
      box.y + box.height / 2,
    );
    const hitsButton = hit !== null && element.contains(hit);
    return hitsButton;
  });
}

test("a line link scrolls to that line, selected and focused", async ({
  page,
}) => {
  await page.goto(`${FIXTURE_ROUTE_REV1}&l=c1.R45`);

  const row = findRowShowing(page, "new", 45);
  await expect(row).toHaveAttribute("data-selected", "", { timeout: 15_000 });
  await expect(row).toBeFocused();
  await expect(row).toBeInViewport();
  await expect(page).toHaveURL(/[?&]l=c1\.R45(?:&|$)/);
});

test("a phone keeps a selected deleted line's link number tappable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${FIXTURE_ROUTE_REV1}&l=c1.L295`);

  const row = findRowShowing(page, "old", 295);
  await expect(row).toHaveAttribute("data-selected", "", { timeout: 15_000 });
  const copyLink = row.getByRole("button", { name: "Copy link to line 295" });
  await expect(copyLink).toBeVisible();
  await expect(copyLink).toHaveText("295");

  expect(await isHitAtCentre(copyLink)).toBe(true);
  await copyLink.click({ trial: true });
});

test("a phone shows the link number of a context line linked by old side", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${FIXTURE_ROUTE_REV1}&l=c1.L296`);

  const row = findRowShowing(page, "old", 296);
  await expect(row).toHaveAttribute("data-selected", "", { timeout: 15_000 });
  const copyLink = row.getByRole("button", { name: "Copy link to line 296" });
  await expect(copyLink).toHaveText("296");
  expect(await isHitAtCentre(copyLink)).toBe(true);

  const newNumber = row.locator('td[data-line-new="378"]');
  await expect(newNumber).toHaveCSS("color", "rgba(0, 0, 0, 0)");
});

test("a phone shows the link of an old-side range from a context line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${FIXTURE_ROUTE_REV1}&l=c1.L296-L299`);

  const row = findRowShowing(page, "old", 296);
  await expect(row).toHaveAttribute("data-selected", "", { timeout: 15_000 });
  const copyLink = row.getByRole("button", {
    name: "Copy link to lines 296 to 299",
  });
  expect(await isHitAtCentre(copyLink)).toBe(true);
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

test("a folded line expands its hunk edge before scrolling", async ({
  page,
}) => {
  // 150 sits in the gap between the chunk's first two hunks.
  await page.goto(`${FIXTURE_ROUTE_REV1}&l=c1.R150`);

  const row = findRowShowing(page, "new", 150);
  await expect(row).toHaveAttribute("data-selected", "", { timeout: 15_000 });
  await expect(row).toBeFocused();
});

test("a line link this brief cannot scroll to drops the param and says so", async ({
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

test("Back across a Scope change keeps Focus mode and corrects the Address", async ({
  page,
}) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);
  const focusIndicator = page.getByRole("group", {
    name: "Focus mode",
    exact: true,
  });
  const changesOnly = page.getByRole("radio", {
    name: "Changes only",
    exact: true,
  });
  // The radio is sr-only and its label carries the chrome: pick it by key.
  await changesOnly.focus();
  await page.keyboard.press("Space");
  await expect(changesOnly).toBeChecked();
  await expect(page).toHaveURL(/view=changes/);

  await page.keyboard.press("z");
  await expect(page).toHaveURL(/focus=true/);
  await page.goBack();

  // The Brief view store owns focus mode: the older entry is rewritten to say so.
  await expect(page).not.toHaveURL(/view=changes/);
  await expect(page).toHaveURL(/focus=true/);
  await expect(focusIndicator).toBeVisible();

  await page.keyboard.press("z");
  await expect(page).not.toHaveURL(/focus=true/);
  await page.goForward();

  await expect(page).toHaveURL(/view=changes/);
  await expect(page).not.toHaveURL(/focus=true/);
  await expect(focusIndicator).toHaveCount(0);
});
