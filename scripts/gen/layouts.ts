// How each fake insurer lays out its bordereaux, and writers that render rows to CSV/XLSX.
// Each column carries its ground-truth mapping so the manifest can record what a reviewer should approve.
import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { FileKind } from "../../src/lib/canonical";
import type { Rule } from "../../src/lib/issues";
import type { Mapping, Transform } from "../../src/lib/mapping";
import type { GenClaim, GenPolicy } from "./portfolio";
import type { Rng } from "./rng";

type Nullable<T> = { [K in keyof T]: T[K] | null };

export interface Plant {
  rule: Rule;
  field: string | null; // canonical field the issue points at
  note: string;
}

export interface Row<T> {
  v: Nullable<T>;
  /** render this field as a malformed value of its type */
  corrupt?: { field: keyof T & string; kind: "date" | "amount" };
  plants: Plant[];
}
export type PolicyRow = Row<GenPolicy>;
export type ClaimRow = Row<GenClaim>;

export interface Column<T> {
  header: string;
  group?: string; // two-row merged header (XLSX): parsed header is "group header"
  field: keyof T & string;
  target: string | null; // canonical target; null = column a reviewer should ignore
  transform: Transform;
  render: (row: Row<T>) => string | null;
}

export interface Rendered {
  buffer: Buffer;
  ext: "csv" | "xlsx";
  /** sourceRow for each input row, in order */
  sourceRows: number[];
  /** parsed header for each column, as the app's parser will see it */
  headers: string[];
}

export interface InsurerLayout {
  id: string;
  name: string;
  currency: string;
  policyRef: (n: number) => string;
  claimRef: (n: number) => string;
  allowReopen: boolean;
  columns(kind: "policy", month: string): Column<GenPolicy>[];
  columns(kind: "claim", month: string): Column<GenClaim>[];
  write(kind: FileKind, month: string, headers: { header: string; group?: string }[], cells: (string | null)[][]): Promise<Rendered>;
}

// ---------------------------------------------------------------- value formatting

type DateOrder = "DMY" | "MDY" | "YMD";

function formatDate(iso: string, order: DateOrder, twoDigitYear = false): string {
  const [y, m, d] = iso.split("-");
  const yy = twoDigitYear ? y.slice(2) : y;
  if (order === "DMY") return `${d}/${m}/${yy}`;
  if (order === "MDY") return `${m}/${d}/${yy}`;
  return `${y}-${m}-${d}`;
}

function impossibleDate(order: DateOrder, twoDigitYear = false): string {
  // 31 February
  const yy = twoDigitYear ? "26" : "2026";
  return order === "DMY" ? `31/02/${yy}` : order === "MDY" ? `02/31/${yy}` : "2026-02-31";
}

