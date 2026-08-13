// Revision/lens interaction measurement harness, run on the generated large
// fixture (`pnpm perf:fixture` first):
//   revision-nav  — click prev/next brief → target revision's content visible
//   lens-flip     — click a View lens radio → lens content committed
// Samples are click-to-visible wall time from the driver; absolute values
// carry protocol overhead, so treat them as BEFORE/AFTER comparisons, not
// truth. Each metric prints one `PERF_RESULT {json}` line for the PR body.
//
// Scope: brief queries carry staleTime Infinity, so after the warmup round
// every revision-nav sample hits the query cache — these numbers isolate the
// key={briefId} REMOUNT cost and cannot see fetch latency. Only cold-load
// touches fetch (as a full document load). A fetch-side change needs a
// cold-cache variant or the DB route to show up here.
import { expect, test, type Page } from "@playwright/test";

import { gotoBrief } from "../support/page";
import { PERF_FIXTURE_REV1_ID, PERF_FIXTURE_REV2_ID } from "./ids";
import { report } from "./report";

const SAMPLES = 5;

/** Rev-specific group heading: the fixture stamps (r1)/(r2) into titles. */
const groupHeading = (page: Page, revTag: string) =>
  page.getByRole("heading", {
    name: `Group 1: rework synthetic subsystem area-1 (${revTag})`,
  });

async function settleOnRevision(page: Page, revTag: string): Promise<void> {
  await expect(groupHeading(page, revTag)).toBeVisible({ timeout: 30_000 });
}

test("revision navigation timing", async ({ page }) => {
  // Hydration gate: a pre-hydration link click is a full document load and
  // would measure an MPA reload, not the client-side transition under test.
  await gotoBrief(page, `/briefs/${PERF_FIXTURE_REV2_ID}`, {
    timeout: 90_000,
  });
  await settleOnRevision(page, "r2");

  const toPrev = page.getByRole("link", { name: "Previous brief, 1" });
  const toNext = page.getByRole("link", { name: "Next brief, 2" });

  // Warmup round: both revisions' loaders and code paths warm before timing.
  await toPrev.click();
  await settleOnRevision(page, "r1");
  await toNext.click();
  await settleOnRevision(page, "r2");

  const prevSamples: number[] = [];
  const nextSamples: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const prevStart = Date.now();
    await toPrev.click();
    await settleOnRevision(page, "r1");
    prevSamples.push(Date.now() - prevStart);

    const nextStart = Date.now();
    await toNext.click();
    await settleOnRevision(page, "r2");
    nextSamples.push(Date.now() - nextStart);
  }
  report("revision-nav-prev", prevSamples);
  report("revision-nav-next", nextSamples);
});

test("lens flip timing", async ({ page }) => {
  // Rev 2 carries previous-brief marks, so the Changes Only lens is live.
  // Hydration gate: the radios are controlled inputs — a pre-hydration click
  // toggles nothing (the known lost-keystroke window `waitForInteractive`
  // exists for).
  await gotoBrief(page, `/briefs/${PERF_FIXTURE_REV2_ID}`, {
    timeout: 90_000,
  });
  await settleOnRevision(page, "r2");

  // The radio input sits under a styled option span that intercepts pointer
  // events — click the visible label text, assert state on the input.
  const changesRadio = page.getByText("Changes Only", { exact: true });
  const fullRadio = page.getByText("Full brief", { exact: true });
  const changesEyebrow = page.getByText(
    "Changes Only · since the previous Brief",
  );

  // Warmup: both lens paths render once before timing.
  await changesRadio.click();
  await expect(changesEyebrow).toBeVisible({ timeout: 30_000 });
  await fullRadio.click();
  await expect(changesEyebrow).toBeHidden({ timeout: 30_000 });

  const toChanges: number[] = [];
  const toFull: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const changesStart = Date.now();
    await changesRadio.click();
    await expect(changesEyebrow).toBeVisible({ timeout: 30_000 });
    toChanges.push(Date.now() - changesStart);

    // Settle on a full-view-only signal: group headings exist in BOTH lenses
    // (ChangesOnlyView renders the same titles), so waiting on one would pass
    // against the stale changes-view DOM and time nothing. The eyebrow leaves
    // the tree in the same commit that renders the full view.
    const fullStart = Date.now();
    await fullRadio.click();
    await expect(changesEyebrow).toBeHidden({ timeout: 30_000 });
    toFull.push(Date.now() - fullStart);
  }
  report("lens-to-changes", toChanges);
  report("lens-to-full", toFull);
});

test("the hidden story pane keeps its windowed cards across a flip", async ({
  page,
}) => {
  // Keep-warm latch proof. Lens radios NAVIGATE (compare rides the URL), so
  // the router resets scroll to top on every flip — pre-existing product
  // behavior, deliberately not asserted here. What the latch owns: while the
  // story pane is hidden its windowed DOM must stay exactly as it was (no
  // re-derive against hidden zero-rects), and the flip back must render a
  // coherent window at the restored (top) scroll position.
  await gotoBrief(page, `/briefs/${PERF_FIXTURE_REV2_ID}`, {
    timeout: 90_000,
  });
  await settleOnRevision(page, "r2");
  await page.evaluate(() => {
    window.scrollTo({ top: 20_000, behavior: "instant" });
  });
  await page.waitForTimeout(800);
  const firstVisible = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>("main article[id]")].find(
          (el) =>
            el.closest("[hidden]") === null &&
            el.getBoundingClientRect().bottom > 0,
        )?.id ?? null,
    );
  const deepCard = await firstVisible();
  expect(deepCard).not.toBeNull();

  const changesRadio = page.getByText("Changes Only", { exact: true });
  const fullRadio = page.getByText("Full brief", { exact: true });
  const changesEyebrow = page.getByText(
    "Changes Only · since the previous Brief",
  );
  await changesRadio.click();
  await expect(changesEyebrow).toBeVisible({ timeout: 30_000 });

  // The hidden pane still holds the deep window it was showing.
  const hiddenIds = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>("main [hidden] article[id]"),
    ].map((el) => el.id),
  );
  expect(hiddenIds).toContain(deepCard);

  await fullRadio.click();
  await expect(changesEyebrow).toBeHidden({ timeout: 30_000 });
  await page.waitForTimeout(500);

  // Router reset scroll to top; the story window must cover the viewport
  // there — a blank band here would mean the latch fed stale geometry.
  expect(await firstVisible()).not.toBeNull();
});

test("cold load timing", async ({ page }) => {
  // Context for the interaction numbers: what a from-scratch render of the
  // large fixture costs. One warm navigation then timed reloads.
  await gotoBrief(page, `/briefs/${PERF_FIXTURE_REV1_ID}`, {
    timeout: 90_000,
  });

  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const start = Date.now();
    await page.reload();
    await settleOnRevision(page, "r1");
    samples.push(Date.now() - start);
  }
  report("cold-load-rev1", samples);
});
