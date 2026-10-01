ALTER TABLE "jobs" ADD COLUMN "timeout_sec" integer DEFAULT 900 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "max_concurrent" smallint;--> statement-breakpoint
CREATE INDEX "jobs_running_idx" ON "jobs" USING btree ("heartbeat_at") WHERE "jobs"."status" = 'running';