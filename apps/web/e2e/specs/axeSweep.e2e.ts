// The axe-core sweep. Every stable page state the rest of the suite reaches
// gets swept; serious/critical fail, moderate/minor are attached to the report.
import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_ROUTE_REV1, FIXTURE_ROUTE_REV2 } from "../fixtures/ids";
import { expectNoSeriousAxeViolations } from "../support/axe";
import { gotoBrief, shortcutsDialog, waitForFirstLoad } from "../support/page";

/** One page state the sweep reaches, named once for every width it runs at. */
interface SweptState {
  /** How the state reads in a test title. */
  title: string;
  /** Keys the advisory attachment; a width prefix keeps it unique. */
  key: string;
  /** Lands on the state and resolves once everything axe reads is drawn. */
  reach: (page: Page) => Promise<void>;
}

const FOCUS_ROUTE = `${FIXTURE_ROUTE_REV2}&focus=true`;

const PICKER: SweptState = {
  title: "the picker front door",
  key: "picker",
  reach: async (page) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The rows fade up on first load; axe reads contrast through opacity.
    await waitForFirstLoad(page);
  },
};

const FULL_BRIEF: SweptState = {
  title: "the full brief",
  key: "full-brief",
  reach: (page) => gotoBrief(page, FIXTURE_ROUTE_REV2),
};

const FIRST_REVISION: SweptState = {
  title: "the first revision",
  key: "first-revision",
  reach: (page) => gotoBrief(page, FIXTURE_ROUTE_REV1),
};

const CHANGES_ONLY: SweptState = {
  title: "the Changes Only span",
  key: "changes-only",
  reach: (page) =>
    gotoBrief(
      page,
      `${FIXTURE_ROUTE_REV2}&view=changes&compare=previous-brief`,
    ),
};

const FOCUS_MODE: SweptState = {
  title: "focus mode",
  key: "focus-mode",
  reach: (page) => gotoBrief(page, FOCUS_ROUTE),
};

const SETTINGS: SweptState = {
  title: "Settings",
  key: "settings",
  reach: async (page) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The token list is a client-only read with no busy mark: the heading
    // arrives with the server render, the list or its empty line only after.
    const tokens = page.getByRole("region", { name: "API tokens" });
    await expect(
      tokens.getByRole("heading", { level: 2, name: "API tokens" }),
    ).toBeAttached();
    await expect(
      tokens.getByRole("list").first().or(tokens.getByText("No tokens yet.")),
    ).toBeVisible();
  },
};

const NOT_FOUND: SweptState = {
  title: "an unknown address",
  key: "not-found",
  reach: async (page) => {
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await waitForAccountSlot(page);
  },
};

/** The account slot is a hidden placeholder until the viewer read lands; phone widths hide it. */
async function waitForAccountSlot(page: Page) {
  await expect(
    page
      .getByRole("button", { name: /^Account menu/ })
      .or(page.getByRole("link", { name: "Sign in with GitHub" })),
  ).toBeVisible();
}

/** The same state at desktop width, where the brief header draws the account slot. */
function addAccountSlotWait(state: SweptState): SweptState {
  return {
    ...state,
    reach: async (page) => {
      await state.reach(page);
      await waitForAccountSlot(page);
    },
  };
}

const DESKTOP_BRIEF_STATES = [
  FULL_BRIEF,
  FIRST_REVISION,
  CHANGES_ONLY,
  FOCUS_MODE,
].map(addAccountSlotWait);
const DESKTOP_SWEEP = [PICKER, ...DESKTOP_BRIEF_STATES, SETTINGS, NOT_FOUND];
const PHONE_SWEEP = [PICKER, FULL_BRIEF, FOCUS_MODE, SETTINGS];
const SIDEWAYS_SWEEP = [FULL_BRIEF, FOCUS_MODE];

const UPRIGHT_PHONE = { width: 390, height: 844 };
const SIDEWAYS_PHONES = [
  { width: 750, height: 342 },
  { width: 844, height: 390 },
  { width: 932, height: 430 },
];

for (const state of DESKTOP_SWEEP) {
  test(`${state.title} is clean`, async ({ page }, testInfo) => {
    await state.reach(page);
    await expectNoSeriousAxeViolations(page, testInfo, state.key);
  });
}

test.describe("at phone width", () => {
  test.use({
    viewport: UPRIGHT_PHONE,
    hasTouch: true,
    isMobile: true,
  });

  for (const state of PHONE_SWEEP) {
    test(`${state.title} is clean`, async ({ page }, testInfo) => {
      await state.reach(page);
      await expectNoSeriousAxeViolations(page, testInfo, `phone-${state.key}`);
    });
  }
});

test("the brief never scrolls sideways at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await gotoBrief(page, FIXTURE_ROUTE_REV2);
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(widths.scroll).toBe(widths.inner);

  // A long hunk title must not push the code past the screen inside its scroller.
  const overflowing = await page.evaluate(
    () =>
      [...document.querySelectorAll("table")].filter((table) => {
        const scroller = table.parentElement;
        return scroller !== null && scroller.scrollWidth > scroller.clientWidth;
      }).length,
  );
  expect(overflowing).toBe(0);
});

