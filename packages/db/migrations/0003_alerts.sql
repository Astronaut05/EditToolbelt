CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"rule" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"message" text NOT NULL,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alerts_rule_subject_idx" ON "alerts" USING btree ("rule","subject","created_at" DESC NULLS LAST);