// Vitest global setup. jsdom does not implement ResizeObserver, which
// Header.tsx uses to track its height; without this stub the brief screen
// throws into its error boundary under test ("Brief failed to load").
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub;
}
