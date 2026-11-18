import { expect, test } from "@playwright/test";

import { FIXTURE_ROUTE_REV2 } from "../fixtures/ids";
import { gotoBrief } from "../support/page";

const PHONE = { width: 390, height: 844 };
const SUBPIXEL = 0.5;

test("the receipt tile numbers share one baseline at 390px", async ({
  page,
}) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Preview receipt" }).click();
  await expect(
    page.getByRole("heading", { name: "Verification receipt" }),
  ).toBeVisible();
  await page.setViewportSize(PHONE);

  const tiles = page
    .getByRole("dialog")
    .locator("dl", { has: page.getByText("Inline comments", { exact: true }) });
  const numberTops = await tiles
    .locator("dd")
    .evaluateAll((numbers) =>
      numbers.map((number) => number.getBoundingClientRect().top),
    );

  const spread = Math.max(...numberTops) - Math.min(...numberTops);

  expect(numberTops).toHaveLength(3);
  expect(spread).toBeLessThan(SUBPIXEL);
});
