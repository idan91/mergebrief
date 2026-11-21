// PROTOTYPE (BRIEF-381). Dev-only switch: `?proto=held` turns it on, then the
// direction, case and PR-page view ride sessionStorage so in-app links keep it.
import { useSyncExternalStore } from "react";

export type Direction = "a" | "b" | "c";
export type PrView = "card" | "entry";

export interface HeldPrototypeState {
  active: boolean;
  direction: Direction;
  caseId: string;
  view: PrView;
}

const KEY = "proto-held";
const EVENT = "proto-held-change";
const OFF: HeldPrototypeState = { active: false, direction: "a", caseId: "waits", view: "card" };

let cached: HeldPrototypeState = OFF;
let cachedRaw = "";

function readRaw(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("proto") === "held") {
      const fromUrl: HeldPrototypeState = {
        active: true,
        direction: (params.get("dir") as Direction | null) ?? "a",
        caseId: params.get("case") ?? "waits",
        view: (params.get("view") as PrView | null) ?? "card",
      };
      const raw = JSON.stringify(fromUrl);
      window.sessionStorage.setItem(KEY, raw);
      return raw;
    }
    if (params.get("proto") === "off") {
      window.sessionStorage.removeItem(KEY);
      return "";
    }
    return window.sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function getSnapshot(): HeldPrototypeState {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = raw === "" ? OFF : (JSON.parse(raw) as HeldPrototypeState);
  }
  return cached;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

export function useHeldPrototype(): HeldPrototypeState {
  return useSyncExternalStore(subscribe, getSnapshot, () => OFF);
}

export function setHeldPrototype(next: Partial<HeldPrototypeState>): void {
  const merged = { ...getSnapshot(), ...next, active: true };
  const url = new URL(window.location.href);
  url.searchParams.set("proto", "held");
  url.searchParams.set("dir", merged.direction);
  url.searchParams.set("case", merged.caseId);
  url.searchParams.set("view", merged.view);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(EVENT));
}
