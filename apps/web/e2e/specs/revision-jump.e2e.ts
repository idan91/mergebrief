// An outdated thread's Jump to revision: it switches to the revision the
// thread was anchored on and lands on the thread's row in the Conversation
// section. The GitHub stub serves the two outdated threads on the fixture PR.
import { expect, type Page, test } from "@playwright/test";

import {
  FIXTURE_BRIEFED_ANCHOR_THREAD_ID,
  FIXTURE_REV1_HEAD,
  FIXTURE_ROUTE_REV1,
  FIXTURE_ROUTE_REV2,
  FIXTURE_UNBRIEFED_ANCHOR_THREAD_ID,
  FIXTURE_UNBRIEFED_SHA,
} from "../fixtures/ids";
import { gotoBrief } from "../support/page";

const SHORT_SHA = 7;
const REV1_GROUP_TITLE =
  "Add J/K/Z/? keyboard navigation and CSS-only focus mode to the brief screen";
const LANDING_TIMEOUT_MS = 15_000;

function getSectionRow(page: Page, threadId: number) {
  return page.locator(
    `[data-conversation-section-thread="${String(threadId)}"]`,
  );
}

function getJumpButton(page: Page, sha: string) {
  return page.getByRole("button", {
    name: `Jump to revision ${sha.slice(0, SHORT_SHA)}`,
  });
}

async function expandRow(page: Page, threadId: number): Promise<void> {
  const rowButton = getSectionRow(page, threadId)
    .getByTestId("thread-row")
    .first();
  await rowButton.click();
  await expect(rowButton).toHaveAttribute("aria-expanded", "true");
}

async function expandThread(page: Page, threadId: number): Promise<void> {
  await page.locator("#conversation-heading").click();
  await expandRow(page, threadId);
}

async function expectLandedOn(page: Page, threadId: number): Promise<void> {
  const row = getSectionRow(page, threadId);
  await expect(row).toBeInViewport({ timeout: LANDING_TIMEOUT_MS });
  await expect(row.getByTestId("thread-row").first()).toBeFocused({
    timeout: LANDING_TIMEOUT_MS,
  });
}

function isRev1BriefRead(url: string): boolean {
  const parsed = new URL(url);
  const isBriefRead = parsed.pathname.endsWith("/pulls/1/brief");
  const isRev1Read = isBriefRead && parsed.search.includes(FIXTURE_REV1_HEAD);
  return isRev1Read;
}

test("jump switches to the anchor revision and lands on the thread row", async ({
  page,
}) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV1);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page.getByRole("tab", { name: "Revisions" }).click();
  await page.getByRole("button", { name: /^Revision 2\b/ }).click();
  // The repo route encodes the revision as `rev`, not in the path or a head.
  await expect(page).toHaveURL(/[?&]rev=2(?:&|$)/);
  await expect(page).not.toHaveURL(/head=/);

  await expandThread(page, FIXTURE_BRIEFED_ANCHOR_THREAD_ID);
  await getJumpButton(page, FIXTURE_REV1_HEAD).click();

  await expect(page).toHaveURL(/[?&]rev=1(?:&|$)/);
  const threadParam = String(FIXTURE_BRIEFED_ANCHOR_THREAD_ID);
  await expect(page).toHaveURL(new RegExp(`[?&]thread=${threadParam}(?:&|$)`));
  await expectLandedOn(page, FIXTURE_BRIEFED_ANCHOR_THREAD_ID);
  await expect(
    page.getByRole("heading", { name: REV1_GROUP_TITLE }),
  ).toBeVisible();
});

test("a jump lands on an uncached revision, and a second one lands again", async ({
  page,
}) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);
  await expandThread(page, FIXTURE_BRIEFED_ANCHOR_THREAD_ID);

  await test.step("an anchor never briefed keeps the button disabled with its reason", async () => {
    await expandRow(page, FIXTURE_UNBRIEFED_ANCHOR_THREAD_ID);
    const button = getJumpButton(page, FIXTURE_UNBRIEFED_SHA);
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleDescription(
      "This revision was never briefed. Open it on GitHub.",
    );
  });

  // The first jump lands although the target revision is not cached yet.
  const rev1Read = page.waitForResponse((response) =>
    isRev1BriefRead(response.url()),
  );
  await getJumpButton(page, FIXTURE_REV1_HEAD).click();
  await rev1Read;
  await expect(page).toHaveURL(/[?&]rev=1(?:&|$)/);
  await expectLandedOn(page, FIXTURE_BRIEFED_ANCHOR_THREAD_ID);

  await page.evaluate(() => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "instant",
    });
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await expect(
    getSectionRow(page, FIXTURE_BRIEFED_ANCHOR_THREAD_ID),
  ).not.toBeInViewport();
  // A DOM click: Playwright's own click scrolls the button into view first,
  // which would land the row without the app doing anything.
  await getJumpButton(page, FIXTURE_REV1_HEAD).evaluate((button) => {
    if (button instanceof HTMLElement) {
      button.click();
    }
  });

  await expectLandedOn(page, FIXTURE_BRIEFED_ANCHOR_THREAD_ID);
});
