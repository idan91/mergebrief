// Review from the Changes Only view, on the Previous brief comparison: the fixture
// seeds no checkpoint, so the Your last review comparison is covered at the
// component level.
//
// The first write here materializes the viewer's review session on the
// fixture PR, which the Inbox then counts as in progress for the rest of
// the run. Files run in path order on the one worker, so this file's name
// sorts after the inbox specs; keep it that way.
import {
  expect,
  type Locator,
  type Page,
  type Response,
  test,
  type TestInfo,
} from "@playwright/test";

import { FIXTURE_ROUTE_REV2 } from "../fixtures/ids";
import { expectNoSeriousAxeViolations } from "../support/axe";
import { gotoBrief } from "../support/page";

const CHANGES = `${FIXTURE_ROUTE_REV2}&view=changes&compare=previous-brief`;
/** The fixture's Header chunk: its one added line, which its own card renders. */
const HEADER_LINE = { file: "Header.tsx", line: 75, chunkId: "c1" };
const FULL = `${FIXTURE_ROUTE_REV2}&view=full&compare=previous-brief`;
const DISMISSAL_REASON = "Known and accepted for this fixture.";
/** How long cleanup waits for a leftover to show before deciding it is gone. */
const LEFTOVER_TIMEOUT_MS = 5000;

/**
 * The session is one row per viewer and pull request, shared by every spec
 * in the run, so what a test writes comes back out after it, pass or fail:
 * the inbox specs count an in-progress review on this PR.
 */
const pendingDrafts = new Set<string>();
let flagDismissed = false;

/** A body unique to this attempt, so a retry never matches a leftover. */
function makeDraftBody(label: string, testInfo: TestInfo): string {
  const body = `${label} (attempt ${String(testInfo.retry + 1)}, ${String(Date.now())})`;
  pendingDrafts.add(body);
  return body;
}

/**
 * The session write an action sends, armed before the click that sends it.
 * Optimistic paint is not proof the server took the write; the response is.
 */
function waitForSessionWrite(
  page: Page,
  method: string,
  suffix: string,
): Promise<Response> {
  return page.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    const isWrite = response.request().method() === method;
    return isWrite && pathname.includes(`/session${suffix}`);
  });
}

/** True once the locator attaches; false when it never does in time. */
function waitForAppearance(locator: Locator): Promise<boolean> {
  return locator
    .first()
    .waitFor({ state: "attached", timeout: LEFTOVER_TIMEOUT_MS })
    .then(
      () => true,
      () => false,
    );
}

/** Both scope panes stay mounted; only the shown one has visible rows. */
function findFirstCommentableRow(page: Page): Locator {
  return page.locator("tr[data-commentable]").filter({ visible: true }).first();
}

function findFirstInertDeletedRow(page: Page): Locator {
  return page
    .locator('tr[data-line-kind="del"][aria-disabled="true"]')
    .filter({ visible: true })
    .first();
}

/**
 * A span row whose line an owner's card renders: the raw diff shows every
 * PR diff row, while a card shows its chunk's changed rows and two lines
 * around each, so the draft is looked for on a changed line.
 */
function findSpanRowOnLine(page: Page, file: string, line: number): Locator {
  const lineNumber = page.locator(`[data-line-new="${String(line)}"]`);
  return page
    .locator("details")
    .filter({ hasText: file })
    .locator("tr[data-commentable]")
    .filter({ has: lineNumber })
    .first();
}

function findChunkCardWith(page: Page, text: string): Locator {
  return page
    .locator('article[data-testid="brief-chunk"]')
    .filter({ hasText: text });
}

/** The scope radios are visually hidden inputs; their label text takes the click. */
async function switchToFull(page: Page): Promise<void> {
  await page.getByText("Full brief", { exact: true }).first().click();
  await expect(page.getByRole("radio", { name: "Full brief" })).toBeChecked();
}

async function saveDraft(page: Page, body: string): Promise<void> {
  await page.getByPlaceholder("Leave a comment").fill(body);
  const written = waitForSessionWrite(page, "POST", "/comments");
  await page
    .getByRole("button", { name: /Start review|Add review comment/ })
    .click();
  expect((await written).ok()).toBe(true);
  await expect(page.getByText(body).filter({ visible: true })).toBeVisible();
}

/**
 * A fresh load, then Full: what shows came back from the server, in one
 * card, the named owner's when the test knows it.
 */
async function expectDraftInFullAfterReload(
  page: Page,
  body: string,
  ownerChunkId?: string,
): Promise<void> {
  await gotoBrief(page, CHANGES);
  await switchToFull(page);
  const card =
    ownerChunkId === undefined
      ? findChunkCardWith(page, body)
      : page.locator(`article#${ownerChunkId}`);
  await expect(card).toHaveCount(1);
  const draft = card.getByText(body);
  await draft.scrollIntoViewIfNeeded();
  await expect(draft).toBeVisible();
}

