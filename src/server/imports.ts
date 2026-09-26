// Import service: upload -> parse -> find or ask for a mapping -> validate -> load, in one transaction.
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, max, ne, sql } from "drizzle-orm";
import type { ClaimRecord, FileKind, PolicyRecord } from "@/lib/canonical";
import { isMonth, monthEnd } from "@/lib/dates";
import { carryOver, checkMapping, diffLayout, headersHash, isLayoutRevision, MappingSchema, type Mapping } from "@/lib/mapping";
import { parseFile, type Table } from "@/lib/parse";
import { runClaimPipeline, runPolicyPipeline } from "@/lib/pipeline";
import { suggestMapping } from "@/lib/suggest";
import { db, schema, type Tx } from "@/db";
import { fileStore } from "./storage";

const { imports, mappingConfigs, policies, claims, issues } = schema;

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const CONTENT_TYPES: Record<string, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export interface UploadInput {
  insurerId: number;
  kind: FileKind;
  month: string;
  filename: string;
  data: Buffer;
}

export type UploadResult = { importId: number; status: "imported" | "needs_mapping" | "failed"; error?: string };

export async function receiveUpload(input: UploadInput): Promise<UploadResult> {
  const ext = input.filename.toLowerCase().split(".").pop() ?? "";
  if (!CONTENT_TYPES[ext]) throw new UserError("Upload a .csv or .xlsx file");
  if (!isMonth(input.month)) throw new UserError("Reporting month must look like 2026-07");
  if (input.data.length === 0) throw new UserError("The file is empty");
  if (input.data.length > MAX_UPLOAD_BYTES) throw new UserError("Files over 20 MB aren't supported");

  const safeName = input.filename.replace(/[^\w.\-]+/g, "_");
  const storagePath = `insurers/${input.insurerId}/${input.kind}/${input.month}/${randomUUID()}-${safeName}`;
  await fileStore().put(storagePath, input.data, CONTENT_TYPES[ext]);

  let table: Table;
  try {
    table = await parseFile(input.data, input.filename);
  } catch (e) {
    const [row] = await db
      .insert(imports)
      .values({ ...base(input, storagePath), status: "failed", error: e instanceof Error ? e.message : String(e) })
      .returning({ id: imports.id });
    return { importId: row.id, status: "failed", error: e instanceof Error ? e.message : String(e) };
  }

  const hash = headersHash(table.headers);
  const [row] = await db
    .insert(imports)
    .values({ ...base(input, storagePath), status: "needs_mapping", headers: table.headers, headersHash: hash, rowCount: table.rows.length })
    .returning({ id: imports.id });

  // Same layout as an approved mapping (column order doesn't matter): import with no clicks.
  const [known] = await db
    .select()
    .from(mappingConfigs)
    .where(and(eq(mappingConfigs.insurerId, input.insurerId), eq(mappingConfigs.fileKind, input.kind), eq(mappingConfigs.sourceHeadersHash, hash)))
    .orderBy(desc(mappingConfigs.version))
    .limit(1);
  if (known) {
    await processImport(row.id, known.id, table);
    return { importId: row.id, status: "imported" };
  }

  // Otherwise record what changed against the latest approved layout, if there is one.
  const previous = await latestConfig(input.insurerId, input.kind);
  if (previous) {
    const diff = diffLayout(previous.mapping, table.headers);
    if (isLayoutRevision(diff, table.headers)) await db.update(imports).set({ layoutChange: { previousConfigId: previous.id, added: diff.added, removed: diff.removed } }).where(eq(imports.id, row.id));
  }
  return { importId: row.id, status: "needs_mapping" };
}

function base(input: UploadInput, storagePath: string) {
  return { insurerId: input.insurerId, fileKind: input.kind, reportingMonth: input.month, filename: input.filename, storagePath };
}

async function latestConfig(insurerId: number, kind: FileKind) {
  const [c] = await db
    .select()
    .from(mappingConfigs)
    .where(and(eq(mappingConfigs.insurerId, insurerId), eq(mappingConfigs.fileKind, kind)))
    .orderBy(desc(mappingConfigs.version))
    .limit(1);
  return c;
}

export async function loadImport(importId: number) {
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId));
  if (!imp) throw new UserError(`Import ${importId} not found`);
  return imp;
}

export async function loadTable(storagePath: string, filename: string): Promise<Table> {
  return parseFile(await fileStore().get(storagePath), filename);
}

