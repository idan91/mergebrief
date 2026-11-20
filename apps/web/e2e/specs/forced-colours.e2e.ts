// Forced colours repaint every author fill and edge in one ink. A state or a
// bar drawn by colour alone has to be restated in system colours to survive.
import { expect, test, type Locator, type Page } from "@playwright/test";

import { DiffViews } from "../../src/components/DiffRows/types";
import { DIFF_VIEW_COOKIE } from "../../src/features/brief/ui/components/BriefView/diff-view/consts";
import { FIXTURE_ROUTE_REV1, FIXTURE_ROUTE_REV2 } from "../fixtures/ids";
import { gotoSettledBrief, waitForFirstLoad } from "../support/page";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
});

interface SystemColors {
  canvas: string;
  canvasText: string;
  highlight: string;
  highlightText: string;
}

/** What the browser resolves each system colour to on this page. */
async function readSystemColors(page: Page): Promise<SystemColors> {
  return page.evaluate(() => {
    const resolveColor = (name: string) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = name;
      document.body.append(probe);
      const resolved = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return resolved;
    };
    return {
      canvas: resolveColor("Canvas"),
      canvasText: resolveColor("CanvasText"),
      highlight: resolveColor("Highlight"),
      highlightText: resolveColor("HighlightText"),
    };
  });
}

async function readFill(target: Locator, pseudo?: string): Promise<string> {
  return target.evaluate(
    (element, pseudoElement) =>
      getComputedStyle(element, pseudoElement).backgroundColor,
    pseudo,
  );
}

async function readStyle(
  target: Locator,
  property: string,
  pseudo?: string,
): Promise<string> {
  return target.evaluate(
    (element, [name, pseudoElement]) =>
      getComputedStyle(element, pseudoElement).getPropertyValue(name),
    [property, pseudo] as const,
  );
}

const RESTING_BAR_OPACITY = "0.45";

test("the view options and the current chunk keep their marks", async ({
  page,
}) => {
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);
  const colors = await readSystemColors(page);
  const selected = page.locator("input[type=radio]:checked + label").first();

  await test.step("the selected view option is filled, the others not", async () => {
    const unselected = page
      .locator("input[type=radio]:not(:checked) + label")
      .first();

    expect.soft(await readFill(selected)).toBe(colors.highlight);
    expect.soft(await readFill(unselected)).not.toBe(colors.highlight);

    await selected.hover();
    expect.soft(await readFill(selected)).toBe(colors.highlight);
  });

  await page.keyboard.press("j");

  await test.step("the chunk strip keeps its marks and names the current one", async () => {
    const marks = page.getByRole("button", { name: /chunk \d+ of \d+/ });
    const current = marks.and(page.locator('[aria-current="true"]')).first();
    await expect(current).toBeVisible();
    const resting = marks.and(page.locator(":not([aria-current])")).first();

    // The bar's fill eases between states.
    await expect
      .poll(() => readFill(current, "::before"))
      .toBe(colors.highlight);
    await expect
      .poll(() => readFill(resting, "::before"))
      .toBe(colors.canvasText);

    // Highlight and CanvasText sit too close in some themes to carry state alone.
    expect.soft(await readStyle(current, "opacity", "::before")).toBe("1");
    expect
      .soft(await readStyle(resting, "opacity", "::before"))
      .toBe(RESTING_BAR_OPACITY);
  });

  await test.step("the chunk the reader is on has a dashed highlighted edge", async () => {
    const head = page.locator("article[data-current] > div").first();
    await expect(head).toBeVisible();
    const restingHead = page
      .locator('[data-testid="brief-chunk"]:not([data-current]) > div')
      .first();

    expect
      .soft(await readStyle(head, "border-top-color"))
      .toBe(colors.highlight);
    expect.soft(await readStyle(head, "border-top-style")).toBe("dashed");
    expect.soft(await readStyle(head, "border-top-width")).toBe("1px");
    expect.soft(await readStyle(restingHead, "border-top-style")).toBe("solid");
  });

  await test.step("a focused selected view option rings in the highlight", async () => {
    const radio = page.locator("input[type=radio]:checked").first();

    // The last interaction was a key, so a scripted focus is focus-visible.
    await page.keyboard.press("Shift");
    await radio.focus();
    expect.soft(await readFocusVisible(radio)).toBe(true);

    expect.soft(await readStyle(selected, "outline-style")).toBe("solid");
    expect
      .soft(await readStyle(selected, "outline-color"))
      .toBe(colors.highlight);
  });
});

