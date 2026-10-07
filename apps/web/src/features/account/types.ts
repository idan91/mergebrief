import type { ValueOf } from "types/utils";

export const ViewerStates = {
  SIGNED_IN: "signed-in",
  SIGNED_OUT: "signed-out",
  /** Not read yet, so the slot is empty; or the read failed and the slot shows the generic trigger. */
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

/** How far a sign out reaches: this session, or every session of the viewer. */
export const SignOutScopes = {
  THIS_DEVICE: "this-device",
  EVERYWHERE: "everywhere",
} as const;
export type SignOutScope = ValueOf<typeof SignOutScopes>;

/** The sign-out confirm: whether it shows, which scope is in flight, and whether the last try failed. */
export interface SignOutFlow {
  readonly open: boolean;
  readonly pending: SignOutScope | undefined;
  readonly failed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `viewer` of the session response; anything else is unknown, never a throw. */
export function parseViewer(body: unknown): ViewerState {
  if (!isRecord(body) || !isRecord(body["viewer"])) {
    return { kind: ViewerStates.UNKNOWN };
  }
  const { login, avatarUrl } = body["viewer"];
  if (typeof avatarUrl !== "string") {
    return { kind: ViewerStates.UNKNOWN };
  }
  return {
    kind: ViewerStates.SIGNED_IN,
    login: typeof login === "string" ? login : null,
    avatarUrl,
  };
}
