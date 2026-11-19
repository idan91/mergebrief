// The axe-core sweep. Every stable page state the rest of the suite reaches
// gets swept; serious/critical fail, moderate/minor are attached to the report.
import { expect, test, type CDPSession, type Page } from "@playwright/test";

import { FIXTURE_ROUTE_REV1, FIXTURE_ROUTE_REV2 } from "../fixtures/ids";
import { expectNoSeriousAxeViolations } from "../support/axe";
import {
  gotoSettledBrief,
  SHORTCUTS_DIALOG_SELECTOR,
  shortcutsDialog,
  waitForFirstLoad,
} from "../support/page";

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
  reach: (page) => gotoSettledBrief(page, FIXTURE_ROUTE_REV2),
};

const FIRST_REVISION: SweptState = {
  title: "the first revision",
  key: "first-revision",
  reach: (page) => gotoSettledBrief(page, FIXTURE_ROUTE_REV1),
};

const CHANGES_ONLY: SweptState = {
  title: "the Changes Only span",
  key: "changes-only",
  reach: async (page) => {
    await gotoSettledBrief(
      page,
      `${FIXTURE_ROUTE_REV2}&view=changes&compare=previous-brief`,
    );
    // The deep link lands on the comparison, with the revision narrative for
    // this span and not the whole brief's story.
    await expect(
      page.getByRole("radio", { name: "Changes only" }),
    ).toBeChecked();
    await expect(
      page.getByRole("radio", { name: "Previous brief", exact: true }),
    ).toBeChecked();
    const main = page.locator("#main-content");
    await expect(main).toContainText("Changes since the previous brief");
    await expect(main).toContainText(
      "This revision extracts the chunk scroller",
    );
  },
};

const FOCUS_MODE: SweptState = {
  title: "focus mode",
  key: "focus-mode",
  reach: (page) => gotoSettledBrief(page, FOCUS_ROUTE),
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
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);
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

interface StuckChrome {
  stuckHeights: number[];
  scroll: number;
  inner: number;
  sheetOffset: string | undefined;
  bottomReserve: string;
  asideSheetOffset: string | undefined;
}

/** The bars pinned on screen, the page's width, and the room the sheet reserves. */
async function readStuckChrome(page: Page): Promise<StuckChrome> {
  return page.evaluate(() => {
    const stuck = [
      ...document.querySelectorAll(
        'header, [data-testid="phone-bar"], [data-testid="reading-toolbar"], [data-testid="sidebar"]',
      ),
    ].filter((element) => {
      const style = getComputedStyle(element);
      const pinned = style.position === "sticky" || style.position === "fixed";
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
      bottomReserve: root.getPropertyValue("--sidebar-reserve-bottom").trim(),
      asideSheetOffset: readOffset(
        document.querySelector('[data-testid="sidebar"]'),
      ),
    };
  });
}

interface Notch {
  left: number;
  right: number;
}

/** What `env(safe-area-inset-*)` resolves to on each side right now. */
async function readSideInsets(page: Page): Promise<Notch> {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.paddingLeft = "env(safe-area-inset-left)";
    probe.style.paddingRight = "env(safe-area-inset-right)";
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const insets = {
      left: Number.parseFloat(style.paddingLeft),
      right: Number.parseFloat(style.paddingRight),
    };
    probe.remove();
    return insets;
  });
}

/** The override reaches a loaded page without a reload; resolves once it has. */
async function overrideSideInsets(
  page: Page,
  session: CDPSession,
  notch: Notch,
): Promise<void> {
  await session.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { ...notch, top: 0, bottom: HOME_INDICATOR_INSET_PX },
  });
  await expect.poll(() => readSideInsets(page)).toEqual(notch);
}

