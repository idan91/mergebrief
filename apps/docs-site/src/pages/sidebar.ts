import type { DefaultTheme } from "vitepress";

import {
  HOME_PAGE_SOURCE,
  REFERENCE_PAGE_ORDER,
  RELEASES_FOLDER,
  REPO_CONFIG_PAGE_ORDER,
  SELF_HOST_SECTIONS,
  USE_PAGE_ORDER,
} from "./consts";
import { readReleaseVersion } from "./index";
import type {
  SelfHostSection,
  SidebarGroupLabels,
  SidebarLabels,
  SitePage,
} from "./types";

type SidebarGroup = DefaultTheme.SidebarItem & {
  text: string;
  items: DefaultTheme.SidebarItem[];
};

interface GroupRule {
  label: keyof SidebarGroupLabels;
  holds: (source: string) => boolean;
  order: (left: SitePage, right: SitePage) => number;
  /** Splits the group into collapsible sub-groups; a page in none follows them. */
  sections?: readonly SelfHostSection[];
}

const PRERELEASE_SEPARATOR = "-";

const SELF_HOST_PAGE_ORDER = SELF_HOST_SECTIONS.flatMap(
  (section) => section.pages,
);

const GROUP_RULES: readonly GroupRule[] = [
  {
    label: "use",
    holds: (source) => source.startsWith("use/"),
    order: (left, right) => compareByOrder(USE_PAGE_ORDER, left, right),
  },
  {
    label: "selfHosting",
    holds: (source) => source.startsWith("self-host/"),
    order: (left, right) => compareByOrder(SELF_HOST_PAGE_ORDER, left, right),
    sections: SELF_HOST_SECTIONS,
  },
  {
    label: "repoConfig",
    holds: (source) => source.startsWith("repo-config/"),
    order: (left, right) => compareByOrder(REPO_CONFIG_PAGE_ORDER, left, right),
  },
  {
    label: "reference",
    holds: (source) => !source.includes("/"),
    order: (left, right) => compareByOrder(REFERENCE_PAGE_ORDER, left, right),
  },
  {
    label: "releases",
    holds: (source) => source.startsWith(RELEASES_FOLDER),
    order: compareNewestFirst,
  },
];

/** One sidebar group per docs folder, in reading order; a group with no page is left out, and so is the home page. */
export function buildSidebar(
  pages: readonly SitePage[],
  labels: SidebarLabels,
): SidebarGroup[] {
  const groups: SidebarGroup[] = [];
  const listed = pages.filter((page) => page.source !== HOME_PAGE_SOURCE);

  for (const rule of GROUP_RULES) {
    const members = listed
      .filter((page) => rule.holds(page.source))
      .toSorted(rule.order);
    if (members.length === 0) {
      continue;
    }

    const items = rule.sections
      ? buildSectionItems(members, rule.sections, labels.selfHostPhases)
      : members.map(toSidebarLink);
    groups.push({ text: labels[rule.label], items });
  }

  return groups;
}

/** The sidebar headings above a page, outermost first: its group, then its Self-hosting phase. The home page has none. */
export function readPageTrail(source: string, labels: SidebarLabels): string[] {
  if (source === HOME_PAGE_SOURCE) {
    return [];
  }

  const rule = GROUP_RULES.find((candidate) => candidate.holds(source));
  if (rule === undefined) {
    return [];
  }

  const trail = [labels[rule.label]];
  const section = rule.sections?.find((candidate) =>
    candidate.pages.includes(source),
  );
  if (section !== undefined) {
    trail.push(labels.selfHostPhases[section.phase]);
  }

  return trail;
}

function toSidebarLink(page: SitePage): DefaultTheme.SidebarItem {
  return { text: page.title, link: page.link };
}

/** One collapsible sub-group per section that holds a page, then the group's unsectioned pages. */
function buildSectionItems(
  members: readonly SitePage[],
  sections: readonly SelfHostSection[],
  phaseLabels: SidebarLabels["selfHostPhases"],
): DefaultTheme.SidebarItem[] {
  const sectioned = new Set(sections.flatMap((section) => section.pages));
  const subGroups = sections
    .map((section) => buildSubGroup(section, members, phaseLabels))
    .filter((subGroup) => subGroup.items.length > 0);
  const unsectioned = members
    .filter((page) => !sectioned.has(page.source))
    .map(toSidebarLink);

  return [...subGroups, ...unsectioned];
}

function buildSubGroup(
  section: SelfHostSection,
  members: readonly SitePage[],
  phaseLabels: SidebarLabels["selfHostPhases"],
): SidebarGroup {
  const pages = members.filter((page) => section.pages.includes(page.source));
  return {
    text: phaseLabels[section.phase],
    collapsed: section.collapsed,
    items: pages.map(toSidebarLink),
  };
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

function readPageRank(order: readonly string[], page: SitePage): number {
  const rank = order.indexOf(page.source);
  return rank === -1 ? order.length : rank;
}

/** The group's listed pages in their order, then every unlisted page by path. */
function compareByOrder(
  order: readonly string[],
  left: SitePage,
  right: SitePage,
): number {
  const rankOrder = readPageRank(order, left) - readPageRank(order, right);
  return rankOrder === 0 ? compareSource(left, right) : rankOrder;
}

function compareNewestFirst(left: SitePage, right: SitePage): number {
  return compareReleaseVersions(
    readReleaseVersion(right.source) ?? "",
    readReleaseVersion(left.source) ?? "",
  );
}
