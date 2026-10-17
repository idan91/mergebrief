// `review_group_reclassification`: the reviewer's override of a Change
// group's category. Overrides only: the Brief supplies every default, so an
// absent row means "as generated", never "unknown".
import { bigint, check, pgTable, text, unique } from "drizzle-orm/pg-core";
import type { ReviewSessionId } from "../types";
import { ChangeGroupCategories, type ChangeGroupCategory } from "types/reviews";
import { isOneOf } from "./checks";
import { stampColumns, tenantColumns } from "./columns";
import { reviewSession } from "./review-session";

const CHANGE_GROUP_CATEGORIES = Object.values(ChangeGroupCategories);

export const reviewGroupReclassification = pgTable(
  "review_group_reclassification",
  {
    ...tenantColumns(),
    reviewSessionId: bigint("review_session_id", { mode: "bigint" })
      .$type<ReviewSessionId>()
      .notNull()
      .references(() => reviewSession.id, { onDelete: "cascade" }),
    /** Brief-local Change-group id. */
    changeGroupId: text("change_group_id").notNull(),
    /** CHECK-constrained in lockstep with `ChangeGroupCategory`. */
    category: text("category").$type<ChangeGroupCategory>().notNull(),
    ...stampColumns(),
  },
  (table) => [
    unique("review_group_reclassification_natural_key").on(
      table.reviewSessionId,
      table.changeGroupId,
    ),
    check(
      "review_group_reclassification_category_check",
      isOneOf(table.category, CHANGE_GROUP_CATEGORIES),
    ),
  ],
);