/** The side inset a Dynamic Island iPhone reports when held sideways. */
const NOTCH_INSET_PX = 59;
const HOME_INDICATOR_INSET_PX = 21;
const NOTCH_INSETS = [
  { left: NOTCH_INSET_PX, right: 0 },
  { left: 0, right: NOTCH_INSET_PX },
];
/** Sub-pixel rounding between a control's box and the head's content edge. */
const HEAD_END_TOLERANCE_PX = 2;
/** One scroll step while looking for the first mounted chunk card. */
const CHUNK_SEEK_STEP_PX = 300;
const LINE_LINK_MISS_ROUTE = `${FIXTURE_ROUTE_REV1}&l=c9.R1`;
const LINE_LINK_SETTLE_MS = 15_000;

for (const viewport of SIDEWAYS_PHONES) {
  test.describe(`a phone held sideways at ${viewport.width}px`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    for (const state of SIDEWAYS_SWEEP) {
      test(`${state.title} is clean`, async ({ page }, testInfo) => {
        await state.reach(page);
        await expectNoSeriousAxeViolations(
          page,
          testInfo,
          `sideways-${String(viewport.width)}-${state.key}`,
        );
      });
    }

    test("keeps one bar under 50px stuck and never scrolls sideways", async ({
      page,
    }) => {
      await gotoBrief(page, FIXTURE_ROUTE_REV2);
      const reading = await page.evaluate(() => {
        const stuck = [
          ...document.querySelectorAll(
            'header, [data-testid="phone-bar"], [data-testid="reading-toolbar"], [data-testid="sidebar"]',
          ),
        ].filter((element) => {
          const style = getComputedStyle(element);
          const pinned =
            style.position === "sticky" || style.position === "fixed";
          const drawn = element.getBoundingClientRect().height > 0;
          const stuckOnScreen = pinned && style.display !== "none" && drawn;
          return stuckOnScreen;
        });
        const readOffset = (element: Element | null) =>
          element === null
            ? undefined
            : getComputedStyle(element)
                .getPropertyValue("--bottom-sheet-offset")
                .trim();
        const root = getComputedStyle(document.documentElement);
        return {
          stuckHeights: stuck.map(
            (element) => element.getBoundingClientRect().height,
          ),
          scroll: document.documentElement.scrollWidth,
          inner: window.innerWidth,
          sheetOffset: readOffset(document.documentElement),
          bottomReserve: root
            .getPropertyValue("--sidebar-reserve-bottom")
            .trim(),
          asideSheetOffset: readOffset(
            document.querySelector('[data-testid="sidebar"]'),
          ),
        };
      });
      expect(reading.scroll).toBe(reading.inner);
      expect(reading.stuckHeights).toHaveLength(1);
      expect(reading.stuckHeights[0]).toBeLessThan(50);
      expect(reading.sheetOffset).toBe("0px");
      expect(reading.bottomReserve).toBe("0px");
      expect(reading.asideSheetOffset).toBe("0px");
    });

    test("keeps Back and the PR title in focus mode", async ({ page }) => {
      await gotoBrief(page, `${FIXTURE_ROUTE_REV2}&focus=true`);
      await expect
        .poll(async () => (await readHeaderChrome(page)).titleWidth)
        .toBeGreaterThan(40);
      const focused = await readHeaderChrome(page);
      expect(focused.row).toBe(false);
      expect(focused.back).toBe(true);
      expect(focused.headerHeight).toBeLessThan(50);

      await page.keyboard.press("z");
      await expect(page.getByTestId("landscape-row")).toBeVisible();
      const reading = await readHeaderChrome(page);
      expect(reading.row).toBe(true);
      expect(reading.back).toBe(true);
      expect(reading.headerHeight).toBeLessThan(50);
    });

    test("keeps Back through a rotation in focus mode", async ({ page }) => {
      await page.setViewportSize({
        width: viewport.height,
        height: viewport.width,
      });
      await gotoBrief(page, `${FIXTURE_ROUTE_REV2}&focus=true`);
      await page.setViewportSize(viewport);

      await expect
        .poll(async () => (await readHeaderChrome(page)).back)
        .toBe(true);
    });

    test("ends a chunk head's last control at the head's end", async ({
      page,
    }) => {
      await gotoBrief(page, FIXTURE_ROUTE_REV2);
      await scrollToFirstChunk(page);

      const shortfall = await readChunkHeadShortfall(page);

      expect(Math.abs(shortfall)).toBeLessThanOrEqual(HEAD_END_TOLERANCE_PX);
    });

    test("keeps every control clear of a notch on either side", async ({
      page,
    }) => {
      const session = await page.context().newCDPSession(page);
      for (const notch of NOTCH_INSETS) {
        await session.send("Emulation.setSafeAreaInsetsOverride", {
          insets: { ...notch, top: 0, bottom: HOME_INDICATOR_INSET_PX },
        });
        for (const route of [FIXTURE_ROUTE_REV2, FOCUS_ROUTE]) {
          await gotoBrief(page, route);
          const edges = await readControlEdges(page);
          expect(edges.count).toBeGreaterThan(0);
          expect(edges.start).toBeGreaterThanOrEqual(notch.left);
          expect(edges.end).toBeGreaterThanOrEqual(notch.right);
        }

        await gotoBrief(page, LINE_LINK_MISS_ROUTE);
        await expect(page.getByTestId("line-link-notice")).toBeVisible({
          timeout: LINE_LINK_SETTLE_MS,
        });
        const notice = await readControlEdges(page);
        expect(notice.start).toBeGreaterThanOrEqual(notch.left);
        expect(notice.end).toBeGreaterThanOrEqual(notch.right);
      }
    });
  });
}

