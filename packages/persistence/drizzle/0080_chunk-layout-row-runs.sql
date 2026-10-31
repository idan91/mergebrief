-- contracts 0.1.0
-- A layout whose counts lack `rowRuns` predates the stored shape; with it
-- gone the brief reads as one stored without a layout until a run over the
-- stored brief backfills it. A body that is not one JSON object goes too.
DELETE FROM "chunk_layout"
WHERE CASE
  WHEN "body" IS JSON OBJECT THEN EXISTS (
    SELECT 1
    FROM jsonb_each(coalesce("body"::jsonb -> 'chunks', '{}'::jsonb)) AS chunk_counts
    WHERE NOT (chunk_counts.value ? 'rowRuns')
    UNION ALL
    SELECT 1
    FROM jsonb_each(coalesce("body"::jsonb -> 'files', '{}'::jsonb)) AS file_counts
    WHERE NOT (file_counts.value ? 'rowRuns')
  )
  ELSE true
END;
