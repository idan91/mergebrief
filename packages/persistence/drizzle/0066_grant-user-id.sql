-- contracts 0.1.0
-- Existing grants name no user and pre-release credentials are not kept: every sign-in ends here.
DELETE FROM "auth_session";--> statement-breakpoint
DELETE FROM "api_token";--> statement-breakpoint
DELETE FROM "github_grant";--> statement-breakpoint
ALTER TABLE "github_grant" ADD COLUMN "user_id" bigint NOT NULL;--> statement-breakpoint
CREATE INDEX "github_grant_user_idx" ON "github_grant" USING btree ("user_id");