/** A short screen opens above the story, where the windowed list has mounted no card yet. */
async function scrollToFirstChunk(page: Page): Promise<void> {
  const card = page.getByTestId("brief-chunk").first();
  const seekCard = async () => {
    await page.evaluate((stepPx) => {
      window.scrollBy({ top: stepPx, behavior: "instant" });
    }, CHUNK_SEEK_STEP_PX);
    return card.count();
  };
  await expect.poll(seekCard).toBeGreaterThan(0);
  await card.scrollIntoViewIfNeeded();
}

/** How far the first chunk head's last drawn control ends short of the head's content edge. */
async function readChunkHeadShortfall(page: Page): Promise<number> {
  return page.evaluate(() => {
    const head = document.querySelector(
      '[data-testid="brief-chunk"] > div:first-child',
    );
    if (head === null) {
      throw new Error("no chunk head");
    }
    const style = getComputedStyle(head);
    const contentEnd =
      head.getBoundingClientRect().right -
      Number.parseFloat(style.borderRightWidth) -
      Number.parseFloat(style.paddingRight);
    const controlEnds = [...head.querySelectorAll("*")]
      .filter((element) =>
        element.checkVisibility({ visibilityProperty: true }),
      )
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.width > 1 && box.height > 1)
      .map((box) => box.right);
    if (controlEnds.length === 0) {
      throw new Error("the chunk head draws no control");
    }
    return contentEnd - Math.max(...controlEnds);
  });
}

/** The nearest the header's controls, chunk cards, chunk heads and notice buttons come to each screen side. */
async function readControlEdges(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header:has(h1)");
    const elements = [
      ...(header?.querySelectorAll("a, button, h1") ?? []),
      ...document.querySelectorAll(
        '[data-testid="brief-chunk"], [data-testid="brief-chunk"] > div:first-child button, [data-testid="chunk-footer"] button, [data-testid="focus-panel-tab"], [data-testid="line-link-notice"] button',
      ),
    ];
    const drawn = elements
      .filter((element) =>
        element.checkVisibility({ visibilityProperty: true }),
      )
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.width > 1 && box.height > 1);
    return {
      count: drawn.length,
      start: Math.min(...drawn.map((box) => box.left)),
      end: Math.min(...drawn.map((box) => window.innerWidth - box.right)),
    };
  });
}

/** What the sticky header shows: the sideways row, a visible Back, the h1's drawn width. */
async function readHeaderChrome(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header:has(h1)");
    const isDrawn = (element: Element) =>
      element.getBoundingClientRect().width > 1;
    const backLinks = [
      ...(header?.querySelectorAll('a[aria-label="Back to briefs"]') ?? []),
    ];
    const titles = [...(header?.querySelectorAll("h1") ?? [])];
    const drawnTitle = titles.find(isDrawn);
    return {
      row:
        header?.querySelector('[data-testid="landscape-row"]') instanceof
        HTMLElement,
      back: backLinks.some(isDrawn),
      titleWidth: drawnTitle?.getBoundingClientRect().width ?? 0,
      headerHeight: header?.getBoundingClientRect().height ?? 0,
    };
  });
}

test("the shortcuts dialog is clean", async ({ page }, testInfo) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);
  await page.keyboard.press("Shift+Slash");
  await expect(shortcutsDialog(page)).toBeVisible();
  await expectNoSeriousAxeViolations(page, testInfo, "shortcuts-dialog");
});

test("the submit modal is clean on all views", async ({ page }, testInfo) => {
  await gotoBrief(page, FIXTURE_ROUTE_REV2);
  // One modal owns the whole flow: the header CTA lands on the advisory view
  // (the fixture has unresolved items), Continue reaches the verdict-first
  // form, and the receipt is a preview view inside the same dialog.
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Before you submit" }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
  await expectNoSeriousAxeViolations(page, testInfo, "submit-modal-advisory");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Submit review" }),
  ).toBeVisible();
  // Park the cursor off the dialog before sweeping: the click leaves it where
  // the next view's Submit button lands, and axe then samples that button's
  // :hover background mid-transition, a phantom contrast failure.
  await page.mouse.move(0, 0);
  await expectNoSeriousAxeViolations(page, testInfo, "submit-modal-verdict");
  await page.getByRole("button", { name: "Preview receipt" }).click();
  await expect(
    page.getByRole("heading", { name: "Verification receipt" }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
  await expectNoSeriousAxeViolations(page, testInfo, "submit-modal-receipt");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Submit review" }),
  ).toBeVisible();
});
