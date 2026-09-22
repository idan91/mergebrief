export const ViewerStates = {
  SIGNED_IN: "signed-in",
  SIGNED_OUT: "signed-out",
  /** Not read yet, or the read failed: the slot shows the generic trigger. */
  UNKNOWN: "unknown",
} as const;

export type ViewerState =
  | {
      readonly kind: typeof ViewerStates.SIGNED_IN;
      readonly login: string | null;
      readonly avatarUrl: string;
    }
  | { readonly kind: typeof ViewerStates.SIGNED_OUT }
  | { readonly kind: typeof ViewerStates.UNKNOWN };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `viewer` of the session response; anything else is unknown, never a throw. */
export function parseViewer(body: unknown): ViewerState {
  if (!isRecord(body) || !isRecord(body["viewer"])) {
    return { kind: ViewerStates.UNKNOWN };
  }
  const { login, avatarUrl } = body["viewer"];
  if (typeof avatarUrl !== "string") return { kind: ViewerStates.UNKNOWN };
  return {
    kind: ViewerStates.SIGNED_IN,
    login: typeof login === "string" ? login : null,
    avatarUrl,
  };
}