const plain = (pence: number) => (pence / 100).toFixed(2);
const sterling = (pence: number) => {
  const s = `£${(Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return pence < 0 ? `-${s}` : s;
};
/** A typo'd amount: letter O instead of a zero, as keyed by hand. */
const typo = (s: string) => (s.includes("0") ? s.replace("0", "O") : `${s}O`);

function col<T>(
  header: string,
  field: keyof T & string,
  target: string | null,
  transform: Transform,
  render: (v: Nullable<T>[keyof T & string]) => string | null,
  corruptAs?: () => string,
  group?: string,
): Column<T> {
  return {
    header,
    group,
    field,
    target,
    transform,
    render: (row) => {
      if (row.corrupt?.field === field && corruptAs) return corruptAs();
      const v = row.v[field];
      return v === null || v === undefined ? null : render(v);
    },
  };
}

const NONE: Transform = { kind: "none" };
const AMOUNT: Transform = { kind: "amount" };
const CURRENCY: Transform = { kind: "currency" };
const date = (order: DateOrder): Transform => ({ kind: "date", order });
const str = (v: unknown) => String(v);

// ---------------------------------------------------------------- writers

async function writeCsv(preamble: string[], headers: string[], cells: (string | null)[][]): Promise<Rendered> {
  const lines = [...preamble.map((l) => [l]), headers, ...cells.map((r) => r.map((c) => c ?? ""))];
  const text = Papa.unparse(lines, { newline: "\n" }) + "\n";
  const first = preamble.length + 2;
  return { buffer: Buffer.from(text, "utf8"), ext: "csv", sourceRows: cells.map((_, i) => first + i), headers };
}

// ---------------------------------------------------------------- insurer A: clean-ish CSV, UK dates

const A: InsurerLayout = {
  id: "A",
  name: "Albion Travel Underwriting",
  currency: "GBP",
  policyRef: (n) => `TRV-A-${String(n).padStart(6, "0")}`,
  claimRef: (n) => `CLM-A-${String(n).padStart(5, "0")}`,
  allowReopen: true,
  columns: ((kind: FileKind) => {
    const d = (iso: unknown) => formatDate(String(iso), "DMY");
    const bad = () => impossibleDate("DMY");
    const amt = (v: unknown) => plain(Number(v));
    const badAmt = () => typo("1250.00");
    if (kind === "policy") {
      return [
        col<GenPolicy>("Policy Number", "policy_ref", "policy_ref", NONE, str),
        col<GenPolicy>("Insured Name", "insured_name", "insured_name", NONE, str),
        col<GenPolicy>("Start Date", "inception_date", "inception_date", date("DMY"), d, bad),
        col<GenPolicy>("End Date", "expiry_date", "expiry_date", date("DMY"), d, bad),
        col<GenPolicy>("Product", "product", "product", NONE, str),
        col<GenPolicy>("Destination", "destination", "destination", NONE, str),
        col<GenPolicy>("Sum Insured", "sum_insured", "sum_insured", AMOUNT, amt, badAmt),
        col<GenPolicy>("Gross Premium", "gross_premium", "gross_premium", AMOUNT, amt, badAmt),
        col<GenPolicy>("Currency", "currency", "currency", CURRENCY, str),
      ];
    }
    const status = { Open: "open", Closed: "closed", "Re-opened": "reopened" };
    const label = (v: unknown) => ({ open: "Open", closed: "Closed", reopened: "Re-opened" })[String(v)] ?? String(v);
    return [
      col<GenClaim>("Claim Number", "claim_ref", "claim_ref", NONE, str),
      col<GenClaim>("Policy Number", "policy_ref", "policy_ref", NONE, str),
      col<GenClaim>("Date of Loss", "date_of_loss", "date_of_loss", date("DMY"), d, bad),
      col<GenClaim>("Date Reported", "date_notified", "date_notified", date("DMY"), d, bad),
      col<GenClaim>("Claim Status", "status", "status", { kind: "enum", values: status }, label),
      col<GenClaim>("Cause of Loss", "cause", "cause", NONE, str),
      col<GenClaim>("Paid This Month", "paid_this_month", "paid_this_month", AMOUNT, amt, badAmt),
      col<GenClaim>("Paid To Date", "paid_to_date", "paid_to_date", AMOUNT, amt, badAmt),
      col<GenClaim>("Reserve Movement", "reserve_movement", "reserve_movement", AMOUNT, amt, badAmt),
      col<GenClaim>("Outstanding Reserve", "outstanding_reserve", "outstanding_reserve", AMOUNT, amt, badAmt),
      col<GenClaim>("Currency", "currency", "currency", CURRENCY, str),
    ];
  }) as InsurerLayout["columns"],
  write: (_kind, _month, headers, cells) => writeCsv([], headers.map((h) => h.header), cells),
};

// ---------------------------------------------------------------- insurer B: XLSX, merged header, US dates, £ strings

const B: InsurerLayout = {
  id: "B",
  name: "Brightwater Assistance MGA",
  currency: "GBP",
  policyRef: (n) => `BPL/2026/${String(n).padStart(5, "0")}`,
  claimRef: (n) => `BCL/2026/${String(n).padStart(4, "0")}`,
  allowReopen: true,
  columns: ((kind: FileKind) => {
    const d = (iso: unknown) => formatDate(String(iso), "MDY");
    const bad = () => impossibleDate("MDY");
    const amt = (v: unknown) => sterling(Number(v));
    const badAmt = () => typo("£1,200.00");
    if (kind === "policy") {
      return [
        col<GenPolicy>("Number", "policy_ref", "policy_ref", NONE, str, undefined, "Policy"),
        col<GenPolicy>("Holder", "insured_name", "insured_name", NONE, str, undefined, "Policy"),
        col<GenPolicy>("Start", "inception_date", "inception_date", date("MDY"), d, bad, "Cover"),
        col<GenPolicy>("End", "expiry_date", "expiry_date", date("MDY"), d, bad, "Cover"),
        col<GenPolicy>("Plan", "product", "product", NONE, str),
        col<GenPolicy>("Destination", "destination", "destination", NONE, str),
        col<GenPolicy>("Sum Insured", "sum_insured", "sum_insured", AMOUNT, amt, badAmt, "Amounts"),
        col<GenPolicy>("Premium", "gross_premium", "gross_premium", AMOUNT, amt, badAmt, "Amounts"),
      ];
    }
    const status = { OPEN: "open", CLOSED: "closed", REOPENED: "reopened" };
    return [
      col<GenClaim>("Number", "claim_ref", "claim_ref", NONE, str, undefined, "Claim"),
      col<GenClaim>("Policy No", "policy_ref", "policy_ref", NONE, str, undefined, "Claim"),
      col<GenClaim>("Loss", "date_of_loss", "date_of_loss", date("MDY"), d, bad, "Dates"),
      col<GenClaim>("Advised", "date_notified", "date_notified", date("MDY"), d, bad, "Dates"),
      col<GenClaim>("Status", "status", "status", { kind: "enum", values: status }, (v) => String(v).toUpperCase()),
      col<GenClaim>("Cause", "cause", "cause", NONE, str),
      col<GenClaim>("This Month", "paid_this_month", "paid_this_month", AMOUNT, amt, badAmt, "Paid"),
      col<GenClaim>("To Date", "paid_to_date", "paid_to_date", AMOUNT, amt, badAmt, "Paid"),
      col<GenClaim>("Movement", "reserve_movement", "reserve_movement", AMOUNT, amt, badAmt, "Reserve"),
      col<GenClaim>("Outstanding", "outstanding_reserve", "outstanding_reserve", AMOUNT, amt, badAmt, "Reserve"),
    ];
  }) as InsurerLayout["columns"],
  write: async (kind, month, headers, cells) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(kind === "policy" ? "Policies" : "Claims");
    const width = headers.length;
    const title = `${B.name}: ${kind === "policy" ? "policy" : "claims"} bordereau ${month}`;
    ws.getCell(1, 1).value = title;
    ws.mergeCells(1, 1, 1, width);
    // rows 3-4: two-row header. Grouped columns merge across; ungrouped merge down.
    for (let c = 0; c < width; c++) {
      const h = headers[c];
      if (h.group) {
        ws.getCell(4, c + 1).value = h.header;
        if (c === 0 || headers[c - 1].group !== h.group) {
          let end = c;
          while (end + 1 < width && headers[end + 1].group === h.group) end++;
          ws.getCell(3, c + 1).value = h.group;
          if (end > c) ws.mergeCells(3, c + 1, 3, end + 1);
        }
      } else {
        ws.getCell(3, c + 1).value = h.header;
        ws.mergeCells(3, c + 1, 4, c + 1);
      }
    }
    const first = 5;
    cells.forEach((r, i) => r.forEach((v, c) => v !== null && (ws.getCell(first + i, c + 1).value = v)));
    // blank row, then the insurer's own totals row
    const totalRow = first + cells.length + 1;
    ws.getCell(totalRow, 1).value = "Total";
    for (let c = 1; c < width; c++) {
      const vals = cells.map((r) => r[c]).filter((v): v is string => !!v && /^-?£[\d,]+\.\d\d$/.test(v));
      if (vals.length === cells.length && vals.length > 0) {
        const sum = vals.reduce((s, v) => s + Math.round(Number(v.replace(/[£,]/g, "")) * 100), 0);
        ws.getCell(totalRow, c + 1).value = sterling(sum);
      }
    }
    const notes = wb.addWorksheet("Notes");
    notes.getCell(1, 1).value = "Amounts in GBP. Dates are MM/DD/YYYY.";
    notes.getCell(2, 1).value = "Queries to bordereaux@brightwater.example";
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const parsed = headers.map((h) => (h.group ? `${h.group} ${h.header}` : h.header));
    return { buffer, ext: "xlsx", sourceRows: cells.map((_, i) => first + i), headers: parsed };
  },
};

// ---------------------------------------------------------------- insurer C: abbreviated CSV, Y/N flags, shifting columns

const C_MONTH2_CLAIM_RENAMES: Record<string, string> = { Pd: "Paid TD" };

function makeC(rng: Rng, months: string[]): InsurerLayout {
  // Column order changes from month to month; fix the permutations up front so they're reproducible.
  const orders = new Map<string, number[]>();
  const permute = <T>(key: string, cols: T[]) => {
    if (!orders.has(key)) orders.set(key, key.endsWith(months[0]) ? cols.map((_, i) => i) : rng.shuffle(cols.map((_, i) => i)));
    return orders.get(key)!.map((i) => cols[i]);
  };
  const layout: InsurerLayout = {
    id: "C",
    name: "Cobalt Travel Insurance",
    currency: "GBP",
    policyRef: (n) => `C${String(200000 + n)}`,
    claimRef: (n) => `CC-${1000 + n}`,
    allowReopen: false, // a Y/N closed flag can't express "reopened"
    columns: ((kind: FileKind, month: string) => {
      const d = (iso: unknown) => formatDate(String(iso), "DMY", true);
      const bad = () => impossibleDate("DMY", true);
      const amt = (v: unknown) => String(Number(v) / 100);
      const badAmt = () => typo("1200");
      const yn = (v: unknown) => (v ? "Y" : "N");
      if (kind === "policy") {
        return permute(`policy:${month}`, [
          col<GenPolicy>("Pol No", "policy_ref", "policy_ref", NONE, str),
          col<GenPolicy>("Name", "insured_name", "insured_name", NONE, str),
          col<GenPolicy>("Incep", "inception_date", "inception_date", date("DMY"), d, bad),
          col<GenPolicy>("Exp", "expiry_date", "expiry_date", date("DMY"), d, bad),
          col<GenPolicy>("Prod", "product", "product", NONE, str),
          col<GenPolicy>("Dest", "destination", "destination", NONE, str),
          col<GenPolicy>("SI", "sum_insured", "sum_insured", AMOUNT, amt, badAmt),
          col<GenPolicy>("GWP", "gross_premium", "gross_premium", AMOUNT, amt, badAmt),
          col<GenPolicy>("Ccy", "currency", "currency", CURRENCY, str),
          col<GenPolicy>("Agt", "agency", null, NONE, str),
          col<GenPolicy>("Chnl", "channel", null, NONE, str),
        ]);
      }
      const renames = month === months[0] ? {} : C_MONTH2_CLAIM_RENAMES;
      const h = (name: string) => renames[name] ?? name;
      return permute(`claim:${month}`, [
        col<GenClaim>(h("Clm No"), "claim_ref", "claim_ref", NONE, str),
        col<GenClaim>(h("Pol No"), "policy_ref", "policy_ref", NONE, str),
        col<GenClaim>(h("DOL"), "date_of_loss", "date_of_loss", date("DMY"), d, bad),
        col<GenClaim>(h("DON"), "date_notified", "date_notified", date("DMY"), d, bad),
        col<GenClaim>(h("Clsd"), "status", "status", { kind: "enum", values: { Y: "closed", N: "open" } }, (v) => (v === "closed" ? "Y" : "N")),
        col<GenClaim>(h("Cause"), "cause", "cause", NONE, str),
        col<GenClaim>(h("Pd Mth"), "paid_this_month", "paid_this_month", AMOUNT, amt, badAmt),
        col<GenClaim>(h("Pd"), "paid_to_date", "paid_to_date", AMOUNT, amt, badAmt),
        col<GenClaim>(h("Res Mvt"), "reserve_movement", "reserve_movement", AMOUNT, amt, badAmt),
        col<GenClaim>(h("O/S"), "outstanding_reserve", "outstanding_reserve", AMOUNT, amt, badAmt),
        col<GenClaim>(h("Ccy"), "currency", "currency", CURRENCY, str),
        col<GenClaim>(h("Lit"), "litigated", null, NONE, yn),
      ]);
    }) as InsurerLayout["columns"],
    write: (kind, month, headers, cells) =>
      writeCsv([`${layout.name} ${kind === "policy" ? "policy" : "claims"} extract`, `Period: ${month}`, ""], headers.map((h) => h.header), cells),
  };
  return layout;
}

export function makeLayouts(rng: Rng, months: string[]): InsurerLayout[] {
  return [A, B, makeC(rng, months)];
}

export function groundTruthMapping<T>(columns: Column<T>[], parsedHeaders: string[], defaultCurrency: string | null): Mapping {
  return {
    defaultCurrency,
    columns: columns.map((c, i) => ({ source: parsedHeaders[i], target: c.target, transform: c.target ? c.transform : NONE })),
  };
}
