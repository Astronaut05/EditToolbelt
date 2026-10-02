CREATE TYPE "public"."fiscal_receipt_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "fiscal_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"payment_id" text NOT NULL,
	"status" "fiscal_receipt_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_receipts_attempts" CHECK ("fiscal_receipts"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_receipts_purchase_key" ON "fiscal_receipts" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "fiscal_receipts_due_idx" ON "fiscal_receipts" USING btree ("next_attempt_at") WHERE "fiscal_receipts"."status" <> 'sent';