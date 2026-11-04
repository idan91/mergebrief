-- contracts 0.1.0
-- Moves every stored document to the shape the checks below hold. Forward only:
-- the replaced characters and the removed rows do not come back.
--
-- A model-written document that is not a JSON object stops the migration. It
-- cost a model call, and deleting a brief also removes its review sessions, so
-- an operator decides.
DO $$
DECLARE
  document text;
  unreadable bigint;
BEGIN
  FOREACH document IN ARRAY ARRAY['brief', 'delta', 'revision_narrative'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE body IS NOT JSON OBJECT', document) INTO unreadable;
    IF unreadable > 0 THEN
      RAISE EXCEPTION '%.body holds % rows that are not JSON objects. Find them with: SELECT id FROM % WHERE body IS NOT JSON OBJECT. Delete or repair them, then restart.', document, unreadable, document;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
-- A later run rebuilds these, or the reader goes on without them.
DELETE FROM "chunk_layout" WHERE "body" IS NOT JSON OBJECT;--> statement-breakpoint
DELETE FROM "comparison_marks" WHERE "body" IS NOT JSON OBJECT;--> statement-breakpoint
DELETE FROM "generation_part" WHERE "body" IS NOT JSON OBJECT;--> statement-breakpoint
DELETE FROM "hunk_span" WHERE "spans" IS NOT JSON ARRAY;--> statement-breakpoint
UPDATE "brief" SET "repo_config" = NULL WHERE "repo_config" IS NOT JSON OBJECT;--> statement-breakpoint
UPDATE "generation" SET "repo_config" = NULL WHERE "repo_config" IS NOT JSON OBJECT;--> statement-breakpoint
-- A NUL or lone surrogate escape fails any later `::jsonb` cast, so it becomes
-- U+FFFD, as `cleanJsonText` does on write. This walks the text one escape at a
-- time because a pattern cannot tell a real escape from a doubled backslash
-- followed by `u0000` or `ud83d`, which is ordinary text. A surrogate pair stays
-- only when both halves are real escapes.
CREATE FUNCTION pg_temp.clean_json_text(document text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  token text;
  pending_high text;
  cleaned text := '';
BEGIN
  FOR token IN
    SELECT (regexp_matches(document, '\\u[0-9a-f]{4}|\\.|[^\\]+', 'gi'))[1]
  LOOP
    IF pending_high IS NOT NULL THEN
      IF token ~* '^\\ud[c-f][0-9a-f]{2}$' THEN
        cleaned := cleaned || pending_high || token;
        pending_high := NULL;
        CONTINUE;
      END IF;
      cleaned := cleaned || chr(65533);
      pending_high := NULL;
    END IF;

    IF token ~* '^\\ud[89ab][0-9a-f]{2}$' THEN
      pending_high := token;
    ELSIF token ~* '^\\u(0000|d[c-f][0-9a-f]{2})$' THEN
      cleaned := cleaned || chr(65533);
    ELSE
      cleaned := cleaned || token;
    END IF;
  END LOOP;

  IF pending_high IS NOT NULL THEN
    cleaned := cleaned || chr(65533);
  END IF;
  RETURN cleaned;
END $$;--> statement-breakpoint
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('brief', 'body'),
      ('brief', 'repo_config'),
      ('chunk_layout', 'body'),
      ('comparison_marks', 'body'),
      ('delta', 'body'),
      ('generation', 'repo_config'),
      ('generation_part', 'body'),
      ('hunk_span', 'spans'),
      ('revision_narrative', 'body')
    ) AS documents (table_name, column_name)
  LOOP
    EXECUTE format(
      'UPDATE %1$I SET %2$I = pg_temp.clean_json_text(%2$I) WHERE %2$I ~* %3$L',
      target.table_name,
      target.column_name,
      '\\u(0000|d[89a-f])'
    );
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "brief" DROP COLUMN "byte_size";--> statement-breakpoint
ALTER TABLE "chunk_layout" DROP COLUMN "byte_size";--> statement-breakpoint
ALTER TABLE "comparison_marks" DROP COLUMN "byte_size";--> statement-breakpoint
ALTER TABLE "delta" DROP COLUMN "byte_size";--> statement-breakpoint
ALTER TABLE "generation_part" DROP COLUMN "byte_size";--> statement-breakpoint
ALTER TABLE "revision_narrative" DROP COLUMN "byte_size";--> statement-breakpoint
ALTER TABLE "brief" ADD CONSTRAINT "brief_body_check" CHECK ("brief"."body" is json object);--> statement-breakpoint
ALTER TABLE "brief" ADD CONSTRAINT "brief_repo_config_check" CHECK ("brief"."repo_config" is json object);--> statement-breakpoint
ALTER TABLE "chunk_layout" ADD CONSTRAINT "chunk_layout_body_check" CHECK ("chunk_layout"."body" is json object);--> statement-breakpoint
ALTER TABLE "comparison_marks" ADD CONSTRAINT "comparison_marks_body_check" CHECK ("comparison_marks"."body" is json object);--> statement-breakpoint
ALTER TABLE "delta" ADD CONSTRAINT "delta_body_check" CHECK ("delta"."body" is json object);--> statement-breakpoint
ALTER TABLE "generation_part" ADD CONSTRAINT "generation_part_body_check" CHECK ("generation_part"."body" is json object);--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_repo_config_check" CHECK ("generation"."repo_config" is json object);--> statement-breakpoint
ALTER TABLE "hunk_span" ADD CONSTRAINT "hunk_span_spans_check" CHECK ("hunk_span"."spans" is json array);--> statement-breakpoint
ALTER TABLE "revision_narrative" ADD CONSTRAINT "revision_narrative_body_check" CHECK ("revision_narrative"."body" is json object);