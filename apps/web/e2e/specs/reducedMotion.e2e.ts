// Spec 4 (BRIEF-113): the reduced-motion contract. `prefersReducedMotion()`
// is read at CALL time inside the chunk scroller, so the only honest way to
// judge it is a real media query in a real browser — jsdom has no
// `matchMedia` implementation to emulate against, and the value it would
// return is whatever the test stubbed.
//
// The observable is the scroll REQUEST, not the resulting offset: a smooth
// scroll animates over frames, so asserting on `window.scrollY` would race
// the animation. Patching `window.scrollTo` before any app code runs records
// the behaviour the app asked for.
import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_BRIEF_REV2 } from "../fixtures/ids";
import { gotoBrief } from "../support/page";

/** Records every scroll request the page makes, in order. */
const RECORD_SCROLL_REQUESTS = `
  const requests = [];
  Object.defineProperty(window, "e2eScrollRequests", { value: requests });
  const nativeScrollTo = window.scrollTo.bind(window);
  window.scrollTo = function (options) {
    requests.push(options);
    return nativeScrollTo(options);
  };
`;

interface ScrollRequest {
  behavior?: string;
  top?: number;
}

async function scrollBehaviors(page: Page): Promise<(string | undefined)[]> {
  const requests = await page.evaluate(
    () =>
      (window as unknown as { e2eScrollRequests: ScrollRequest[] })
        .e2eScrollRequests,
  );
  return requests
    .filter((request) => typeof request === "object" && request !== null)
    .map((request) => request.behavior);
}

/**
 * Start the read-through and return the behaviours it requested. Read-through
 * is the top-aligning scroll path (`scrollElementToTop`), the one place the
 * screen asks for a smooth scroll by default.
 */
async function readThroughBehaviors(
  page: Page,
): Promise<(string | undefined)[]> {
  await page.addInitScript(RECORD_SCROLL_REQUESTS);
  await gotoBrief(page, `/briefs/${FIXTURE_BRIEF_REV2}`);
  // Drop the scroll restoration the router performs on arrival — only the
  // read-through's own request is under test.
  await page.evaluate(() => {
    (
      window as unknown as { e2eScrollRequests: unknown[] }
    ).e2eScrollRequests.length = 0;
  });
  await page.getByRole("button", { name: "Start read-through" }).click();
  await expect.poll(() => scrollBehaviors(page)).not.toHaveLength(0);
  return scrollBehaviors(page);
}

test("read-through scrolls smoothly by default", async ({ page }) => {
  expect(await readThroughBehaviors(page)).toContain("smooth");
});

test("read-through snaps when the viewer asks for reduced motion", async ({
  page,
}) => {
  // `page.emulateMedia` is used rather than the `reducedMotion` fixture
  // option: the option did not reach `matchMedia` in this Playwright build
  // (measured — the query still returned false), while `emulateMedia` does.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const behaviors = await readThroughBehaviors(page);
  expect(behaviors).toContain("auto");
  expect(behaviors).not.toContain("smooth");
});
