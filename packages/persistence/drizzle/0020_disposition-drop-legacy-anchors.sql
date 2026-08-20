ALTER TABLE "disposition" DROP CONSTRAINT "disposition_natural_key";--> statement-breakpoint
ALTER TABLE "disposition" DROP CONSTRAINT "disposition_pull_request_id_pull_request_id_fk";
--> statement-breakpoint
ALTER TABLE "disposition" DROP COLUMN "pull_request_id";--> statement-breakpoint
ALTER TABLE "disposition" DROP COLUMN "reviewer_id";--> statement-breakpoint
ALTER TABLE "disposition" DROP COLUMN "decided_at_sha";