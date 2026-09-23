import type { ValueOf } from "types";

/** The two visual surfaces the app renders; the root document names the current one on `<html>`. */
export const Surfaces = {
  HOME: "home",
  BRIEF: "brief",
} as const;

export type Surface = ValueOf<typeof Surfaces>;

const BRIEF_PATH_PREFIXES = ["/repos/", "/briefs/"];

export function resolveSurface(pathname: string): Surface {
  const isBrief = BRIEF_PATH_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
  return isBrief ? Surfaces.BRIEF : Surfaces.HOME;
}
