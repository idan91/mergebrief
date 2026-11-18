import { useTranslation } from "react-i18next";
import {
  InboxArchivedFilters,
  InboxAuthorFilters,
  InboxSortDirections,
  InboxSorts,
  InboxStatuses,
  InboxLayouts,
} from "types/inbox";

import {
  REVIEW_MARK_ORDER,
  ReviewMarkLabelKeys,
} from "@web/components/ReviewMark/consts";
import { ReviewMarkGlyphs } from "@web/components/ReviewMark";
import {
  EVERY_STATUS_PARAM,
  hasEveryStatus,
  listRepoOptions,
  readKnown,
  toggleListValue,
  toggleStateValue,
  type InboxChoices,
} from "../../search";
import type { InboxPage, InboxSearch } from "../../types";
import type { InboxSearchWrite } from "../../hooks/useInboxSearchState";
import { STATUS_NAMED_UP_TO } from "./consts";
import type { FilterView } from "./types";
import { buildAllRow } from "./utils";

/** The filters and the sort as the controls draw them, from the URL's choices and the page. */
export function useControlsFacade(
  page: InboxPage,
  search: InboxSearch,
  choices: InboxChoices,
  write: (next: InboxSearchWrite) => void,
) {
  const { t } = useTranslation();

  const triggerLabel = t("home.filters.all");

  const filters: FilterView[] = [
    {
      id: "state",
      name: t("home.filters.status"),
      options: [
        { value: InboxStatuses.OPEN, label: t("home.inbox.status.open") },
        { value: InboxStatuses.DRAFT, label: t("home.inbox.status.draft") },
        { value: InboxStatuses.MERGED, label: t("home.inbox.status.merged") },
        { value: InboxStatuses.CLOSED, label: t("home.inbox.status.closed") },
      ],
      chosen: choices.states,
      multiple: true,
      changed: search.state !== undefined,
      namedUpTo: STATUS_NAMED_UP_TO,
      all: buildAllRow(
        { label: t("home.filters.allStatuses"), triggerLabel },
        hasEveryStatus(choices.states),
        () => write({ state: EVERY_STATUS_PARAM }),
      ),
      onChoose: (value) => {
        const status = readKnown(value, InboxStatuses);
        if (status === undefined) {
          return;
        }
        write((live) => ({ state: toggleStateValue(live.states, status) }));
      },
    },
    {
      id: "repo",
      name: t("home.filters.repository"),
      options: listRepoOptions(page.repositories),
      chosen: choices.repos,
      multiple: true,
      changed: search.repo !== undefined,
      all: buildAllRow(
        { label: t("home.filters.allRepositories"), triggerLabel },
        choices.repos.length === 0,
        () => write({ repo: undefined }),
      ),
      onChoose: (value) => {
        write((live) => ({ repo: toggleListValue(live.repos, value) }));
      },
    },
    {
      id: "review",
      name: t("home.filters.review"),
      options: REVIEW_MARK_ORDER.map((state) => ({
        value: state,
        label: t(ReviewMarkLabelKeys[state]),
      })),
      chosen: choices.reviews,
      multiple: true,
      changed: search.review !== undefined,
      glyphs: ReviewMarkGlyphs,
      all: buildAllRow(
        { label: t("home.filters.allReviewStates"), triggerLabel },
        choices.reviews.length === 0,
        () => write({ review: undefined }),
      ),
      onChoose: (value) => {
        write((live) => ({ review: toggleListValue(live.reviews, value) }));
      },
    },
    {
      id: "author",
      name: t("home.filters.author"),
      options: [
        {
          value: InboxAuthorFilters.ALL,
          label: t("home.filters.authorEveryone"),
        },
        { value: InboxAuthorFilters.MINE, label: t("home.filters.authorMine") },
        {
          value: InboxAuthorFilters.OTHERS,
          label: t("home.filters.authorOthers"),
        },
      ],
      chosen: [choices.author],
      multiple: false,
      changed: search.author !== undefined,
      underMore: true,
      onChoose: (value) => {
        const author = readKnown(value, InboxAuthorFilters);
        write({
          author: author === InboxAuthorFilters.ALL ? undefined : author,
        });
      },
    },
  ];

  filters.push({
    id: "list",
    name: t("home.filters.list"),
    options: [
      { value: InboxArchivedFilters.HIDE, label: t("home.filters.listInbox") },
      {
        value: InboxArchivedFilters.ONLY,
        label: t("home.filters.listArchived"),
      },
    ],
    chosen: [choices.archived],
    multiple: false,
    changed: search.archived !== undefined,
    underMore: true,
    onChoose: (value) => {
      const archived = readKnown(value, InboxArchivedFilters);
      write({
        archived: archived === InboxArchivedFilters.HIDE ? undefined : archived,
      });
    },
  });

  if (page.reachableInstallations.length > 1) {
    filters.push({
      id: "installation",
      name: t("home.filters.installation"),
      options: page.reachableInstallations.map((installation) => ({
        value: installation.installationId,
        label: installation.accountLogin,
      })),
      chosen: choices.installations,
      multiple: true,
      changed: search.installation !== undefined,
      underMore: true,
      all: buildAllRow(
        { label: t("home.filters.allInstallations"), triggerLabel },
        choices.installations.length === 0,
        () => write({ installation: undefined }),
      ),
      onChoose: (value) => {
        write((live) => ({
          installation: toggleListValue(live.installations, value),
        }));
      },
    });
  }

  const sort: FilterView = {
    id: "sort",
    name: t("home.filters.sortBy"),
    options: [
      { value: InboxSorts.UPDATED, label: t("home.filters.sortUpdated") },
      { value: InboxSorts.GENERATED, label: t("home.filters.sortGenerated") },
      { value: InboxSorts.CREATED, label: t("home.filters.sortCreated") },
    ],
    chosen: [choices.sort],
    multiple: false,
    changed: search.sort !== undefined,
    alwaysNamed: true,
    onChoose: (value) => {
      const chosenSort = readKnown(value, InboxSorts);
      write({
        sort: chosenSort === InboxSorts.UPDATED ? undefined : chosenSort,
      });
    },
  };

  const direction: FilterView = {
    id: "direction",
    name: t("home.filters.sortOrder"),
    options: [
      {
        value: InboxSortDirections.DESCENDING,
        label: t("home.filters.sortNewestFirst"),
      },
      {
        value: InboxSortDirections.ASCENDING,
        label: t("home.filters.sortOldestFirst"),
      },
    ],
    chosen: [choices.direction],
    multiple: false,
    changed: search.direction !== undefined,
    onChoose: (value) => {
      const chosenDirection = readKnown(value, InboxSortDirections);
      const newestFirst = chosenDirection === InboxSortDirections.DESCENDING;
      write({ direction: newestFirst ? undefined : chosenDirection });
    },
  };

  const layout: FilterView = {
    id: "layout",
    name: t("home.filters.view"),
    options: [
      { value: InboxLayouts.FOLDED, label: t("home.filters.viewFolded") },
      { value: InboxLayouts.MIXED, label: t("home.filters.viewMixed") },
    ],
    chosen: [choices.layout],
    multiple: false,
    changed: search.layout !== undefined,
    onChoose: (value) => {
      const chosenLayout = readKnown(value, InboxLayouts);
      write({
        layout: chosenLayout === InboxLayouts.FOLDED ? undefined : chosenLayout,
      });
    },
  };

  return { filters, sort, direction, layout };
}
