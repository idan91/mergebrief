// Dates render in one zone everywhere the suite runs; a formatted date in an
// assertion must not depend on the machine's clock setting.
process.env["TZ"] = "UTC";

import { afterEach } from "vitest";

// Only a DOM file pays for Testing Library and the catalog. A node file that
// renders t() consumers imports the provider module, which registers THE app
// instance as react-i18next's default on import.
if (typeof document !== "undefined") {
  const [{ cleanup }, { setI18n }, { appI18n }] = await Promise.all([
    import("@testing-library/react"),
    import("react-i18next"),
    import("../i18n/I18nProvider"),
  ]);

  setI18n(appI18n);

  // Without vitest globals RTL never registers its own unmount, so a tree
  // from one test would stay mounted into the next.
  afterEach(cleanup);
}

/** Expires every cookie the document holds; a no-op outside jsdom. */
export function clearCookies(): void {
  if (typeof document === "undefined") {
    return;
  }
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0]?.trim() ?? "";
    if (name !== "") {
      document.cookie = `${name}=; Path=/; Max-Age=0`;
    }
  }
}

// A preference cookie outlives its test: a sidebar one test left open would
// render open in the next.
afterEach(clearCookies);

// Vitest global setup. jsdom does not implement ResizeObserver, which
// Header.tsx uses to track its height; without this stub the brief screen
// throws into its error boundary under test ("Brief failed to load").
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Every IntersectionObserver constructed under test, newest last. A stub that
 * only swallows calls leaves observer-driven behaviour untestable; tests drive
 * it by invoking a recorded callback with a synthetic entry. */
export const intersectionObservers: {
  callback: IntersectionObserverCallback;
  rootMargin: string;
  disconnected: boolean;
}[] = [];

/** jsdom ships no IntersectionObserver; the header uses one to know when the
 * change content reaches it. */
class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[] = [];
  private readonly record: (typeof intersectionObservers)[number];

  constructor(
    callback: IntersectionObserverCallback,
    init?: IntersectionObserverInit,
  ) {
    this.rootMargin = init?.rootMargin ?? "";
    this.record = {
      callback,
      rootMargin: this.rootMargin,
      disconnected: false,
    };
    intersectionObservers.push(this.record);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    this.record.disconnected = true;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const mediaQueryMatches = new Map<string, boolean>();
const mediaQueryLists: MediaQueryListStub[] = [];

/** jsdom ships no layout, so a media query answers false until a test flips it. */
class MediaQueryListStub extends EventTarget implements MediaQueryList {
  onchange:
    | ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown)
    | null = null;

  constructor(readonly media: string) {
    super();
    mediaQueryLists.push(this);
  }

  get matches(): boolean {
    return mediaQueryMatches.get(this.media) ?? false;
  }

  addListener(): void {}
  removeListener(): void {}
}

/** Flip a query's answer and notify its listeners, the way a resize would. */
export function setMediaQueryMatches(media: string, matches: boolean): void {
  mediaQueryMatches.set(media, matches);
  for (const list of mediaQueryLists) {
    if (list.media === media) {
      list.dispatchEvent(new Event("change"));
    }
  }
}

export function resetMediaQueries(): void {
  mediaQueryMatches.clear();
}

/** jsdom's window width before any test resizes it. */
const DEFAULT_VIEWPORT_WIDTH_PX = 1024;

/** Resize the window and notify its listeners, the way a rotation would; no scrollbar. */
export function setViewportWidth(widthPx: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: widthPx,
  });
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: widthPx,
  });
  window.dispatchEvent(new Event("resize"));
}

export function resetViewportWidth(): void {
  setViewportWidth(DEFAULT_VIEWPORT_WIDTH_PX);
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub;
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = IntersectionObserverStub;
}

if (typeof globalThis.matchMedia === "undefined") {
  globalThis.matchMedia = (query: string) => new MediaQueryListStub(query);
}

if (
  typeof Element !== "undefined" &&
  typeof Element.prototype.scrollIntoView === "undefined"
) {
  Element.prototype.scrollIntoView = () => {};
}
