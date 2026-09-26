// Read models for pages.
import { and, asc, count, desc, eq, max, min } from "drizzle-orm";
import { db, schema } from "@/db";

const { insurers, imports, issues, mappingConfigs, policies, claims } = schema;

export async function listInsurers() {
  // Separate grouped queries merged in code: simpler to read than correlated subqueries.
  const [rows, importCounts, policyCounts, errorCounts, latest] = await Promise.all([
    db.select().from(insurers).orderBy(asc(insurers.name)),
    db.select({ id: imports.insurerId, n: count() }).from(imports).where(eq(imports.status, "imported")).groupBy(imports.insurerId),
    db.select({ id: policies.insurerId, n: count() }).from(policies).groupBy(policies.insurerId),
    db
      .select({ id: imports.insurerId, n: count() })
      .from(issues)
      .innerJoin(imports, eq(imports.id, issues.importId))
      .where(and(eq(imports.status, "imported"), eq(issues.severity, "error")))
      .groupBy(imports.insurerId),
    db.select({ id: claims.insurerId, m: max(claims.reportingMonth) }).from(claims).groupBy(claims.insurerId),
  ]);
  const byId = <T extends { id: number }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  const [ic, pc, ec, lm] = [byId(importCounts), byId(policyCounts), byId(errorCounts), byId(latest)];
  return rows.map((i) => ({
    id: i.id,
    name: i.name,
    imports: ic.get(i.id)?.n ?? 0,
    policies: pc.get(i.id)?.n ?? 0,
    openIssues: ec.get(i.id)?.n ?? 0,
    lastMonth: lm.get(i.id)?.m ?? null,
  }));
}

export async function getInsurer(id: number) {
  const [row] = await db.select().from(insurers).where(eq(insurers.id, id));
  return row;
}

export async function importsForInsurer(insurerId: number) {
  const [rows, issueCounts] = await Promise.all([
    db
      .select({
        id: imports.id,
        fileKind: imports.fileKind,
        reportingMonth: imports.reportingMonth,
        filename: imports.filename,
        status: imports.status,
        rowCount: imports.rowCount,
        loadedCount: imports.loadedCount,
        createdAt: imports.createdAt,
        version: mappingConfigs.version,
      })
      .from(imports)
      .leftJoin(mappingConfigs, eq(mappingConfigs.id, imports.mappingConfigId))
      .where(eq(imports.insurerId, insurerId))
      .orderBy(desc(imports.reportingMonth), asc(imports.fileKind), desc(imports.id)),
    db
      .select({ importId: issues.importId, severity: issues.severity, n: count() })
      .from(issues)
      .innerJoin(imports, eq(imports.id, issues.importId))
      .where(eq(imports.insurerId, insurerId))
      .groupBy(issues.importId, issues.severity),
  ]);
  const n = (id: number, sev: "error" | "warning") => issueCounts.find((c) => c.importId === id && c.severity === sev)?.n ?? 0;
  return rows.map((r) => ({ ...r, errors: n(r.id, "error"), warnings: n(r.id, "warning") }));
}

export async function mappingVersions(insurerId: number) {
  return db
    .select({ id: mappingConfigs.id, fileKind: mappingConfigs.fileKind, version: mappingConfigs.version, approvedAt: mappingConfigs.approvedAt, headers: mappingConfigs.sourceHeaders })
    .from(mappingConfigs)
    .where(eq(mappingConfigs.insurerId, insurerId))
    .orderBy(asc(mappingConfigs.fileKind), desc(mappingConfigs.version));
}

/** Time from creating the insurer to its first successfully loaded bordereau. */
export async function onboardingTime(insurerId: number): Promise<number | null> {
  const [ins] = await db.select({ createdAt: insurers.createdAt }).from(insurers).where(eq(insurers.id, insurerId));
  const [first] = await db.select({ at: min(imports.processedAt) }).from(imports).where(eq(imports.insurerId, insurerId));
  if (!ins || !first?.at) return null;
  return new Date(first.at).getTime() - ins.createdAt.getTime();
}

export async function importIssues(importId: number) {
  return db.select().from(issues).where(eq(issues.importId, importId)).orderBy(asc(issues.sourceRow), asc(issues.id));
}

export async function importIssueCounts(importId: number) {
  return db
    .select({ rule: issues.rule, severity: issues.severity, n: count() })
    .from(issues)
    .where(eq(issues.importId, importId))
    .groupBy(issues.rule, issues.severity);
}

export async function mappingConfig(id: number) {
  const [c] = await db.select().from(mappingConfigs).where(eq(mappingConfigs.id, id));
  return c;
}

export async function monthsWithClaims(insurerId: number) {
  return db
    .select({ month: claims.reportingMonth, n: count() })
    .from(claims)
    .where(and(eq(claims.insurerId, insurerId)))
    .groupBy(claims.reportingMonth)
    .orderBy(desc(claims.reportingMonth));
}