/** Deletes through the draft's own card; both panes lose the text. */
async function deleteDraft(page: Page, body: string): Promise<void> {
  const card = page
    .getByText(body)
    .filter({ visible: true })
    .locator("xpath=ancestor::div[.//*[@data-thread-footer]][1]");
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  const deleted = waitForSessionWrite(page, "DELETE", "/comments/");
  await card.getByRole("button", { name: "Delete draft" }).click();
  expect((await deleted).ok()).toBe(true);
  await expect(page.getByText(body)).toHaveCount(0);
}

function findResolvedFold(page: Page): Locator {
  return page
    .getByRole("button", { name: "1 resolved" })
    .filter({ visible: true })
    .first();
}

async function reopenResolvedFlag(page: Page): Promise<void> {
  await findResolvedFold(page).click();
  const reopened = waitForSessionWrite(page, "POST", "/risks/reopen");
  await page
    .getByRole("button", { name: /^Reopen/ })
    .filter({ visible: true })
    .first()
    .click();
  expect((await reopened).ok()).toBe(true);
  await expect(findResolvedFold(page)).toHaveCount(0);
}

/** A leftover is looked for with a wait, never a snapshot count. */
test.afterEach(async ({ page }) => {
  if (pendingDrafts.size === 0 && !flagDismissed) {
    return;
  }
  await gotoBrief(page, FULL);
  for (const body of pendingDrafts) {
    if (await waitForAppearance(page.getByText(body))) {
      await deleteDraft(page, body);
    }
  }
  pendingDrafts.clear();
  if (flagDismissed && (await waitForAppearance(findResolvedFold(page)))) {
    await reopenResolvedFlag(page);
  }
  flagDismissed = false;
});

test("a comment from a card joins the session and shows in Full", async ({
  page,
}, testInfo) => {
  const body = makeDraftBody(
    "Comment made from the Changes Only card",
    testInfo,
  );
  await gotoBrief(page, CHANGES);
  const row = findFirstCommentableRow(page);
  await row.scrollIntoViewIfNeeded();
  await row.locator("[data-comment-anchor]").first().click();

  await saveDraft(page, body);

  await expectDraftInFullAfterReload(page, body);
});

test("the raw span diff takes a comment and a left row opens its reason", async ({
  page,
}, testInfo) => {
  const body = makeDraftBody("Comment made from the raw span diff", testInfo);
  await gotoBrief(page, CHANGES);
  await page.getByRole("button", { name: "Raw diff" }).click();
  const row = findSpanRowOnLine(page, HEADER_LINE.file, HEADER_LINE.line);
  await row.scrollIntoViewIfNeeded();
  await row.locator("[data-comment-anchor]").first().click();
  await saveDraft(page, body);

  const deleted = findFirstInertDeletedRow(page);
  await deleted.scrollIntoViewIfNeeded();
  await deleted.focus();
  await page.keyboard.press("Enter");
  const reason = page.getByTestId("reason-row");
  await expect(reason).toBeVisible();
  await expect(reason).toContainText("gone from the pull request");
  await expect(reason.getByRole("button", { name: "Close" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(reason).toBeHidden();
  await expect(deleted).toBeFocused();

  await expectDraftInFullAfterReload(page, body, HEADER_LINE.chunkId);
});

test("a flag dismissed from a section reads dismissed on the group card", async ({
  page,
}) => {
  await gotoBrief(page, CHANGES);
  await page
    .getByRole("checkbox", { name: /Select flags on/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Dismiss selected…" }).click();
  await page
    .getByRole("textbox", { name: "Dismissal reason" })
    .fill(DISMISSAL_REASON);
  const dismissed = waitForSessionWrite(page, "POST", "/risks/dismiss");
  await page.getByRole("button", { name: "Dismiss with reason" }).click();
  flagDismissed = true;
  expect((await dismissed).ok()).toBe(true);
  await expect(findResolvedFold(page)).toBeVisible();

  await switchToFull(page);
  const resolved = findResolvedFold(page);
  await resolved.scrollIntoViewIfNeeded();
  await resolved.click();
  // The card names the state, not the reason: Reopen shows on a dismissed
  // flag only, and the Changes pane's fold stays folded.
  await expect(
    page.getByRole("button", { name: /^Reopen/ }).filter({ visible: true }),
  ).toHaveCount(1);
});

test("Changes Only with a composer and a reason row open is clean", async ({
  page,
}, testInfo) => {
  await gotoBrief(page, CHANGES);
  const row = findFirstCommentableRow(page);
  await row.scrollIntoViewIfNeeded();
  await row.locator("[data-comment-anchor]").first().click();
  await expect(page.getByPlaceholder("Leave a comment")).toBeVisible();
  await page.mouse.move(0, 0);
  await expectNoSeriousAxeViolations(page, testInfo, "changes-composer");

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Raw diff" }).click();
  const deleted = findFirstInertDeletedRow(page);
  await deleted.scrollIntoViewIfNeeded();
  await deleted.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("reason-row")).toBeVisible();
  await page.mouse.move(0, 0);
  await expectNoSeriousAxeViolations(page, testInfo, "changes-reason-row");
});