export interface MappingDraft {
  mapping: Mapping;
  source: "claude" | "heuristic";
  warning?: string;
  carriedFrom?: { configId: number; version: number };
  /** headers that need a decision (all of them for a new insurer; only changed ones for a new layout) */
  toReview: string[];
  removed: string[];
}

/** Builds (once) and caches the mapping proposal for an import waiting on review. */
export async function mappingDraft(importId: number): Promise<MappingDraft> {
  const imp = await loadImport(importId);
  if (imp.status !== "needs_mapping") throw new UserError("This import already has a mapping");
  const table = await loadTable(imp.storagePath, imp.filename);
  const change = imp.layoutChange;
  const previous = change ? (await db.select().from(mappingConfigs).where(eq(mappingConfigs.id, change.previousConfigId)))[0] : undefined;

  let suggestion = imp.suggestion;
  if (!suggestion) {
    const onlyHeaders = previous ? change!.added : undefined;
    suggestion = onlyHeaders && onlyHeaders.length === 0
      ? { mapping: { columns: [] }, source: "heuristic" }
      : await suggestMapping({ kind: imp.fileKind, table, onlyHeaders });
    await db.update(imports).set({ suggestion }).where(eq(imports.id, importId));
  }

  if (previous) {
    return {
      mapping: carryOver(previous.mapping, table.headers, suggestion.mapping.columns),
      source: suggestion.source,
      warning: suggestion.warning,
      carriedFrom: { configId: previous.id, version: previous.version },
      toReview: change!.added,
      removed: change!.removed,
    };
  }
  return { mapping: suggestion.mapping, source: suggestion.source, warning: suggestion.warning, toReview: table.headers, removed: [] };
}

/** Saves the reviewed mapping as the insurer's next config version and runs the import. */
export async function approveMapping(importId: number, input: unknown): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const imp = await loadImport(importId);
  if (imp.status !== "needs_mapping") return { ok: false, errors: ["This import already has a mapping"] };
  const parsed = MappingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const mapping = parsed.data;
  const errors = checkMapping(mapping, imp.fileKind);
  const headers = imp.headers ?? [];
  if (mapping.columns.length !== headers.length || mapping.columns.some((c, i) => c.source !== headers[i])) {
    errors.push("Mapping columns don't match the file's headers");
  }
  if (errors.length) return { ok: false, errors };

  const config = await db.transaction(async (tx) => {
    // Claim the import so a double-submitted approval can't create two versions.
    const [locked] = await tx.select({ status: imports.status, configId: imports.mappingConfigId }).from(imports).where(eq(imports.id, importId)).for("update");
    if (locked.status !== "needs_mapping" || locked.configId !== null) return null;
    // Serialise version numbers per insurer/kind.
    await tx.execute(sql`select pg_advisory_xact_lock(${imp.insurerId}::int, ${imp.fileKind === "policy" ? 1 : 2}::int)`);
    const [{ v }] = await tx
      .select({ v: max(mappingConfigs.version) })
      .from(mappingConfigs)
      .where(and(eq(mappingConfigs.insurerId, imp.insurerId), eq(mappingConfigs.fileKind, imp.fileKind)));
    const [c] = await tx
      .insert(mappingConfigs)
      .values({
        insurerId: imp.insurerId,
        fileKind: imp.fileKind,
        version: (v ?? 0) + 1,
        sourceHeaders: headers,
        sourceHeadersHash: imp.headersHash!,
        mapping: stripReviewMetadata(mapping),
      })
      .returning();
    await tx.update(imports).set({ mappingConfigId: c.id }).where(eq(imports.id, importId));
    return c;
  });
  if (!config) return { ok: false, errors: ["This import already has a mapping"] };
  await processImport(importId, config.id);
  return { ok: true };
}

/** Confidence and notes belong to the suggestion, not to the approved config. */
function stripReviewMetadata(m: Mapping): Mapping {
  return { defaultCurrency: m.defaultCurrency ?? null, columns: m.columns.map(({ source, target, transform }) => ({ source, target, transform })) };
}

/**
 * Applies a mapping config to an import and loads it. A later import for the same insurer, kind
 * and month supersedes the earlier one (an insurer's corrected resend replaces its rows).
 */