const LINE_LINK_ROUTE = `${FIXTURE_ROUTE_REV1}&l=c1.R45`;
const LINE_LINK_SETTLE_MS = 15_000;
const TRANSPARENT = "rgba(0, 0, 0, 0)";

test("a selected line's link number hides its digits and rings inside", async ({
  page,
}) => {
  await page.goto(LINE_LINK_ROUTE);
  const colors = await readSystemColors(page);
  const cell = page.locator('tr[data-selected] > td[data-line-new="45"]');
  await expect(cell).toHaveAttribute("data-state", "covered", {
    timeout: LINE_LINK_SETTLE_MS,
  });
  const copyLink = cell.getByRole("button", { name: "Copy link to line 45" });
  const digits = cell.locator(":scope > span");

  expect(await readStyle(cell, "color")).toBe(TRANSPARENT);
  expect(await readStyle(digits, "color")).toBe(TRANSPARENT);
  expect(await readStyle(copyLink, "color")).toBe(colors.highlightText);

  await page.keyboard.press("Shift");
  await copyLink.focus();
  expect(await readFocusVisible(copyLink)).toBe(true);
  expect(await readStyle(copyLink, "outline-offset")).toBe("-2px");
  expect(await readStyle(copyLink, "outline-color")).toBe(colors.highlightText);
});

test("a selected line's link number hides its digits in the split view", async ({
  page,
  baseURL,
}) => {
  await page
    .context()
    .addCookies([
      { name: DIFF_VIEW_COOKIE, value: DiffViews.SPLIT, url: baseURL ?? "" },
    ]);
  await page.goto(LINE_LINK_ROUTE);
  const colors = await readSystemColors(page);
  const cell = page.locator(
    'tbody[data-view="split"] td[data-side][data-selected][data-line-new="45"]',
  );
  await expect(cell).toHaveAttribute("data-state", "covered", {
    timeout: LINE_LINK_SETTLE_MS,
  });
  const copyLink = cell.getByRole("button", { name: "Copy link to line 45" });
  const digits = cell.locator(":scope > span");

  expect(await readStyle(cell, "color")).toBe(TRANSPARENT);
  expect(await readStyle(digits, "color")).toBe(TRANSPARENT);
  expect(await readStyle(copyLink, "color")).toBe(colors.highlightText);
});

