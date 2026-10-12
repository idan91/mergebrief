// Browser-only: `apiFetch`'s client branch reports a `signed-out` 401, and
// whoever owns the viewer's state subscribes at app start, so this layer
// never imports a feature.
type SignedOutListener = () => void;

const listeners = new Set<SignedOutListener>();

/** Calls `listener` on every `signed-out` 401; returns its unsubscribe. */
export function subscribeSignedOut(listener: SignedOutListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tells every subscriber the session is gone. */
export function reportSignedOut(): void {
  for (const listener of listeners) {
    listener();
  }
}
