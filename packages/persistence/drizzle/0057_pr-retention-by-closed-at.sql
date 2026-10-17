-- contracts 0.1.0
ALTER TABLE "pull_request" DROP CONSTRAINT "pull_request_open_retention_shape";--> statement-breakpoint
DROP INDEX "pull_request_purge_after_idx";--> statement-breakpoint
CREATE INDEX "pull_request_closed_at_idx" ON "pull_request" USING btree ("closed_at") WHERE "pull_request"."closed_at" is not null;--> statement-breakpoint
ALTER TABLE "pull_request" DROP COLUMN "purge_after";--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_open_retention_shape" CHECK ("pull_request"."state" <> 'open' or "pull_request"."closed_at" is null);