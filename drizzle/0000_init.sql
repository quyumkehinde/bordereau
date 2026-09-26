CREATE TYPE "public"."claim_status" AS ENUM('open', 'closed', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."file_kind" AS ENUM('policy', 'claim');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('needs_mapping', 'imported', 'failed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('error', 'warning');--> statement-breakpoint
CREATE TABLE "claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"insurer_id" integer NOT NULL,
	"import_id" integer NOT NULL,
	"claim_ref" text NOT NULL,
	"policy_ref" text NOT NULL,
	"date_of_loss" date NOT NULL,
	"date_notified" date,
	"status" "claim_status",
	"cause" text,
	"paid_this_month" numeric(14, 2),
	"paid_to_date" numeric(14, 2),
	"reserve_movement" numeric(14, 2),
	"outstanding_reserve" numeric(14, 2),
	"currency" text,
	"reporting_month" text NOT NULL,
	"source_row" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"insurer_id" integer NOT NULL,
	"file_kind" "file_kind" NOT NULL,
	"reporting_month" text NOT NULL,
	"filename" text NOT NULL,
	"storage_path" text NOT NULL,
	"mapping_config_id" integer,
	"status" "import_status" NOT NULL,
	"headers" jsonb,
	"headers_hash" text,
	"layout_change" jsonb,
	"suggestion" jsonb,
	"row_count" integer,
	"loaded_count" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "insurers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_id" integer NOT NULL,
	"rule" text NOT NULL,
	"severity" "severity" NOT NULL,
	"source_row" integer NOT NULL,
	"source_column" text,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mapping_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"insurer_id" integer NOT NULL,
	"file_kind" "file_kind" NOT NULL,
	"version" integer NOT NULL,
	"source_headers" jsonb NOT NULL,
	"source_headers_hash" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"insurer_id" integer NOT NULL,
	"import_id" integer NOT NULL,
	"policy_ref" text NOT NULL,
	"insured_name" text,
	"inception_date" date NOT NULL,
	"expiry_date" date NOT NULL,
	"product" text,
	"destination" text,
	"sum_insured" numeric(14, 2),
	"gross_premium" numeric(14, 2),
	"currency" text,
	"source_row" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_insurer_id_insurers_id_fk" FOREIGN KEY ("insurer_id") REFERENCES "public"."insurers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_insurer_id_insurers_id_fk" FOREIGN KEY ("insurer_id") REFERENCES "public"."insurers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_mapping_config_id_mapping_configs_id_fk" FOREIGN KEY ("mapping_config_id") REFERENCES "public"."mapping_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_configs" ADD CONSTRAINT "mapping_configs_insurer_id_insurers_id_fk" FOREIGN KEY ("insurer_id") REFERENCES "public"."insurers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_insurer_id_insurers_id_fk" FOREIGN KEY ("insurer_id") REFERENCES "public"."insurers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claims_ref_month_uq" ON "claims" USING btree ("insurer_id","claim_ref","reporting_month");--> statement-breakpoint
CREATE INDEX "claims_policy_idx" ON "claims" USING btree ("insurer_id","policy_ref");--> statement-breakpoint
CREATE INDEX "imports_insurer_month_idx" ON "imports" USING btree ("insurer_id","file_kind","reporting_month");--> statement-breakpoint
CREATE INDEX "issues_import_idx" ON "issues" USING btree ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mapping_configs_version_uq" ON "mapping_configs" USING btree ("insurer_id","file_kind","version");--> statement-breakpoint
CREATE INDEX "mapping_configs_hash_idx" ON "mapping_configs" USING btree ("insurer_id","file_kind","source_headers_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_ref_uq" ON "policies" USING btree ("insurer_id","policy_ref");