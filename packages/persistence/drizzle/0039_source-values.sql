ALTER TABLE "audit_log" ALTER COLUMN "source" SET DEFAULT 'installation';--> statement-breakpoint
ALTER TABLE "pull_request" ALTER COLUMN "source" SET DEFAULT 'installation';--> statement-breakpoint
ALTER TABLE "pull_request" DROP CONSTRAINT "pull_request_owner_shape";--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_source_shape";--> statement-breakpoint
UPDATE "pull_request" SET "source" = 'installation' WHERE "source" = 'app-installation';--> statement-breakpoint
UPDATE "pull_request" SET "source" = 'url' WHERE "source" = 'url-box';--> statement-breakpoint
UPDATE "audit_log" SET "source" = 'installation' WHERE "source" = 'app-installation';--> statement-breakpoint
UPDATE "audit_log" SET "source" = 'url' WHERE "source" = 'url-box';--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_owner_shape" CHECK (
  ("source" = 'installation' AND "installation_id" IS NOT NULL AND "owner_user_id" IS NULL)
  OR ("source" = 'url' AND "installation_id" IS NULL AND "owner_user_id" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_source_shape" CHECK (
  ("source" = 'installation' AND "installation_id" IS NOT NULL)
  OR ("source" = 'url' AND "installation_id" IS NULL)
);