test("a phone hides the old link number's digits and the new number", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${FIXTURE_ROUTE_REV1}&l=c1.L296`);
  const colors = await readSystemColors(page);
  const row = page.locator("tr[data-selected]").filter({
    has: page.locator('td[data-line-old="296"]'),
  });
  const oldCell = row.locator('td[data-line-old="296"]');
  await expect(oldCell).toHaveAttribute("data-state", "covered", {
    timeout: LINE_LINK_SETTLE_MS,
  });
  const copyLink = oldCell.getByRole("button", {
    name: "Copy link to line 296",
  });
  const newCell = row.locator('td[data-line-new="378"]');

  expect(await readStyle(oldCell.locator(":scope > span"), "color")).toBe(
    TRANSPARENT,
  );
  expect(await readStyle(copyLink, "color")).toBe(colors.highlightText);
  expect(await readStyle(newCell, "color")).toBe(TRANSPARENT);
});

test("the inbox cursor row and the URL box show where the keyboard is", async ({
  page,
}) => {
  await page.goto("/");
  await waitForFirstLoad(page);
  const colors = await readSystemColors(page);

  await test.step("the inbox cursor row carries a dashed ring", async () => {
    const cursorRow = page.locator('li[data-cursor="true"]');
    await page.keyboard.press("j");
    await expect(cursorRow).toBeVisible();

    expect.soft(await readStyle(cursorRow, "outline-style")).toBe("dashed");
    expect
      .soft(await readStyle(cursorRow, "outline-color"))
      .toBe(colors.highlight);
  });

  await test.step("the URL box shows keyboard focus", async () => {
    const field = page.getByRole("textbox", { name: "Pull request URL" });
    await field.focus();
    const box = page.locator("form").filter({ has: field });

    expect.soft(await readStyle(box, "outline-width")).toBe("2px");
    expect.soft(await readStyle(box, "outline-color")).toBe(colors.highlight);
  });
});

async function readFocusVisible(target: Locator): Promise<boolean> {
  return target.evaluate((element) => element.matches(":focus-visible"));
}

test("the sidebar's current row and selected tab keep their marks", async ({
  page,
}) => {
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);
  const colors = await readSystemColors(page);
  await page.getByRole("button", { name: "Expand sidebar" }).click();

  await test.step("the current row is dashed until focus makes it solid", async () => {
    await page.keyboard.press("j");

    // The rail's position lines are current buttons too; a row is the one with a name.
    const row = page
      .getByTestId("sidebar")
      .locator("button[data-current]")
      .filter({ hasText: /\S/ })
      .first();
    await expect(row).toBeVisible();
    expect.soft(await readStyle(row, "outline-style")).toBe("dashed");
    expect.soft(await readStyle(row, "outline-color")).toBe(colors.highlight);

    // The last interaction was a key, so a scripted focus is focus-visible.
    await row.focus();
    expect.soft(await readFocusVisible(row)).toBe(true);
    expect.soft(await readStyle(row, "outline-style")).toBe("solid");
  });

  await test.step("a focused selected tab rings in a colour its fill lacks", async () => {
    await page.getByRole("tab", { name: "Revisions" }).click();

    // Arrows select as they move, so the focused tab is the selected one.
    await page.keyboard.press("ArrowLeft");
    const tab = page.getByRole("tab", { name: "This PR", selected: true });
    await expect(tab).toBeFocused();
    expect.soft(await readFocusVisible(tab)).toBe(true);

    expect.soft(await readFill(tab)).toBe(colors.highlight);
    expect
      .soft(await readStyle(tab, "outline-color"))
      .toBe(colors.highlightText);
  });
});

// Narrow enough for the sidebar's sheet, which lists each group's chunks.
const SHEET_VIEWPORT = { width: 1000, height: 800 };
const CHUNK_READ_WRITE = /\/session\/chunks\/[^/]+\/read$/;

test("a viewed sidebar chunk row shows its tick and an unviewed one none", async ({
  page,
}) => {
  await page.setViewportSize(SHEET_VIEWPORT);
  // Answered here, never saved: the inbox specs count this fixture as unread.
  await page.route(
    (url) => CHUNK_READ_WRITE.test(url.pathname),
    (route) => route.fulfill({ status: 200, json: {} }),
  );
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);
  const colors = await readSystemColors(page);
  const viewedBox = page.getByRole("checkbox", { name: /^Viewed / }).first();
  // The input is visually hidden under its drawn box, which takes the click.
  await viewedBox.focus();
  await page.keyboard.press("Space");
  await expect(viewedBox).toBeChecked();
  await page.getByRole("button", { name: "Expand sidebar" }).click();

  const viewedStatus = page
    .locator("[data-chunk-row][data-viewed] > span")
    .first();
  const unviewedStatus = page
    .locator("[data-chunk-row]:not([data-viewed]) > span")
    .first();
  await expect(viewedStatus.locator("svg")).toBeVisible();
  await expect(unviewedStatus.locator("svg")).toBeHidden();

  expect(await readFill(viewedStatus)).toBe(colors.canvasText);
  expect(await readStyle(viewedStatus.locator("svg"), "color")).toBe(
    colors.canvas,
  );
});
