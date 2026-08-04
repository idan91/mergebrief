// Spec 5 (BRIEF-113): the axe-core sweep. Every stable page state the rest
// of the suite reaches gets swept; serious/critical fail, moderate/minor are
// attached to the report (ADR 0038 §4).
import { expect, test } from "@playwright/test";

import { FIXTURE_BRIEF_REV1, FIXTURE_BRIEF_REV2 } from "../fixtures/ids";
import { expectNoSeriousAxeViolations } from "../support/axe";
import { gotoBrief, shortcutsDialog } from "../support/page";

test("the picker front door is clean", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoSeriousAxeViolations(page, testInfo, "picker");
});

test("the full brief is clean", async ({ page }, testInfo) => {
  await gotoBrief(page, `/briefs/${FIXTURE_BRIEF_REV2}`);
  await expectNoSeriousAxeViolations(page, testInfo, "full-brief");
});

test("the first revision is clean", async ({ page }, testInfo) => {
  await gotoBrief(page, `/briefs/${FIXTURE_BRIEF_REV1}`);
  await expectNoSeriousAxeViolations(page, testInfo, "first-revision");
});

test("the Changes Only span is clean", async ({ page }, testInfo) => {
  await gotoBrief(
    page,
    `/briefs/${FIXTURE_BRIEF_REV2}?view=changes&compare=previous-brief`,
  );
  await expectNoSeriousAxeViolations(page, testInfo, "changes-only");
});

test("the shortcuts dialog is clean", async ({ page }, testInfo) => {
  await gotoBrief(page, `/briefs/${FIXTURE_BRIEF_REV2}`);
  await page.keyboard.press("Shift+Slash");
  await expect(shortcutsDialog(page)).toBeVisible();
  await expectNoSeriousAxeViolations(page, testInfo, "shortcuts-dialog");
});

test("the submit modal is clean on both views", async ({ page }, testInfo) => {
  await gotoBrief(page, `/briefs/${FIXTURE_BRIEF_REV2}`);
  // BRIEF-103: the header CTA reads Submit; the advisory pre-submit gate
  // sits between it and the submit modal (BRIEF-137: verdict-first, the
  // receipt is a preview view inside the same dialog).
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.getByRole("button", { name: "Continue to receipt" }).click();
  await expect(
    page.getByRole("heading", { name: "Submit review" }),
  ).toBeVisible();
  // Park the cursor off the dialog before sweeping: the click leaves it where
  // the next view's Submit button lands, and axe then samples that button's
  // :hover background mid-transition — a phantom contrast failure.
  await page.mouse.move(0, 0);
  await expectNoSeriousAxeViolations(page, testInfo, "submit-modal-verdict");
  await page.getByRole("button", { name: "Preview receipt" }).click();
  await expect(
    page.getByRole("heading", { name: "Verification receipt" }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
  await expectNoSeriousAxeViolations(page, testInfo, "submit-modal-receipt");
  await page.getByRole("button", { name: "Back to verdict" }).click();
  await expect(
    page.getByRole("heading", { name: "Submit review" }),
  ).toBeVisible();
});
