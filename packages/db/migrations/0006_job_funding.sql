ALTER TABLE "jobs" ADD COLUMN "funding" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_funding" CHECK ("jobs"."funding" in ('daily', 'credits', 'none'));