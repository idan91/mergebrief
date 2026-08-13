import { createContext, useContext, type ReactNode } from "react";

/**
 * Jump routing for windowed chunk lists: a chunk that is not mounted has no
 * DOM node to scroll to, so jump paths fall back to asking the windows to
 * scroll toward the chunk's estimated position; the card mounts en route and
 * the caller settle-corrects on the real element.
 *
 * Every group list (in every lens tree) registers; resolution tries each
 * until one accepts. A hidden kept-warm pane refuses (`scrollToKey` is
 * false while inactive), so only the visible lens ever moves the page.
 */
export interface ChunkWindowRegistration {
  /** True when this window owns the chunk AND accepted the scroll. */
  scrollToChunk: (chunkId: string) => boolean;
}

export interface ChunkWindowRegistry {
  register: (registration: ChunkWindowRegistration) => () => void;
  scrollToChunk: (chunkId: string) => boolean;
}

export function createChunkWindowRegistry(): ChunkWindowRegistry {
  const registrations = new Set<ChunkWindowRegistration>();
  return {
    register(registration) {
      registrations.add(registration);
      return () => {
        registrations.delete(registration);
      };
    },
    scrollToChunk(chunkId) {
      for (const registration of registrations) {
        if (registration.scrollToChunk(chunkId)) return true;
      }
      return false;
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

/** Null outside a provider (tests, the raw-span path) — jumps then rely on
 * mounted DOM alone, which is exactly the pre-windowing behavior. */
export function useChunkWindows(): ChunkWindowRegistry | null {
  return useContext(ChunkWindowContext);
}
