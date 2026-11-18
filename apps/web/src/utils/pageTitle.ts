import type { TFunction } from "i18next";

const PAGE_TITLE_SEPARATOR = " · ";

/** The PR fields a tab title is built from, as the PR meta endpoint carries them. */
export interface PrPageTitleInput {
  readonly title?: string | undefined;
  readonly prNumber: number;
  readonly repoSlug?: string | undefined;
}

export type PageTitle = string;

/**
 * Returns the segments verbatim: a PR title is user content, and the router is
 * the one escaper on the way into the document head.
 */
export function buildPageTitle(
  translate: TFunction,
  segments: readonly string[],
): PageTitle {
  const product = translate("shell.pageTitle.product");

  return [...segments, product].join(PAGE_TITLE_SEPARATOR);
}

export function buildPrPageTitle(
  translate: TFunction,
  input: PrPageTitleInput,
): PageTitle {
  const prTitle = input.title?.trim() ?? "";
  const segments: string[] = [];

  if (prTitle !== "") {
    segments.push(prTitle);
  }
  segments.push(
    translate("shell.pageTitle.prNumber", { number: input.prNumber }),
  );
  if (input.repoSlug !== undefined) {
    segments.push(input.repoSlug);
  }

  return buildPageTitle(translate, segments);
}
