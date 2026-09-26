import { createHash } from "node:crypto";
import { z } from "zod";
import { fieldsFor, type ClaimRecord, type FileKind, type PolicyRecord } from "./canonical";
import { cellText, type Cell, type Table } from "./parse";
import type { Issue } from "./issues";

export const TransformSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("date"), order: z.enum(["DMY", "MDY", "YMD"]) }),
  z.object({ kind: z.literal("amount") }),
  z.object({ kind: z.literal("currency") }),
  z.object({
    kind: z.literal("enum"),
    // raw value (case-insensitive) -> canonical value
    values: z.record(z.string(), z.string()),
  }),
]);
export type Transform = z.infer<typeof TransformSchema>;

export const ColumnMappingSchema = z.object({
  source: z.string(),
  target: z.string().nullable(),
  transform: TransformSchema,
  confidence: z.number().min(0).max(1).optional(),
  note: z.string().optional(),
});
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

export const MappingSchema = z.object({
  columns: z.array(ColumnMappingSchema),
  defaultCurrency: z.string().length(3).nullable().optional(),
});
export type Mapping = z.infer<typeof MappingSchema>;

export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Order-independent hash, so a reordered layout still matches its saved mapping. */
export function headersHash(headers: string[]): string {
  const norm = headers.map(normalizeHeader).sort();
  return createHash("sha256").update(norm.join("\n")).digest("hex").slice(0, 16);
}

export interface LayoutDiff {
  matched: string[];
  added: string[];
  removed: string[];
}

export function diffLayout(mapping: Mapping, headers: string[]): LayoutDiff {
  const known = new Set(mapping.columns.map((c) => normalizeHeader(c.source)));
  const current = new Set(headers.map(normalizeHeader));
  return {
    matched: headers.filter((h) => known.has(normalizeHeader(h))),
    added: headers.filter((h) => !known.has(normalizeHeader(h))),
    removed: mapping.columns.map((c) => c.source).filter((s) => !current.has(normalizeHeader(s))),
  };
}

/**
 * A new file is a revision of a saved layout (carry the mapping over, review only what changed)
 * when at least half its columns are already known. Below that it's a different layout and gets
 * a fresh proposal.
 */
export function isLayoutRevision(diff: LayoutDiff, headers: string[]): boolean {
  return headers.length > 0 && diff.matched.length * 2 >= headers.length;
}

/** Carries a saved mapping over to a new layout; new columns get the given suggestions (or are ignored). */
export function carryOver(mapping: Mapping, headers: string[], suggestions: ColumnMapping[] = []): Mapping {
  const bySource = new Map(mapping.columns.map((c) => [normalizeHeader(c.source), c]));
  const suggested = new Map(suggestions.map((c) => [normalizeHeader(c.source), c]));
  return {
    defaultCurrency: mapping.defaultCurrency,
    columns: headers.map((h) => {
      const prev = bySource.get(normalizeHeader(h));
      if (prev) return { ...prev, source: h };
      return suggested.get(normalizeHeader(h)) ?? { source: h, target: null, transform: { kind: "none" } };
    }),
  };
}

/** Structural checks on a mapping: known targets, no target mapped twice, required fields present. */
export function checkMapping(mapping: Mapping, kind: FileKind): string[] {
  const fields = fieldsFor(kind);
  const names = new Set(fields.map((f) => f.name));
  const errors: string[] = [];
  const used = new Map<string, string>();
  for (const c of mapping.columns) {
    if (c.target === null) continue;
    if (!names.has(c.target)) errors.push(`"${c.source}" maps to unknown field "${c.target}"`);
    const prev = used.get(c.target);
    if (prev) errors.push(`"${c.source}" and "${prev}" both map to ${c.target}`);
    used.set(c.target, c.source);
  }
  for (const f of fields) if (f.required && !used.has(f.name)) errors.push(`Required field ${f.name} is not mapped`);
  return errors;
}

// ---------------------------------------------------------------- transforms

export type TransformResult<T> = { ok: true; value: T | null } | { ok: false; reason: string };

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

export function parseDate(c: Cell, order: "DMY" | "MDY" | "YMD"): TransformResult<string> {
  if (c === null || cellText(c) === "") return { ok: true, value: null };
  if (c instanceof Date) return { ok: true, value: c.toISOString().slice(0, 10) };
  if (typeof c === "number") {
    // Excel serial date
    if (c > 20000 && c < 80000) return { ok: true, value: new Date(EXCEL_EPOCH + c * 86400000).toISOString().slice(0, 10) };
    return { ok: false, reason: `"${c}" is not a date` };
  }
  const s = String(c).trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  let y: number, m: number, d: number;
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const parts = s.split(/[/.\-\s]+/);
    if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return { ok: false, reason: `"${s}" is not a date` };
    const n = parts.map(Number);
    if (order === "DMY") [d, m, y] = n;
    else if (order === "MDY") [m, d, y] = n;
    else [y, m, d] = n;
    if (y < 100) y += 2000;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false, reason: `"${s}" is not a valid ${order} date` };
  }
  return { ok: true, value: dt.toISOString().slice(0, 10) };
}

