-- contracts 0.1.0
ALTER TABLE "api_token" DROP CONSTRAINT "api_token_grant_id_github_grant_id_fk";
--> statement-breakpoint
ALTER TABLE "api_token" ALTER COLUMN "grant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_grant_id_github_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."github_grant"("id") ON DELETE set null ON UPDATE no action;