import { createContext, useContext, type ReactNode } from "react";

/**
 * Jump routing for windowed chunk lists: a chunk that is not mounted has no
 * DOM node to scroll to, so jump paths fall back to asking the windows to
 * scroll toward the chunk's estimated position; the card mounts en route and
 * the caller settle-corrects on the real element.
 *
 * Every group list (in every scope pane) registers; resolution tries each
 * until one accepts. A hidden kept-warm pane refuses (`scrollToKey` is
 * false while inactive), so only the visible pane ever moves the page.
 */
export interface ChunkWindowRegistration {
  /** True when this window owns the chunk AND accepted the scroll. */
  scrollToChunk: (chunkId: string) => boolean;
  /** Held, a card measured above the fold no longer moves the page. */
  holdScrollCompensation: (held: boolean) => void;
}

export interface ChunkWindowRegistry {
  register: (registration: ChunkWindowRegistration) => () => void;
  scrollToChunk: (chunkId: string) => boolean;
  /**
   * Holds every window's compensation until the returned release runs. Holds
   * nest: the windows stay held until the last one is released, and a window
   * that registers meanwhile starts held.
   */
  holdScrollCompensation: () => () => void;
  /** Marks a programmatic smooth scroll in flight until the returned end runs. */
  beginSmoothScroll: () => () => void;
  isSmoothScrolling: () => boolean;
}

/** Wraps `run` so only its first call acts. */
function runOnce(run: () => void): () => void {
  let ran = false;
  return () => {
    if (ran) {
      return;
    }
    ran = true;
    run();
  };
}

export function createChunkWindowRegistry(): ChunkWindowRegistry {
  const registrations = new Set<ChunkWindowRegistration>();
  let compensationHolds = 0;
  let smoothScrolls = 0;
  const applyHold = (held: boolean): void => {
    for (const registration of registrations) {
      registration.holdScrollCompensation(held);
    }
  };
  return {
    register(registration) {
      registrations.add(registration);
      if (compensationHolds > 0) {
        registration.holdScrollCompensation(true);
      }
      return () => {
        registrations.delete(registration);
      };
    },
    scrollToChunk(chunkId) {
      for (const registration of registrations) {
        if (registration.scrollToChunk(chunkId)) {
          return true;
        }
      }
      return false;
    },
    holdScrollCompensation() {
      compensationHolds += 1;
      if (compensationHolds === 1) {
        applyHold(true);
      }
      return runOnce(() => {
        compensationHolds -= 1;
        if (compensationHolds === 0) {
          applyHold(false);
        }
      });
    },
    beginSmoothScroll() {
      smoothScrolls += 1;
      return runOnce(() => {
        smoothScrolls -= 1;
      });
    },
    isSmoothScrolling() {
      return smoothScrolls > 0;
    },
  };
}

const ChunkWindowContext = createContext<ChunkWindowRegistry | null>(null);

export interface ChunkWindowProviderProps {
  registry: ChunkWindowRegistry;
  children: ReactNode;
}

export function ChunkWindowProvider({
  registry,
  children,
}: ChunkWindowProviderProps) {
  return (
    <ChunkWindowContext.Provider value={registry}>
      {children}
    </ChunkWindowContext.Provider>
  );
}

/** Null outside a provider (tests, the raw-span path); jumps then rely on
 * mounted DOM alone, which is exactly the pre-windowing behavior. */
export function useChunkWindows(): ChunkWindowRegistry | null {
  return useContext(ChunkWindowContext);
}
