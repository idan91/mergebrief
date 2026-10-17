-- contracts 0.1.0
-- Postgres refuses a subquery in ALTER COLUMN ... TYPE ... USING, so each
-- column is copied into a sibling, dropped and renamed. No guard on the
-- stored text: a value that is not a JSON array fails the migration.
ALTER TABLE "brief" ADD COLUMN "carried_chunk_ids_new" text[];--> statement-breakpoint
ALTER TABLE "brief" ADD COLUMN "used_group_ids_new" text[];--> statement-breakpoint
UPDATE "brief" SET "carried_chunk_ids_new" = ARRAY(SELECT jsonb_array_elements_text("carried_chunk_ids"::jsonb)) WHERE "carried_chunk_ids" IS NOT NULL;--> statement-breakpoint
UPDATE "brief" SET "used_group_ids_new" = ARRAY(SELECT jsonb_array_elements_text("used_group_ids"::jsonb)) WHERE "used_group_ids" IS NOT NULL;--> statement-breakpoint
-- A row that predates used_group_ids takes the union the worker would have
-- stored: every change-group id across the PR's briefs up to this head, in
-- first-seen order, each id once.
UPDATE "brief" AS target SET "used_group_ids_new" = (
  SELECT COALESCE(array_agg(first_use.id ORDER BY first_use.head_index, first_use.position), '{}')
  FROM (
    SELECT DISTINCT ON (groups.elem ->> 'id') groups.elem ->> 'id' AS id, chain.head_index, groups.position
    FROM "brief" AS chain
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(chain.body::jsonb -> 'changeGroups') = 'array'
           THEN chain.body::jsonb -> 'changeGroups'
           ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS groups(elem, position)
    WHERE chain.pull_request_id = target.pull_request_id
      AND chain.head_index <= target.head_index
      AND groups.elem ->> 'id' IS NOT NULL
    ORDER BY groups.elem ->> 'id', chain.head_index, groups.position
  ) AS first_use
) WHERE "used_group_ids" IS NULL;--> statement-breakpoint
ALTER TABLE "brief" DROP COLUMN "carried_chunk_ids";--> statement-breakpoint
ALTER TABLE "brief" DROP COLUMN "used_group_ids";--> statement-breakpoint
ALTER TABLE "brief" RENAME COLUMN "carried_chunk_ids_new" TO "carried_chunk_ids";--> statement-breakpoint
ALTER TABLE "brief" RENAME COLUMN "used_group_ids_new" TO "used_group_ids";
