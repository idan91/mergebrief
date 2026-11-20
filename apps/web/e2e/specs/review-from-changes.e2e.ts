// Review from the Changes Only view, on the Previous brief comparison: the fixture
// seeds no checkpoint, so the Your last review comparison is covered at the
// component level.
//
// The first write here materializes the viewer's review session on the
// fixture PR, which the Inbox then counts as in progress for the rest of
// the run. That is why this file is one of the config's mutating specs,
// which start only after every read-only spec has finished.
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
import { gotoSettledBrief } from "../support/page";

const CHANGES = `${FIXTURE_ROUTE_REV2}&view=changes&compare=previous-brief`;
/** The fixture's Header chunk: its one added line, which its own card renders. */
/** A line the push between the heads added, so the revision span carries it. */
const SPAN_LINE = { file: "viewModel.ts", line: 37, chunkId: "c3" };
const FULL = `${FIXTURE_ROUTE_REV2}&view=full&compare=previous-brief`;
const DISMISSAL_REASON = "Known and accepted for this fixture.";
/** The diff row an open composer sits in. */
const COMPOSER_ROW_SELECTOR = 'tr:has([data-testid="markdown-textarea"])';
const REASON_ROW_SELECTOR = '[data-testid="reason-row"]';

/** A session write the test page made, as the cleanup needs it. */
interface SessionWrites {
  /** One per saved draft: the address that deletes it. */
  draftUrls: Promise<string>[];
  /** One per dismissal: the address and the flags that reopen it. */
  dismissals: { url: string; flags: unknown }[];
}

/**
 * The session is one row per viewer and pull request, shared by every spec
 * in the run, so what a test writes comes back out after it, pass or fail:
 * the inbox specs count an in-progress review on this PR.
 */
let sessionWrites: SessionWrites = { draftUrls: [], dismissals: [] };

async function readDraftUrl(response: Response): Promise<string> {
  const created: unknown = await response.json();
  const hasDraftId =
    typeof created === "object" && created !== null && "draftId" in created;
  if (!hasDraftId || typeof created.draftId !== "string") {
    throw new Error("the draft write answered without a draft id");
  }
  const url = new URL(response.url());
  url.pathname = `${url.pathname}/${created.draftId}`;
  return url.href;
}

function readDismissedFlags(response: Response): unknown {
  const sent: unknown = response.request().postDataJSON();
  const hasFlags = typeof sent === "object" && sent !== null && "flags" in sent;
  return hasFlags ? sent.flags : [];
}

/** Records every draft and dismissal the page writes, from its first response on. */
function trackSessionWrites(page: Page): SessionWrites {
  const writes: SessionWrites = { draftUrls: [], dismissals: [] };
  page.on("response", (response) => {
    const isPost = response.request().method() === "POST";
    if (!isPost || !response.ok()) {
      return;
    }
    const { pathname } = new URL(response.url());
    if (pathname.endsWith("/session/comments")) {
      writes.draftUrls.push(readDraftUrl(response));
    }
    if (pathname.endsWith("/session/risks/dismiss")) {
      writes.dismissals.push({
        url: response.url().replace("/risks/dismiss", "/risks/reopen"),
        flags: readDismissedFlags(response),
      });
    }
  });
  return writes;
}

/** A body unique to this attempt, so a retry never matches a leftover. */
function makeDraftBody(label: string, testInfo: TestInfo): string {
  return `${label} (attempt ${String(testInfo.retry + 1)}, ${String(Date.now())})`;
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
 * A fresh load of Full: what shows came back from the server, in one card,
 * the named owner's when the test knows it.
 */
async function expectDraftInFullAfterReload(
  page: Page,
  body: string,
  ownerChunkId?: string,
): Promise<void> {
  await page.goto(FULL);
  await expect(page.getByRole("radio", { name: "Full brief" })).toBeChecked();
  const card =
    ownerChunkId === undefined
      ? findChunkCardWith(page, body)
      : page.locator(`article#${ownerChunkId}`);
  await expect(card).toHaveCount(1);
  const draft = card.getByText(body);
  await draft.scrollIntoViewIfNeeded();
  await expect(draft).toBeVisible();
}

function findResolvedFold(page: Page): Locator {
  return page
    .getByRole("button", { name: "1 resolved" })
    .filter({ visible: true })
    .first();
}

test.beforeEach(({ page }) => {
  sessionWrites = trackSessionWrites(page);
});

/** Takes back what the test wrote, through the API the page wrote it with. */
test.afterEach(async ({ page, baseURL }) => {
  // A cookie write has to name its origin; a browser adds this by itself.
  const headers = { origin: baseURL ?? "" };
  for (const url of await Promise.all(sessionWrites.draftUrls)) {
    const deleted = await page.request.delete(url, { headers });
    expect(deleted.ok()).toBe(true);
  }
  for (const { url, flags } of sessionWrites.dismissals) {
    const reopened = await page.request.post(url, { headers, data: { flags } });
    expect(reopened.ok()).toBe(true);
  }
});

test("a comment from a card joins the session and shows in Full", async ({
  page,
}, testInfo) => {
  const body = makeDraftBody(
    "Comment made from the Changes Only card",
    testInfo,
  );
  await gotoSettledBrief(page, CHANGES);
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
  await gotoSettledBrief(page, CHANGES);
  await page.getByRole("button", { name: "Raw diff" }).click();
  const row = findSpanRowOnLine(page, SPAN_LINE.file, SPAN_LINE.line);
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

  await expectDraftInFullAfterReload(page, body, SPAN_LINE.chunkId);
});

test("a flag dismissed from a section reads dismissed on the group card", async ({
  page,
}) => {
  await gotoSettledBrief(page, CHANGES);
  const fileLabel = page
    .locator("label")
    .filter({ has: page.getByRole("checkbox", { name: /Select flags on/ }) })
    .first();
  const fileCheckbox = fileLabel.getByRole("checkbox");
  await fileLabel.click();
  await expect(fileCheckbox).toBeChecked();
  await page.getByRole("button", { name: "Dismiss selected…" }).click();
  await page
    .getByRole("textbox", { name: "Dismissal reason" })
    .fill(DISMISSAL_REASON);
  const dismissed = waitForSessionWrite(page, "POST", "/risks/dismiss");
  await page.getByRole("button", { name: "Dismiss with reason" }).click();
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
  await gotoSettledBrief(page, CHANGES);
  const row = findFirstCommentableRow(page);
  await row.scrollIntoViewIfNeeded();
  await row.locator("[data-comment-anchor]").first().click();
  await expect(page.getByPlaceholder("Leave a comment")).toBeVisible();
  await page.mouse.move(0, 0);
  await expectNoSeriousAxeViolations(page, testInfo, "changes-composer", {
    include: COMPOSER_ROW_SELECTOR,
  });

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Raw diff" }).click();
  const deleted = findFirstInertDeletedRow(page);
  await deleted.scrollIntoViewIfNeeded();
  await deleted.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("reason-row")).toBeVisible();
  await page.mouse.move(0, 0);
  await expectNoSeriousAxeViolations(page, testInfo, "changes-reason-row", {
    include: REASON_ROW_SELECTOR,
  });
});
