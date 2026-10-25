// The revision change stepper walks the comparison's rails in document
// order: each step lands on the next rail, and a step back returns to the one
// before, wherever in the reading band the last landing left its rail.
import { expect, type Page, test } from "@playwright/test";

import { FIXTURE_ROUTE_REV2 } from "../fixtures/ids";
import { gotoBrief } from "../support/page";

const COMPARED_FULL = `${FIXTURE_ROUTE_REV2}&view=full&compare=previous-brief`;
const SETTLE_SAMPLE_MS = 150;

async function readVisibleRailKeys(page: Page): Promise<string[]> {
  return page
    .locator("main [data-jump-target]")
    .evaluateAll((rails) =>
      rails
        .filter((rail) => rail.closest("[hidden]") === null)
        .map((rail) => rail.getAttribute("data-jump-target") ?? ""),
    );
}

async function readFocusedRailKey(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.activeElement?.getAttribute("data-jump-target") ?? null,
  );
}

async function waitForScrollToSettle(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        (sampleMs) =>
          new Promise<boolean>((resolve) => {
            const before = window.scrollY;
            window.setTimeout(
              () => resolve(window.scrollY === before),
              sampleMs,
            );
          }),
        SETTLE_SAMPLE_MS,
      ),
    )
    .toBe(true);
}

async function stepTo(
  page: Page,
  buttonName: string,
  expectedKey: string | undefined,
): Promise<void> {
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  await expect.poll(() => readFocusedRailKey(page)).toBe(expectedKey);
  await waitForScrollToSettle(page);
}

test("the change stepper steps through rails in order and back", async ({
  page,
}) => {
  await gotoBrief(page, COMPARED_FULL);
  const keys = await readVisibleRailKeys(page);
  expect(keys.length).toBeGreaterThanOrEqual(3);

  await stepTo(page, "Next change", keys[0]);
  await stepTo(page, "Next change", keys[1]);
  await stepTo(page, "Next change", keys[2]);
  await stepTo(page, "Previous change", keys[1]);
});

test("the change stepper wraps from the last change back to the first", async ({
  page,
}) => {
  await gotoBrief(page, COMPARED_FULL);
  const keys = await readVisibleRailKeys(page);
  const announcement = page.getByTestId("brief-live");

  await stepTo(page, "Previous change", keys.at(-1));
  await expect(announcement).toHaveText("Wrapped around to the last change.");
  await stepTo(page, "Next change", keys[0]);
  await expect(announcement).toHaveText("Wrapped around to the first change.");
});
