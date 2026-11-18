import type { DefaultTheme } from "vitepress";

import { HOME_PAGE_SOURCE, RELEASES_FOLDER } from "./consts";
import { readReleaseVersion } from "./index";
import type { SidebarLabels, SitePage } from "./types";

type SidebarGroup = DefaultTheme.SidebarItem & {
  text: string;
  items: DefaultTheme.SidebarItem[];
};

interface GroupRule {
  label: keyof SidebarLabels;
  holds: (source: string) => boolean;
  order: (left: SitePage, right: SitePage) => number;
}

const PRERELEASE_SEPARATOR = "-";

const GROUP_RULES: readonly GroupRule[] = [
  {
    label: "selfHosting",
    holds: (source) => source.startsWith("self-host/"),
    order: compareHomeFirst,
  },
  {
    label: "repoConfig",
    holds: (source) => source.startsWith("repo-config/"),
    order: compareSource,
  },
  {
    label: "reference",
    holds: (source) => !source.includes("/"),
    order: compareSource,
  },
  {
    label: "releases",
    holds: (source) => source.startsWith(RELEASES_FOLDER),
    order: compareNewestFirst,
  },
];

/** One sidebar group per docs folder, in reading order; a group with no page is left out. */
export function buildSidebar(
  pages: readonly SitePage[],
  labels: SidebarLabels,
): SidebarGroup[] {
  const groups: SidebarGroup[] = [];

  for (const rule of GROUP_RULES) {
    const members = pages
      .filter((page) => rule.holds(page.source))
      .toSorted(rule.order);
    if (members.length > 0) {
      groups.push({
        text: labels[rule.label],
        items: members.map((page) => ({ text: page.title, link: page.link })),
      });
    }
  }

  return groups;
}

/** Semver precedence over `major.minor.patch[-prerelease]`; a release sorts after its prereleases. */
export function compareReleaseVersions(left: string, right: string): number {
  const [leftCore, leftPre] = splitPrerelease(left);
  const [rightCore, rightPre] = splitPrerelease(right);
  const coreOrder = compareDotted(leftCore, rightCore);
  if (coreOrder !== 0) {
    return coreOrder;
  }

  const eitherIsRelease = leftPre === undefined || rightPre === undefined;
  if (eitherIsRelease) {
    const releaseOrder =
      Number(leftPre === undefined) - Number(rightPre === undefined);
    return releaseOrder;
  }

  return compareDotted(leftPre, rightPre);
}

function splitPrerelease(version: string): [string, string | undefined] {
  const separator = version.indexOf(PRERELEASE_SEPARATOR);
  if (separator === -1) {
    return [version, undefined];
  }

  return [version.slice(0, separator), version.slice(separator + 1)];
}

function compareDotted(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true });
}

function compareSource(left: SitePage, right: SitePage): number {
  return left.source.localeCompare(right.source, "en");
}

function compareHomeFirst(left: SitePage, right: SitePage): number {
  const homeOrder =
    Number(right.source === HOME_PAGE_SOURCE) -
    Number(left.source === HOME_PAGE_SOURCE);
  return homeOrder === 0 ? compareSource(left, right) : homeOrder;
}

function compareNewestFirst(left: SitePage, right: SitePage): number {
  return compareReleaseVersions(
    readReleaseVersion(right.source) ?? "",
    readReleaseVersion(left.source) ?? "",
  );
}
