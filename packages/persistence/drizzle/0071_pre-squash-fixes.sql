-- contracts 0.1.0
ALTER TABLE "review_session" RENAME COLUMN "begun_at" TO "created_at";--> statement-breakpoint
UPDATE "brief" SET "body_version" = 1 WHERE "body_version" IS NULL;--> statement-breakpoint
UPDATE "delta" SET "body_version" = 1 WHERE "body_version" IS NULL;--> statement-breakpoint
UPDATE "revision_narrative" SET "body_version" = 1 WHERE "body_version" IS NULL;--> statement-breakpoint
ALTER TABLE "brief" ALTER COLUMN "body_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delta" ALTER COLUMN "body_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "revision_narrative" ALTER COLUMN "body_version" SET NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "generation_installation_created_at_idx";--> statement-breakpoint
DROP INDEX "generation_created_at_idx";
