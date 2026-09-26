// Builds the monthly claims bordereau in CRS layout and serialises it to CSV / XLSX.
import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { ClaimRecord, PolicyRecord } from "./canonical";
import { CRS_CLAIM_FIELDS, CRS_FIELDS_CONFIRMED, CRS_VERSION } from "./crs-fields";

export interface ClaimsReport {
  month: string;
  columns: { name: string; kind: "text" | "date" | "money" }[];
  rows: (string | number | null)[][];
  /** column name -> total, for money columns */
  totals: Record<string, number>;
}

export const toPence = (n: number) => Math.round(n * 100);
export const fromPence = (p: number) => p / 100;

export function buildClaimsReport(month: string, claims: ClaimRecord[], policies: Map<string, PolicyRecord>): ClaimsReport {
  const sorted = [...claims].sort((a, b) => (a.claim_ref ?? "").localeCompare(b.claim_ref ?? ""));
  const rows = sorted.map((c) => CRS_CLAIM_FIELDS.map((f) => f.value(c, policies.get(c.policy_ref ?? ""), month)));
  const totals: Record<string, number> = {};
  CRS_CLAIM_FIELDS.forEach((f, i) => {
    if (f.kind === "money") totals[f.name] = fromPence(rows.reduce((s, r) => s + toPence(Number(r[i] ?? 0)), 0));
  });
  return { month, columns: CRS_CLAIM_FIELDS.map((f) => ({ name: f.name, kind: f.kind })), rows, totals };
}

const TOTAL_LABEL = "Total";

export function reportToCsv(r: ClaimsReport): string {
  const totalRow = r.columns.map((c, i) => (i === 0 ? TOTAL_LABEL : c.kind === "money" ? r.totals[c.name].toFixed(2) : ""));
  const body = r.rows.map((row) => row.map((v, i) => (v === null ? "" : r.columns[i].kind === "money" ? Number(v).toFixed(2) : String(v))));
  return Papa.unparse([r.columns.map((c) => c.name), ...body, totalRow], { newline: "\n" }) + "\n";
}

export async function reportToXlsx(r: ClaimsReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Claims ${r.month}`);
  ws.addRow(r.columns.map((c) => c.name)).font = { bold: true };
  for (const row of r.rows) ws.addRow(row);
  const total = ws.addRow(r.columns.map((c, i) => (i === 0 ? TOTAL_LABEL : c.kind === "money" ? r.totals[c.name] : null)));
  total.font = { bold: true };
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(12, Math.min(34, c.name.length + 2));
    if (c.kind === "money") col.numFmt = "#,##0.00";
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const about = wb.addWorksheet("About");
  about.addRow([`Lloyd's CRS v${CRS_VERSION} claims bordereau (travel / A&H subset). Synthetic data.`]);
  if (!CRS_FIELDS_CONFIRMED) about.addRow(["Field names are provisional pending the LMG glossary export."]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Reads an exported CSV back: data rows plus the totals row, for verifying what was actually written. */
export function parseReportCsv(text: string): { header: string[]; rows: string[][]; totals: string[] | null } {
  const data = Papa.parse<string[]>(text, { skipEmptyLines: true }).data;
  const [header, ...rest] = data;
  const last = rest[rest.length - 1];
  const hasTotals = last?.[0] === TOTAL_LABEL;
  return { header, rows: hasTotals ? rest.slice(0, -1) : rest, totals: hasTotals ? last : null };
}
