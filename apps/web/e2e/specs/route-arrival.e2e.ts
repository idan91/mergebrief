// Moving between pages without a document load: the router swaps the page,
// so nothing tells a screen reader it changed and the control that was
// clicked is gone.
import { expect, test } from "@playwright/test";

import { FIXTURE_ROUTE_REV2 } from "../fixtures/ids";
import { gotoBrief, waitForFirstLoad } from "../support/page";

test("a move to another page names it and lands focus on its main region", async ({
  page,
}) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);
  const arrival = page.getByTestId("route-arrival");
  const main = page.locator("#main-content");
  await expect(arrival).toHaveText("");

  await page.getByRole("link", { name: "MergeBrief", exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(arrival).toHaveText("Briefs · MergeBrief");
  await expect(main).toBeFocused();

  await waitForFirstLoad(page);
  await page.getByTestId("inbox-row").first().getByRole("link").first().click();

  await expect(page).toHaveURL(/\/pulls\//);
  await expect(arrival).toHaveText(/.+ · MergeBrief$/);
  await expect(arrival).not.toHaveText("Briefs · MergeBrief");
  await expect(main).toBeFocused();
});
