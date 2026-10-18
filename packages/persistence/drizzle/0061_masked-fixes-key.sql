-- contracts 0.1.0
-- Pre-release rename of the intent bucket claimedButUnachieved to maskedFixes
-- inside stored brief bodies. Only the intentCheck key and the bucket items of
-- the "intent check issues" warning line move; any other text that quotes the
-- old name is content and stays. Deltas and revision narratives carry neither.
CREATE FUNCTION pg_temp.rename_masked_fixes(source jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN warnings.renamed IS NULL THEN moved.body
    ELSE jsonb_set(moved.body, '{generationWarnings}', warnings.renamed)
  END
  FROM (
    SELECT CASE
      WHEN (source -> 'intentCheck') ? 'claimedButUnachieved' THEN jsonb_set(
        source,
        '{intentCheck}',
        ((source -> 'intentCheck') - 'claimedButUnachieved')
          || jsonb_build_object('maskedFixes', (source -> 'intentCheck') -> 'claimedButUnachieved')
      )
      ELSE source
    END AS body
  ) AS moved
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      CASE
        WHEN jsonb_typeof(warning) = 'string'
          AND starts_with(warning #>> '{}', '⚠ intent check issues: ')
        THEN to_jsonb(regexp_replace(
          warning #>> '{}',
          '(: |; )claimedButUnachieved item "',
          '\1maskedFixes item "',
          'g'
        ))
        ELSE warning
      END
      ORDER BY position
    ) AS renamed
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(moved.body -> 'generationWarnings') = 'array'
        THEN moved.body -> 'generationWarnings'
        ELSE '[]'::jsonb
      END
    ) WITH ORDINALITY AS item(warning, position)
  ) AS warnings ON jsonb_typeof(moved.body -> 'generationWarnings') = 'array';
$$;
--> statement-breakpoint
WITH rewritten AS MATERIALIZED (
  SELECT id, pg_temp.rename_masked_fixes(original) AS body, original
  FROM (
    SELECT id, "body"::jsonb AS original
    FROM "brief"
    WHERE "body" LIKE '%claimedButUnachieved%'
    OFFSET 0
  ) AS parsed
), changed AS MATERIALIZED (
  SELECT id, body::text AS body_text FROM rewritten WHERE body <> original
)
UPDATE "brief" AS target
SET "body" = changed.body_text,
    "byte_size" = octet_length(changed.body_text),
    "body_version" = 2
FROM changed
WHERE target.id = changed.id;
--> statement-breakpoint
DROP FUNCTION pg_temp.rename_masked_fixes(jsonb);
