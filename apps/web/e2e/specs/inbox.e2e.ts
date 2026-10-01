// Signed in with rows: the Inbox lists both installations and the viewer's
// URL row from one page, folds the rows that need the reviewer above the
// rest, marks each row's review state, and prints a status only when it is
// not Open. The URL row is read live before the list answers.
import { expect, test } from "@playwright/test";

import {
  INBOX_BEHIND_ROW,
  INBOX_ROWS,
  INBOX_URL_ROW_TITLE,
} from "../fixtures/inbox";
import { collectPageFaults } from "../support/console";
import { waitForFirstLoad } from "../support/page";

const [fresh, changed, inProgress, reviewed, yours] = INBOX_ROWS;

test("the Inbox folds, marks and prints status only when not Open", async ({
  page,
}) => {
  const faults = collectPageFaults(page);

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  // The personal line counts every row above the fold and names their states.
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "5 pull requests need your attention",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "1 changed since you reviewed it, 3 are new, 1 in progress.",
    ),
  ).toBeVisible();

  // Rows above the fold in the server's order (most recently updated first),
  // then the quiet line, then the reviewed row and the viewer's own.
  const rows = page.getByTestId("inbox-row");
  await expect(rows).toHaveCount(INBOX_ROWS.length + 2);
  const order = await rows.getByTestId("inbox-row-title").allInnerTexts();
  // The URL row was read live a moment ago, so it is the most recently updated.
  expect(order.slice(0, 4)).toEqual([
    INBOX_URL_ROW_TITLE,
    fresh?.title,
    changed?.title.replaceAll("`", ""),
    inProgress?.title,
  ]);
  // The behind row is new too, read live but last touched twelve hours ago.
  // The rows after these belong to the specs that erase or archive them.
  expect(order.slice(4, 7)).toEqual([
    INBOX_BEHIND_ROW.title,
    reviewed?.title,
    yours?.title,
  ]);
  await expect(page.getByText("Not waiting on you")).toBeVisible();

  // The row link names the state before the title.
  await expect(
    rows.nth(0).getByRole("link", { name: /^New\. Open\./ }),
  ).toBeAttached();
  await expect(
    rows.nth(1).getByRole("link", { name: /^New\. Open\./ }),
  ).toBeAttached();
  await expect(
    rows
      .nth(2)
      .getByRole("link", { name: /^Updated since your review\. Open\./ }),
  ).toBeAttached();
  await expect(
    rows.nth(3).getByRole("link", { name: /^In progress\. Open\./ }),
  ).toBeAttached();
  await expect(
    rows.nth(4).getByRole("link", { name: /^New\. Open\./ }),
  ).toBeAttached();
  await expect(
    rows.nth(5).getByRole("link", { name: /^Reviewed\. Draft\./ }),
  ).toBeAttached();
  await expect(
    rows.nth(6).getByRole("link", { name: /^Yours\. Open\./ }),
  ).toBeAttached();

  // Status only when it is not Open: the draft row prints Draft, no row
  // prints Open. The URL row carries its source and its live-read head kept
  // it current, so no unreachable chip.
  await expect(rows.nth(5).getByText("Draft", { exact: true })).toBeVisible();
  await expect(page.getByText("Open", { exact: true })).toHaveCount(0);
  await expect(
    rows.nth(0).getByRole("link", { name: /Added from a URL\./ }),
  ).toBeAttached();
  await expect(page.getByText("Unreachable")).toHaveCount(0);

  // Inline code in a title renders as code.
  await expect(rows.nth(2).locator("code")).toHaveText("ledger");

  expect(faults).toEqual([]);

  // GitHub has commits the behind row's brief does not cover: the warning
  // chip, and Regenerate leading its menu.
  const behindRow = rows.nth(4);
  await expect(behindRow.getByText("new commits")).toBeVisible();
  // The actions answer only once the first-load fade has settled.
  await waitForFirstLoad(page);
  await behindRow.hover();
  const more = behindRow.getByRole("button", { name: "More actions" });
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("menuitem", { name: "Regenerate" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByTestId("inbox-row").first().getByText("new commits"),
  ).toHaveCount(0);
});

test("the Generate button waits for a pasted URL", async ({ page }) => {
  await page.goto("/");
  await waitForFirstLoad(page);
  const generate = page.getByRole("button", { name: "Generate brief" });
  await expect(generate).toBeHidden();

  await page
    .getByLabel("Pull request URL")
    .fill("https://github.com/acme/payments/pull/101");
  await expect(generate).toBeVisible();
});

test("the View control unfolds the list into one", async ({ page }) => {
  await page.goto("/");
  await waitForFirstLoad(page);
  await expect(page.getByText("Not waiting on you")).toBeVisible();

  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("option", { name: "Mixed" }).click();

  await expect(page).toHaveURL(/layout=mixed/);
  await expect(page.getByText("Not waiting on you")).toBeHidden();
  await expect(page.getByRole("button", { name: "View Mixed" })).toBeVisible();
});

test("the controls never scroll the page sideways at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/?review=new&layout=mixed");
  await waitForFirstLoad(page);
  await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View Mixed" })).toBeVisible();

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
