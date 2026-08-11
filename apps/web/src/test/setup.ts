// Importing the provider module registers THE app instance as
// react-i18next's default, so component tests render t() consumers without
// wrapping every tree in the provider.
import { appI18n } from "../i18n/I18nProvider";
import { setI18n } from "react-i18next";

setI18n(appI18n);

// Vitest global setup. jsdom does not implement ResizeObserver, which
// Header.tsx uses to track its height; without this stub the brief screen
// throws into its error boundary under test ("Brief failed to load").
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class MediaQueryListStub extends EventTarget implements MediaQueryList {
  readonly matches = false;
  onchange:
    | ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown)
    | null = null;

  constructor(readonly media: string) {
    super();
  }

  addListener(): void {}
  removeListener(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub;
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
