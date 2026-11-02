ALTER TABLE "revision_narrative" ADD COLUMN "skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "revision_narrative" SET "skipped" = true
  WHERE CASE WHEN "body" LIKE '%"artifactKind":"revisionNarrativeSkipped"%'
    THEN ("body"::jsonb ->> 'artifactKind') = 'revisionNarrativeSkipped'
    ELSE false END;
