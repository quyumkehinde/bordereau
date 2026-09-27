
import { date, index, integer, jsonb, numeric, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { Mapping } from "@/lib/mapping";

export const fileKind = pgEnum("file_kind", ["policy", "claim"]);
export const importStatus = pgEnum("import_status", ["needs_mapping", "imported", "failed", "superseded"]);
export const claimStatus = pgEnum("claim_status", ["open", "closed", "reopened"]);
export const severity = pgEnum("severity", ["error", "warning"]);

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

export const insurers = pgTable("insurers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mappingConfigs = pgTable(
  "mapping_configs",
  {
    id: serial("id").primaryKey(),
    insurerId: integer("insurer_id").notNull().references(() => insurers.id),
    fileKind: fileKind("file_kind").notNull(),
    version: integer("version").notNull(),
    sourceHeaders: jsonb("source_headers").$type<string[]>().notNull(),
    sourceHeadersHash: text("source_headers_hash").notNull(),
    mapping: jsonb("mapping").$type<Mapping>().notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mapping_configs_version_uq").on(t.insurerId, t.fileKind, t.version),
    index("mapping_configs_hash_idx").on(t.insurerId, t.fileKind, t.sourceHeadersHash),
  ],
);

export interface LayoutChange {
  previousConfigId: number;
  added: string[];
  removed: string[];
}

export const imports = pgTable(
  "imports",
  {
    id: serial("id").primaryKey(),
    insurerId: integer("insurer_id").notNull().references(() => insurers.id),
    fileKind: fileKind("file_kind").notNull(),
    reportingMonth: text("reporting_month").notNull(), // yyyy-mm
    filename: text("filename").notNull(),
    storagePath: text("storage_path").notNull(),
    mappingConfigId: integer("mapping_config_id").references(() => mappingConfigs.id),
    status: importStatus("status").notNull(),
    headers: jsonb("headers").$type<string[]>(),
    headersHash: text("headers_hash"),
    layoutChange: jsonb("layout_change").$type<LayoutChange>(),
    suggestion: jsonb("suggestion").$type<{ mapping: Mapping; source: "gemini" | "heuristic"; warning?: string }>(),
    rowCount: integer("row_count"),
    loadedCount: integer("loaded_count"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("imports_insurer_month_idx").on(t.insurerId, t.fileKind, t.reportingMonth)],
);

export const policies = pgTable(
  "policies",
  {
    id: serial("id").primaryKey(),
    insurerId: integer("insurer_id").notNull().references(() => insurers.id),
    importId: integer("import_id").notNull().references(() => imports.id, { onDelete: "cascade" }),
    policyRef: text("policy_ref").notNull(),
    insuredName: text("insured_name"),
    inceptionDate: date("inception_date", { mode: "string" }).notNull(),
    expiryDate: date("expiry_date", { mode: "string" }).notNull(),
    product: text("product"),
    destination: text("destination"),
    sumInsured: money("sum_insured"),
    grossPremium: money("gross_premium"),
    currency: text("currency"),
    sourceRow: integer("source_row").notNull(),
  },
  (t) => [uniqueIndex("policies_ref_uq").on(t.insurerId, t.policyRef)],
);

export const claims = pgTable(
  "claims",
  {
    id: serial("id").primaryKey(),
    insurerId: integer("insurer_id").notNull().references(() => insurers.id),
    importId: integer("import_id").notNull().references(() => imports.id, { onDelete: "cascade" }),
    claimRef: text("claim_ref").notNull(),
    policyRef: text("policy_ref").notNull(),
    dateOfLoss: date("date_of_loss", { mode: "string" }).notNull(),
    dateNotified: date("date_notified", { mode: "string" }),
    status: claimStatus("status"),
    cause: text("cause"),
    paidThisMonth: money("paid_this_month"),
    paidToDate: money("paid_to_date"),
    reserveMovement: money("reserve_movement"),
    outstandingReserve: money("outstanding_reserve"),
    currency: text("currency"),
    reportingMonth: text("reporting_month").notNull(),
    sourceRow: integer("source_row").notNull(),
  },
  (t) => [
    uniqueIndex("claims_ref_month_uq").on(t.insurerId, t.claimRef, t.reportingMonth),
    index("claims_policy_idx").on(t.insurerId, t.policyRef),
  ],
);

export const issues = pgTable(
  "issues",
  {
    id: serial("id").primaryKey(),
    importId: integer("import_id").notNull().references(() => imports.id, { onDelete: "cascade" }),
    rule: text("rule").notNull(),
    severity: severity("severity").notNull(),
    sourceRow: integer("source_row").notNull(),
    sourceColumn: text("source_column"),
    message: text("message").notNull(),
  },
  (t) => [index("issues_import_idx").on(t.importId)],
);