for (const viewport of SIDEWAYS_PHONES) {
  test.describe(`a phone held sideways at ${viewport.width}px`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test("the full brief is clean, keeps one bar and ends chunk heads", async ({
      page,
    }, testInfo) => {
      await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);

      await test.step("is clean", () =>
        expectNoSeriousAxeViolations(
          page,
          testInfo,
          `sideways-${String(viewport.width)}-${FULL_BRIEF.key}`,
        ));

      await test.step("keeps one bar under 50px stuck, never scrolls sideways", async () => {
        const reading = await readStuckChrome(page);
        expect.soft(reading.scroll).toBe(reading.inner);
        expect.soft(reading.stuckHeights).toHaveLength(1);
        expect.soft(reading.stuckHeights[0]).toBeLessThan(50);
        expect.soft(reading.sheetOffset).toBe("0px");
        expect.soft(reading.bottomReserve).toBe("0px");
        expect.soft(reading.asideSheetOffset).toBe("0px");
      });

      await test.step("ends a chunk head's last control at the head's end", async () => {
        await scrollToFirstChunk(page);

        const shortfall = await readChunkHeadShortfall(page);

        expect
          .soft(Math.abs(shortfall))
          .toBeLessThanOrEqual(HEAD_END_TOLERANCE_PX);
      });
    });

    test("focus mode is clean and keeps Back and the PR title", async ({
      page,
    }, testInfo) => {
      await gotoSettledBrief(page, FOCUS_ROUTE);

      await test.step("is clean", () =>
        expectNoSeriousAxeViolations(
          page,
          testInfo,
          `sideways-${String(viewport.width)}-${FOCUS_MODE.key}`,
        ));

      await test.step("keeps Back and the PR title", async () => {
        await expect
          .poll(async () => (await readHeaderChrome(page)).titleWidth)
          .toBeGreaterThan(40);
        const focused = await readHeaderChrome(page);
        expect.soft(focused.row).toBe(false);
        expect.soft(focused.back).toBe(true);
        expect.soft(focused.headerHeight).toBeLessThan(50);

        await page.keyboard.press("z");
        await expect(page.getByTestId("landscape-row")).toBeVisible();
        const reading = await readHeaderChrome(page);
        expect.soft(reading.row).toBe(true);
        expect.soft(reading.back).toBe(true);
        expect.soft(reading.headerHeight).toBeLessThan(50);
      });
    });

    test("keeps Back through a rotation in focus mode", async ({ page }) => {
      await page.setViewportSize({
        width: viewport.height,
        height: viewport.width,
      });
      await gotoSettledBrief(page, FOCUS_ROUTE);
      await page.setViewportSize(viewport);

      await expect
        .poll(async () => (await readHeaderChrome(page)).back)
        .toBe(true);
    });

    test("keeps every control clear of a notch on either side", async ({
      page,
    }) => {
      const session = await page.context().newCDPSession(page);
      for (const route of [FIXTURE_ROUTE_REV2, FOCUS_ROUTE]) {
        await gotoSettledBrief(page, route);
        for (const notch of NOTCH_INSETS) {
          await overrideSideInsets(page, session, notch);
          const edges = await readControlEdges(page);
          expect.soft(edges.count).toBeGreaterThan(0);
          expect.soft(edges.start).toBeGreaterThanOrEqual(notch.left);
          expect.soft(edges.end).toBeGreaterThanOrEqual(notch.right);
        }
      }

      await gotoSettledBrief(page, LINE_LINK_MISS_ROUTE);
      await expect(page.getByTestId("line-link-notice")).toBeVisible({
        timeout: LINE_LINK_SETTLE_MS,
      });
      for (const notch of NOTCH_INSETS) {
        await overrideSideInsets(page, session, notch);
        const notice = await readControlEdges(page);
        expect.soft(notice.start).toBeGreaterThanOrEqual(notch.left);
        expect.soft(notice.end).toBeGreaterThanOrEqual(notch.right);
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

const DIALOG_SELECTOR = '[role="dialog"]';
const RECEIPT_PHONE = { width: 390, height: 844 };
const SUBPIXEL = 0.5;

test("the shortcuts dialog and every submit modal view are clean", async ({
  page,
}, testInfo) => {
  await gotoSettledBrief(page, FIXTURE_ROUTE_REV2);

  await test.step("the shortcuts dialog", async () => {
    await page.keyboard.press("Shift+Slash");
    await expect(shortcutsDialog(page)).toBeVisible();
    await expectNoSeriousAxeViolations(page, testInfo, "shortcuts-dialog", {
      include: SHORTCUTS_DIALOG_SELECTOR,
    });
    await page.keyboard.press("Escape");
    await expect(shortcutsDialog(page)).toBeHidden();
  });

  // One modal owns the whole flow: the header CTA lands on the advisory view
  // (the fixture has unresolved items), Continue reaches the verdict-first
  // form, and the receipt is a preview view inside the same dialog. The
  // cursor is parked off the dialog before each sweep: a click leaves it
  // where the next view's button lands, and axe then samples that button's
  // :hover background mid-transition, a phantom contrast failure.
  await test.step("the advisory view", async () => {
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Before you submit" }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await expectNoSeriousAxeViolations(
      page,
      testInfo,
      "submit-modal-advisory",
      { include: DIALOG_SELECTOR },
    );
  });

  await test.step("the verdict view", async () => {
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Submit review" }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await expectNoSeriousAxeViolations(page, testInfo, "submit-modal-verdict", {
      include: DIALOG_SELECTOR,
    });
  });

  await test.step("the receipt view", async () => {
    await page.getByRole("button", { name: "Preview receipt" }).click();
    await expect(
      page.getByRole("heading", { name: "Verification receipt" }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await expectNoSeriousAxeViolations(page, testInfo, "submit-modal-receipt", {
      include: DIALOG_SELECTOR,
    });
  });

  await test.step("the receipt tile numbers share one baseline at 390px", async () => {
    const desktop = page.viewportSize();
    await page.setViewportSize(RECEIPT_PHONE);
    const tiles = page.getByRole("dialog").locator("dl", {
      has: page.getByText("Inline comments", { exact: true }),
    });
    const numberTops = await tiles
      .locator("dd")
      .evaluateAll((numbers) =>
        numbers.map((number) => number.getBoundingClientRect().top),
      );

    const spread = Math.max(...numberTops) - Math.min(...numberTops);

    expect.soft(numberTops).toHaveLength(3);
    expect.soft(spread).toBeLessThan(SUBPIXEL);
    if (desktop !== null) {
      await page.setViewportSize(desktop);
    }
  });

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Submit review" }),
  ).toBeVisible();
});
