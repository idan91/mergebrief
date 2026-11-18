// The two not-found pages through the real server: a 404 status, the shell
// Header, a working way home, and nothing echoed from the address.
import { expect, test } from "@playwright/test";

import { MISSING_PR_PATH } from "../fixtures/ids";
import { expectNoSeriousAxeViolations } from "../support/axe";
import { collectPageFaults, type PageFault } from "../support/console";

const PR_NOT_FOUND_HEADING = "This pull request isn't available";
const DOCUMENT_404_LINE =
  "Failed to load resource: the server responded with a status of 404";

/** The browser logs the document's own 404 status; that line is the contract, not a fault. */
function dropDocumentStatusFault(
  faults: readonly PageFault[],
  path: string,
): PageFault[] {
  return faults.filter((fault) => {
    const isStatusLine = fault.text.startsWith(DOCUMENT_404_LINE);
    const isDocumentStatus = isStatusLine && fault.text.endsWith(path);
    return !isDocumentStatus;
  });
}

test("an unknown address answers 404 with a way home", async ({
  page,
}, testInfo) => {
  const faults = collectPageFaults(page);

  const response = await page.goto("/nope");
  expect(response?.status()).toBe(404);

  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: "This page doesn't exist" }),
  ).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
  await expectNoSeriousAxeViolations(page, testInfo, "not-found-root");

  await main.getByRole("link", { name: "Go home" }).click();
  await expect(page).toHaveURL("/");
  expect(dropDocumentStatusFault(faults, "/nope")).toEqual([]);
});

test("a pull request with no row answers 404 and echoes nothing", async ({
  page,
}, testInfo) => {
  const faults = collectPageFaults(page);

  const response = await page.goto(MISSING_PR_PATH);
  expect(response?.status()).toBe(404);

  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: PR_NOT_FOUND_HEADING }),
  ).toBeVisible();
  await expect(main).toContainText(
    "It may not exist, or your GitHub account may not have access to it.",
  );
  await expect(main).not.toContainText("424242");
  await expect(main).not.toContainText("999");
  await expect(main.getByRole("link", { name: "Go home" })).toHaveAttribute(
    "href",
    "/",
  );
  await expectNoSeriousAxeViolations(page, testInfo, "not-found-pr");
  expect(dropDocumentStatusFault(faults, MISSING_PR_PATH)).toEqual([]);
});

test("a malformed repository id renders the same page", async ({ page }) => {
  const faults = collectPageFaults(page);

  const response = await page.goto("/repos/abc/pulls/1");
  expect(response?.status()).toBe(404);

  await expect(
    page
      .getByRole("main")
      .getByRole("heading", { level: 1, name: PR_NOT_FOUND_HEADING }),
  ).toBeVisible();
  expect(dropDocumentStatusFault(faults, "/repos/abc/pulls/1")).toEqual([]);
});
