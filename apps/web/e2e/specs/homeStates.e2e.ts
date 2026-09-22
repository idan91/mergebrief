// Every signed-in Home state the seeded rows cannot show on their own: an
// empty Inbox, a filter set that matches nothing, rows hidden by the default
// status, a viewer GitHub shows no installation, and a list GitHub failed to
// answer. Each state viewer has its own session and its own scripted answer
// from the stub.
import { expect, test, type Page } from "@playwright/test";

import {
  buildStorageState,
  E2E_APP_SLUG,
  E2E_SESSION_COOKIE,
  E2E_STATE_VIEWERS,
} from "../harness/env";
import { expectNoSeriousAxeViolations } from "../support/axe";
import { collectPageFaults } from "../support/console";

async function openHomeAs(
  page: Page,
  viewer: keyof typeof E2E_STATE_VIEWERS,
): Promise<void> {
  await page
    .context()
    .addCookies(buildStorageState(E2E_STATE_VIEWERS[viewer].cookie).cookies);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
}

test.use({ storageState: { cookies: [], origins: [] } });

test("an empty Inbox says so in the personal line and shows no list", async ({
  page,
}, testInfo) => {
  const faults = collectPageFaults(page);
  await openHomeAs(page, "empty");

  await expect(
    page.getByRole("heading", { level: 1, name: "Nothing to review yet" }),
  ).toBeVisible();
  await expect(page.getByLabel("Pull request URL")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Briefs" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Filters and sort" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("no-installation")).toHaveCount(0);

  await expectNoSeriousAxeViolations(page, testInfo, "home-empty");
  expect(faults).toEqual([]);
});

test("filtered to nothing explains the default status and clears", async ({
  page,
}, testInfo) => {
  const faults = collectPageFaults(page);
  await page
    .context()
    .addCookies(buildStorageState(E2E_SESSION_COOKIE).cookies);

  await page.goto("/?review=reviewed&author=mine");

  await expect(
    page.getByRole("heading", {
      level: 3,
      name: "No pull requests match these filters",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Merged and closed pull requests are hidden by default."),
  ).toBeVisible();
  await expect(page.getByTestId("inbox-row")).toHaveCount(0);
  await expectNoSeriousAxeViolations(page, testInfo, "home-filtered");

  await page.getByRole("button", { name: "Clear filters" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("inbox-row").first()).toBeVisible();

  await page.goto("/?state=merged");
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: "No pull requests match these filters",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Merged and closed pull requests are hidden by default."),
  ).toHaveCount(0);
  expect(faults).toEqual([]);
});

test("merged and closed rows are hidden until one click shows them", async ({
  page,
}, testInfo) => {
  const faults = collectPageFaults(page);
  await openHomeAs(page, "hidden");

  await expect(
    page.getByRole("heading", { level: 3, name: "No open pull requests" }),
  ).toBeVisible();
  await expect(page.getByTestId("inbox-row")).toHaveCount(0);
  await expectNoSeriousAxeViolations(page, testInfo, "home-hidden");

  await page.getByRole("button", { name: "Show merged and closed" }).click();

  await expect(page).toHaveURL(
    /state=open(,|%2C)draft(,|%2C)merged(,|%2C)closed/,
  );
  await expect(page.getByTestId("inbox-row")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: /Merged before you looked/ }),
  ).toBeVisible();
  expect(faults).toEqual([]);
});

test("no reachable installation adds one line with the install link", async ({
  page,
}, testInfo) => {
  const faults = collectPageFaults(page);
  await openHomeAs(page, "noInstallation");

  const line = page.getByTestId("no-installation");
  await expect(line).toContainText(
    "MergeBrief is installed on no repository you can reach.",
  );
  await expect(
    line.getByRole("link", { name: "Install it on GitHub" }),
  ).toHaveAttribute(
    "href",
    `https://github.com/apps/${E2E_APP_SLUG}/installations/new`,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Nothing to review yet" }),
  ).toBeVisible();

  await expectNoSeriousAxeViolations(page, testInfo, "home-no-installation");
  expect(faults).toEqual([]);
});

test("a failed list keeps the header and URL box and asks again on Try again", async ({
  page,
}, testInfo) => {
  const faults = collectPageFaults(page);
  let inboxReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/inbox") inboxReads += 1;
  });
  await openHomeAs(page, "failed");

  const alert = page.getByRole("alert");
  await expect(
    alert.getByRole("heading", {
      level: 1,
      name: "Briefs could not be loaded",
    }),
  ).toBeVisible();
  await expect(alert).toContainText("GitHub did not answer.");
  await expect(page.getByLabel("Pull request URL")).toBeVisible();
  await expect(page.getByRole("link", { name: "MergeBrief" })).toBeVisible();
  await expectNoSeriousAxeViolations(page, testInfo, "home-failed");

  const before = inboxReads;
  await page.getByRole("button", { name: "Try again" }).click();

  await expect.poll(() => inboxReads).toBeGreaterThan(before);
  await expect(alert).toBeVisible();
  expect(faults).toEqual([]);
});
