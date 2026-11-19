import { expect, type Locator, type Page } from "@playwright/test";

import { SHORTCUTS_LIVE_ATTRIBUTE } from "../../src/features/brief/ui/hooks/consts";

export const SHORTCUTS_DIALOG_SELECTOR =
  '[aria-labelledby="shortcuts-modal-heading"]';

/** The shortcuts dialog's outer wrapper, `display:none` while closed. */
export function shortcutsDialog(page: Page): Locator {
  return page.locator(SHORTCUTS_DIALOG_SELECTOR);
}

/**
 * How long a page gets to hydrate. A built page takes well under a second on
 * a developer machine; the rest is margin for a loaded CI runner.
 */
const HYDRATION_BUDGET_MS = 10_000;

interface WaitOptions {
  timeout?: number;
}

/**
 * Resolve once the Inbox rows have settled after their first-load fade. The
 * list flips the mark from a timer its own mount effect starts, and Home
 * hydrates in one commit, so every Home key listener is bound by then.
 */
export async function waitForFirstLoad(
  page: Page,
  { timeout = HYDRATION_BUDGET_MS }: WaitOptions = {},
): Promise<void> {
  await expect(page.locator('[data-first-load="false"]')).toBeAttached({
    timeout,
  });
}

/**
 * Click until the click's effect lands, for a page that carries no hydration
 * mark: a click sent before hydration is lost with no DOM signal.
 */
export async function clickUntilLanded(
  target: Locator,
  landed: () => Promise<void>,
  { timeout = HYDRATION_BUDGET_MS }: WaitOptions = {},
): Promise<void> {
  await expect(async () => {
    await target.click();
    await landed();
  }).toPass({ timeout });
}

/** How long one press waits for the shortcuts dialog before pressing again. */
const SHORTCUT_ANSWER_MS = 500;

/**
 * Resolve once a Brief's shortcut listener is bound: the effect that binds
 * it marks the root element, so a key pressed after this is not lost to
 * hydration.
 */
export async function waitForShortcutsBound(
  page: Page,
  { timeout = HYDRATION_BUDGET_MS }: WaitOptions = {},
): Promise<void> {
  await expect(page.locator(`html[${SHORTCUTS_LIVE_ATTRIBUTE}]`)).toBeAttached({
    timeout,
  });
}

/**
 * Resolve once a Brief answers its shortcuts: one press after the listener
 * is bound opens the shortcuts dialog, which shows the keys are on, and is
 * repeated only if it went unanswered. The dialog is closed again before
 * returning.
 */
export async function waitForInteractive(
  page: Page,
  { timeout = HYDRATION_BUDGET_MS }: WaitOptions = {},
): Promise<void> {
  await waitForShortcutsBound(page, { timeout });
  const dialog = shortcutsDialog(page);
  await expect(async () => {
    await page.keyboard.press("Shift+Slash");
    await expect(dialog).toBeVisible({ timeout: SHORTCUT_ANSWER_MS });
  }).toPass({ timeout });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

/**
 * Resolve once no diff is still loading or waiting on its colours. Both land
 * after first paint and move the rows below them, so a click aimed before
 * then can land on whatever moved under the pointer.
 */
export async function waitForSettledDiffs(
  page: Page,
  { timeout = HYDRATION_BUDGET_MS }: WaitOptions = {},
): Promise<void> {
  await page.waitForFunction(
    () => {
      const loading = document.querySelector("main [aria-busy='true']");
      const uncoloured = document.querySelector('tbody[data-tokens="pending"]');
      return loading === null && uncoloured === null;
    },
    undefined,
    { timeout },
  );
}

/**
 * Navigate to a brief URL (repo route) and wait for it to answer its keys.
 * The perf suite's gate: it does not wait for the diffs.
 */
export async function gotoBrief(
  page: Page,
  path: string,
  options?: WaitOptions,
): Promise<void> {
  await page.goto(path);
  await waitForInteractive(page, options);
}

/** `gotoBrief`, then the diffs at rest: the way onto a brief a test will click. */
export async function gotoSettledBrief(
  page: Page,
  path: string,
): Promise<void> {
  await gotoBrief(page, path);
  await waitForSettledDiffs(page);
}
