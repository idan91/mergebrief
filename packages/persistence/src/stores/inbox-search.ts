// The Inbox's search text as one SQL predicate. Every value reaches the
// query as a bind parameter, and LIKE's own wildcards are escaped first, so
// what the reviewer typed only ever matches literally.
import { and, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";

const WORD_SEPARATOR = /\s+/;
const LIKE_WILDCARDS = /[\\%_]/g;
/** Digits, with or without the hash sign a pull request number is written with. */
const NUMBER_WORD = /^#?(?<digits>\d+)$/;

/** The columns the words are matched against, of the table or of a subquery over it. */
interface InboxSearchColumns {
  readonly title: SQLWrapper;
  readonly prNumber: SQLWrapper;
}

function escapeLikePattern(word: string): string {
  return word.replace(LIKE_WILDCARDS, "\\$&");
}

function buildWordPredicate(word: string, columns: InboxSearchColumns): SQL {
  const contained = `%${escapeLikePattern(word)}%`;
  const inTitle = sql`${columns.title} ilike ${contained} escape '\\'`;

  const digits = NUMBER_WORD.exec(word)?.groups?.["digits"];
  if (digits === undefined) {
    return inTitle;
  }
  const numberPrefix = `${digits}%`;
  const startsNumber = sql`${columns.prNumber}::text like ${numberPrefix}`;
  return or(inTitle, startsNumber) ?? inTitle;
}

/** Every word must match; text with no word in it narrows nothing. */
export function buildSearchPredicate(
  searchText: string | undefined,
  columns: InboxSearchColumns,
): SQL | undefined {
  const words = (searchText ?? "")
    .split(WORD_SEPARATOR)
    .filter((word) => word !== "");
  return and(...words.map((word) => buildWordPredicate(word, columns)));
}