const SYMBOL_CURRENCY: Record<string, string> = { "£": "GBP", $: "USD", "€": "EUR" };

export function parseAmount(c: Cell): TransformResult<number> & { currency?: string } {
  if (c === null || cellText(c) === "") return { ok: true, value: null };
  if (typeof c === "number") return { ok: true, value: round2(c) };
  let s = String(c).trim();
  let currency: string | undefined;
  const sym = /[£$€]/.exec(s);
  if (sym) currency = SYMBOL_CURRENCY[sym[0]];
  const code = /\b([A-Z]{3})\b/.exec(s);
  if (code) currency = code[1];
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[£$€]|\b[A-Z]{3}\b|,|\s/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, reason: `"${cellText(c)}" is not an amount` };
  const v = round2(Number(s)) * (negative ? -1 : 1);
  return { ok: true, value: v, currency };
}

export function parseCurrency(c: Cell): TransformResult<string> {
  const s = cellText(c).toUpperCase();
  if (!s) return { ok: true, value: null };
  if (SYMBOL_CURRENCY[s]) return { ok: true, value: SYMBOL_CURRENCY[s] };
  if (/^[A-Z]{3}$/.test(s)) return { ok: true, value: s };
  return { ok: false, reason: `"${cellText(c)}" is not a currency code` };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------- apply

export interface MappedRow<T> {
  sourceRow: number;
  record: T;
  /** canonical field -> source header it came from, for pointing issues at the source cell */
  sourceColumns: Record<string, string>;
  /** fields whose source cell was present but failed to parse (already reported) */
  unparsed: string[];
}

export function applyMapping(table: Table, mapping: Mapping, kind: "policy"): { rows: MappedRow<PolicyRecord>[]; issues: Issue[] };
export function applyMapping(table: Table, mapping: Mapping, kind: "claim"): { rows: MappedRow<ClaimRecord>[]; issues: Issue[] };
export function applyMapping(table: Table, mapping: Mapping, kind: FileKind): { rows: MappedRow<PolicyRecord | ClaimRecord>[]; issues: Issue[] } {
  const fields = fieldsFor(kind);
  const headerIndex = new Map(table.headers.map((h, i) => [normalizeHeader(h), i]));
  const active = mapping.columns
    .filter((c) => c.target !== null)
    .map((c) => ({ ...c, index: headerIndex.get(normalizeHeader(c.source)) }))
    .filter((c): c is typeof c & { index: number } => c.index !== undefined);

  const issues: Issue[] = [];
  const rows: MappedRow<PolicyRecord | ClaimRecord>[] = [];

  for (const row of table.rows) {
    const record: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.name, null]));
    const sourceColumns: Record<string, string> = {};
    const unparsed: string[] = [];
    let symbolCurrency: string | undefined;

    for (const col of active) {
      const target = col.target!;
      const field = fields.find((f) => f.name === target)!;
      const raw = row.cells[col.index];
      sourceColumns[target] = col.source;
      const fail = (rule: Issue["rule"], reason: string) => {
        unparsed.push(target);
        issues.push({ rule, severity: "error", sourceRow: row.sourceRow, sourceColumn: col.source, message: reason });
      };

      const t = col.transform;
      if (field.type === "date" || t.kind === "date") {
        const r = parseDate(raw, t.kind === "date" ? t.order : "YMD");
        if (r.ok) record[target] = r.value;
        else fail("unparseable_date", r.reason);
      } else if (field.type === "amount" || t.kind === "amount") {
        const r = parseAmount(raw);
        if (r.ok) {
          record[target] = r.value;
          symbolCurrency ??= r.currency;
        } else fail("unparseable_amount", r.reason);
      } else if (t.kind === "enum" || field.type === "claim_status") {
        const text = cellText(raw);
        if (!text) continue;
        const values = t.kind === "enum" ? t.values : {};
        const hit = Object.entries(values).find(([k]) => k.toLowerCase() === text.toLowerCase());
        const canonical = hit ? hit[1] : text.toLowerCase();
        if (field.type === "claim_status" && !["open", "closed", "reopened"].includes(canonical)) {
          fail("unknown_value", `"${text}" is not a recognised claim status`);
        } else record[target] = canonical;
      } else if (field.type === "currency" || t.kind === "currency") {
        const r = parseCurrency(raw);
        if (r.ok) record[target] = r.value;
        else fail("unparseable_currency", r.reason);
      } else {
        const text = cellText(raw);
        record[target] = text === "" ? null : text;
      }
    }
    if ("currency" in record && record.currency === null) record.currency = symbolCurrency ?? mapping.defaultCurrency ?? null;
    // record has exactly the canonical fields for this kind, each set by a typed transform above
    rows.push({ sourceRow: row.sourceRow, record: record as unknown as PolicyRecord | ClaimRecord, sourceColumns, unparsed });
  }
  return { rows, issues };
}
