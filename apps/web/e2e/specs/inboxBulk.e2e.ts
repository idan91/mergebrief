// The list's header row carries the selection: Archive takes every ticked
// row, Delete counts only the rows the viewer may delete and confirms once,
// and Clear hands focus to the list heading. The rows it touches are its own.
import { expect, test, type Page } from "@playwright/test";

import {
  INBOX_BULK_ARCHIVE_ROW_NUMBERS,
  INBOX_BULK_DELETE_ROW_NUMBER,
  INBOX_ROWS,
} from "../fixtures/inbox";
import { collectPageFaults } from "../support/console";
import { waitForFirstLoad } from "../support/page";

const CLIENT_ENTRY_SCRIPT = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/;

const [, , , nonAdminRow] = INBOX_ROWS;
const deleteRow = INBOX_ROWS.find(
  (row) => row.prNumber === INBOX_BULK_DELETE_ROW_NUMBER,
);
const archiveRows = INBOX_ROWS.filter((row) =>
  INBOX_BULK_ARCHIVE_ROW_NUMBERS.some((number) => number === row.prNumber),
);

test("ticked rows archive together, and Delete counts the deletable ones", async ({
  page,
}) => {
  const faults = collectPageFaults(page);
  const [firstArchive, secondArchive] = archiveRows;
  if (
    deleteRow === undefined ||
    nonAdminRow === undefined ||
    firstArchive === undefined ||
    secondArchive === undefined
  ) {
    throw new Error("the inbox fixture lost its rows");
  }

  await page.goto("/");
  const rows = page.getByTestId("inbox-row");
  const bar = page.getByTestId("selection-header");
  await waitForFirstLoad(page);

  // The input is visually replaced by a drawn box: a click lands on its label.
  await rows.filter({ hasText: firstArchive.title }).locator("label").click();
  await rows.filter({ hasText: secondArchive.title }).locator("label").click();
  await expect(bar.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(bar.getByText("2 selected")).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 2, name: "Briefs" }),
  ).toBeFocused();

  // Shift-click ticks the span from the last toggle. The archive rows are
  // neighbours, so the span reaches one row beyond them: three ticks prove
  // the range, and unticking the extra row leaves the two to archive.
  const titles = await rows.allTextContents();
  const archiveIndices = [firstArchive, secondArchive].map((row) =>
    titles.findIndex((text) => text.includes(row.title)),
  );
  const low = Math.min(...archiveIndices);
  const high = Math.max(...archiveIndices);
  const beyond = high + 1 < titles.length ? high + 1 : low - 1;
  const anchor = beyond > high ? low : high;
  await rows.nth(anchor).locator("label").click();
  await rows
    .nth(beyond)
    .locator("label")
    .click({ modifiers: ["Shift"] });
  await expect(bar.getByText("3 selected")).toBeVisible();
  await rows.nth(beyond).locator("label").click();
  await expect(bar.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Archive 2" }).click();

  await expect(rows.filter({ hasText: firstArchive.title })).toHaveCount(0);
  await expect(rows.filter({ hasText: secondArchive.title })).toHaveCount(0);
  await expect(bar.getByText("2 selected")).toBeHidden();

  await rows.filter({ hasText: deleteRow.title }).locator("label").click();
  await rows.filter({ hasText: nonAdminRow.title }).locator("label").click();
  await expect(page.getByText("1 cannot be deleted")).toBeVisible();
  await page.getByRole("button", { name: "Delete 1" }).click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      level: 2,
      name: `Delete briefs for #${String(deleteRow.prNumber)} acme/payments?`,
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(rows.filter({ hasText: deleteRow.title })).toHaveCount(0);
  await expect(rows.filter({ hasText: nonAdminRow.title })).toHaveCount(1);
  await expect(bar.getByText("1 selected")).toBeVisible();

  expect(faults).toEqual([]);
});

interface HeldClientEntry {
  isHeld: () => boolean;
  release: () => void;
}

/** The document's one module script: the built entry the page hydrates from. */
async function readClientEntryPath(page: Page): Promise<string> {
  const served = await page.request.get("/");
  const entry = CLIENT_ENTRY_SCRIPT.exec(await served.text())?.[1];
  if (entry === undefined) {
    throw new Error("the served document names no client entry");
  }
  return entry;
}

/** Holds the client entry so the page stays server-rendered until released. */
async function holdClientEntry(page: Page): Promise<HeldClientEntry> {
  const entryPath = await readClientEntryPath(page);
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route(
    (url) => url.pathname === entryPath,
    async (route) => {
      held = true;
      await released;
      await route.continue();
    },
  );
  return { isHeld: () => held, release };
}

test("the page checkbox keeps a tick made before the page hydrates", async ({
  page,
}) => {
  const faults = collectPageFaults(page);
  const clientEntry = await holdClientEntry(page);

  await page.goto("/", { waitUntil: "commit" });
  const bar = page.getByTestId("selection-header");
  await bar.locator("label").click();
  await expect.poll(clientEntry.isHeld).toBe(true);
  clientEntry.release();

  await expect(bar.getByText(/^\d+ selected/)).toBeVisible();
  await expect(bar.getByRole("checkbox")).toBeChecked();
  expect(faults).toEqual([]);
});

test("rows then the page ticked before hydration select every row", async ({
  page,
}) => {
  const faults = collectPageFaults(page);
  const clientEntry = await holdClientEntry(page);

  await page.goto("/", { waitUntil: "commit" });
  const rows = page.getByTestId("inbox-row");
  const bar = page.getByTestId("selection-header");
  await rows.nth(0).locator("label").click();
  await rows.nth(1).locator("label").click();
  await bar.locator("label").click();
  await expect.poll(clientEntry.isHeld).toBe(true);
  clientEntry.release();

  await expect(bar.getByRole("checkbox")).toBeChecked();
  const rowCount = await rows.count();
  const everyRowSelected = new RegExp(`^${String(rowCount)} selected`);
  await expect(bar.getByText(everyRowSelected)).toBeVisible();
  expect(faults).toEqual([]);
});
