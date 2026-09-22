DROP INDEX "api_token_installation_idx";--> statement-breakpoint
DROP INDEX "auth_session_installation_reviewer_idx";--> statement-breakpoint
ALTER TABLE "api_token" DROP COLUMN "installation_id";--> statement-breakpoint
ALTER TABLE "auth_session" DROP COLUMN "installation_id";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "default_installation_id";