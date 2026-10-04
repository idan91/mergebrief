CREATE TABLE "instance_version" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_version_single_row" CHECK ("instance_version"."id")
);