export async function processImport(importId: number, configId: number, preParsed?: Table) {
  const imp = await loadImport(importId);
  const [config] = await db.select().from(mappingConfigs).where(eq(mappingConfigs.id, configId));
  const table = preParsed ?? (await loadTable(imp.storagePath, imp.filename));

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${imp.insurerId}::bigint)`);
    const superseded = (
      await tx
        .select({ id: imports.id })
        .from(imports)
        .where(
          and(
            eq(imports.insurerId, imp.insurerId),
            eq(imports.fileKind, imp.fileKind),
            eq(imports.reportingMonth, imp.reportingMonth),
            eq(imports.status, "imported"),
            ne(imports.id, imp.id),
          ),
        )
    ).map((r) => r.id);

    if (superseded.length) {
      if (imp.fileKind === "policy") await tx.delete(policies).where(inArray(policies.importId, superseded));
      else await tx.delete(claims).where(inArray(claims.importId, superseded));
      await tx.update(imports).set({ status: "superseded" }).where(inArray(imports.id, superseded));
    }

    const result = imp.fileKind === "policy" ? await loadPolicies(tx, imp, table, config.mapping) : await loadClaims(tx, imp, table, config.mapping);

    await tx.delete(issues).where(eq(issues.importId, imp.id));
    for (const chunk of chunks(result.issues, 1000)) {
      await tx.insert(issues).values(chunk.map((i) => ({ importId: imp.id, rule: i.rule, severity: i.severity, sourceRow: i.sourceRow, sourceColumn: i.sourceColumn, message: i.message })));
    }
    await tx
      .update(imports)
      .set({ status: "imported", mappingConfigId: config.id, rowCount: table.rows.length, loadedCount: result.loaded, error: null, processedAt: new Date() })
      .where(eq(imports.id, imp.id));
  });
}

type ImportRow = Awaited<ReturnType<typeof loadImport>>;

async function loadPolicies(tx: Tx, imp: ImportRow, table: Table, mapping: Mapping) {
  const existing = await tx.select({ ref: policies.policyRef }).from(policies).where(eq(policies.insurerId, imp.insurerId));
  const result = runPolicyPipeline(table, mapping, { existingRefs: new Set(existing.map((r) => r.ref)) });
  for (const chunk of chunks(result.load, 1000)) {
    await tx.insert(policies).values(chunk.map((r) => policyValues(imp, r.record, r.sourceRow)));
  }
  return { issues: result.issues, loaded: result.load.length };
}

async function loadClaims(tx: Tx, imp: ImportRow, table: Table, mapping: Mapping) {
  const rows = await tx.select().from(policies).where(eq(policies.insurerId, imp.insurerId));
  const byRef = new Map<string, PolicyRecord>(
    rows.map((p) => [
      p.policyRef,
      {
        policy_ref: p.policyRef,
        insured_name: p.insuredName,
        inception_date: p.inceptionDate,
        expiry_date: p.expiryDate,
        product: p.product,
        destination: p.destination,
        sum_insured: p.sumInsured,
        gross_premium: p.grossPremium,
        currency: p.currency,
      },
    ]),
  );
  const result = runClaimPipeline(table, mapping, { policies: byRef, asOf: monthEnd(imp.reportingMonth) });
  for (const chunk of chunks(result.load, 1000)) {
    await tx.insert(claims).values(chunk.map((r) => claimValues(imp, r.record, r.sourceRow)));
  }
  return { issues: result.issues, loaded: result.load.length };
}

// Loaded rows have passed the required-field rules, so the non-null assertions hold.
function policyValues(imp: ImportRow, r: PolicyRecord, sourceRow: number): typeof policies.$inferInsert {
  return {
    insurerId: imp.insurerId,
    importId: imp.id,
    policyRef: r.policy_ref!,
    insuredName: r.insured_name,
    inceptionDate: r.inception_date!,
    expiryDate: r.expiry_date!,
    product: r.product,
    destination: r.destination,
    sumInsured: r.sum_insured,
    grossPremium: r.gross_premium,
    currency: r.currency,
    sourceRow,
  };
}

function claimValues(imp: ImportRow, r: ClaimRecord, sourceRow: number): typeof claims.$inferInsert {
  return {
    insurerId: imp.insurerId,
    importId: imp.id,
    claimRef: r.claim_ref!,
    policyRef: r.policy_ref!,
    dateOfLoss: r.date_of_loss!,
    dateNotified: r.date_notified,
    status: r.status,
    cause: r.cause,
    paidThisMonth: r.paid_this_month,
    paidToDate: r.paid_to_date,
    reserveMovement: r.reserve_movement,
    outstandingReserve: r.outstanding_reserve,
    currency: r.currency,
    reportingMonth: imp.reportingMonth,
    sourceRow,
  };
}

function* chunks<T>(xs: T[], size: number): Generator<T[]> {
  for (let i = 0; i < xs.length; i += size) yield xs.slice(i, i + size);
}

/** An error whose message is safe and useful to show the user. */
export class UserError extends Error {}
