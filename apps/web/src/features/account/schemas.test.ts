import type { AuthSessionResponse, ViewerView } from "contract";
import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";

import type { ReadsWireFields } from "@web/test/wire-fields";
import {
  parseViewer,
  type sessionBodySchema,
  type viewerSchema,
} from "./schemas";
import { ViewerStates } from "./types";

const VIEWER = { login: "octocat", avatarUrl: "https://cdn.example/a.png" };

describe("parseViewer", () => {
  it("reads a signed-in viewer from the session body", () => {
    expect(parseViewer({ viewer: VIEWER, operator: false })).toEqual({
      kind: ViewerStates.SIGNED_IN,
      login: "octocat",
      avatarUrl: "https://cdn.example/a.png",
      operator: false,
    });
  });

  it("reads a missing or malformed Operator flag as not an Operator", () => {
    expect(parseViewer({ viewer: VIEWER })).toMatchObject({ operator: false });
    expect(parseViewer({ viewer: VIEWER, operator: "yes" })).toMatchObject({
      operator: false,
    });
  });

  it("reads a missing, null or non-string login as absent", () => {
    const expected = {
      kind: ViewerStates.SIGNED_IN,
      avatarUrl: VIEWER.avatarUrl,
      operator: false,
    };

    expect(
      parseViewer({ viewer: { avatarUrl: VIEWER.avatarUrl } }),
    ).toStrictEqual(expected);
    expect(parseViewer({ viewer: { ...VIEWER, login: null } })).toStrictEqual(
      expected,
    );
    expect(parseViewer({ viewer: { ...VIEWER, login: 7 } })).toStrictEqual(
      expected,
    );
  });

  it("answers unknown for a body without a usable viewer", () => {
    const unknown = { kind: ViewerStates.UNKNOWN };

    expect(parseViewer(null)).toEqual(unknown);
    expect(parseViewer({})).toEqual(unknown);
    expect(parseViewer({ viewer: [] })).toEqual(unknown);
    expect(parseViewer({ viewer: { login: "octocat" } })).toEqual(unknown);
  });
});

const CONTRACT_PINS = {
  AuthSessionResponse: true satisfies ReadsWireFields<
    z.output<typeof sessionBodySchema>,
    AuthSessionResponse
  >,
  ViewerView: true satisfies ReadsWireFields<
    z.output<typeof viewerSchema>,
    ViewerView
  >,
} as const;

void CONTRACT_PINS;
