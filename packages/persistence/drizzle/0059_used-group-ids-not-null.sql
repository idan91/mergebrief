-- contracts 0.1.0
-- A row written without the chain takes the union the worker would have
-- stored: every change-group id across the PR's briefs up to this head, and
-- every id an earlier row recorded, in first-seen order, each id once.
UPDATE "brief" AS target SET "used_group_ids" = (
  SELECT COALESCE(array_agg(first_use.id ORDER BY first_use.head_index, first_use.position), '{}')
  FROM (
    SELECT DISTINCT ON (ids.id) ids.id, ids.head_index, ids.position
    FROM (
      SELECT groups.elem ->> 'id' AS id, chain.head_index, groups.position
      FROM "brief" AS chain
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(chain.body::jsonb -> 'changeGroups') = 'array'
             THEN chain.body::jsonb -> 'changeGroups'
             ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS groups(elem, position)
      WHERE chain.pull_request_id = target.pull_request_id
        AND chain.head_index <= target.head_index
        AND groups.elem ->> 'id' IS NOT NULL
      UNION ALL
      SELECT used.id, chain.head_index, used.position
      FROM "brief" AS chain
      CROSS JOIN LATERAL unnest(chain.used_group_ids) WITH ORDINALITY AS used(id, position)
      WHERE chain.pull_request_id = target.pull_request_id
        AND chain.head_index < target.head_index
    ) AS ids
    ORDER BY ids.id, ids.head_index, ids.position
  ) AS first_use
) WHERE "used_group_ids" IS NULL;--> statement-breakpoint
ALTER TABLE "brief" ALTER COLUMN "used_group_ids" SET NOT NULL;