import ExcelJS from "exceljs";
import Papa from "papaparse";

export type Cell = string | number | boolean | Date | null;
export type Grid = Cell[][];

export interface Sheet {
  name: string;
  grid: Grid;
}

export interface SourceRow {
  sourceRow: number; // 1-based row number in the original sheet/file
  cells: Cell[];
}

export interface Table {
  sheetName: string;
  headerRows: number[]; // 1-based rows that make up the header (two for merged headers)
  headers: string[];
  rows: SourceRow[];
  skipped: { sourceRow: number; reason: "blank" | "total" }[];
}

export async function readSheets(buf: Buffer, filename: string): Promise<Sheet[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) return readXlsx(buf);
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return [readCsv(buf.toString("utf8"))];
  throw new Error(`Unsupported file type: ${filename} (expected .csv or .xlsx)`);
}

export function readCsv(text: string): Sheet {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: false });
  const grid = result.data.map((r) => r.map((c) => (c === "" ? null : c)));
  // Papa yields a trailing [""] for a final newline; drop trailing empty rows.
  while (grid.length && grid[grid.length - 1].every((c) => c === null)) grid.pop();
  return { name: "csv", grid };
}

async function readXlsx(buf: Buffer): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheets: Sheet[] = [];
  wb.eachSheet((ws) => {
    const grid: Grid = [];
    const width = ws.columnCount;
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: Cell[] = [];
      // Merged cells report the master cell's value, so merged headers come back filled.
      for (let c = 1; c <= width; c++) cells.push(normalizeExcelValue(row.getCell(c).value));
      grid.push(cells);
    }
    sheets.push({ name: ws.name, grid });
  });
  return sheets;
}

function normalizeExcelValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" || typeof v === "boolean" || v instanceof Date) return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return normalizeExcelValue(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
    if ("error" in v) return null;
  }
  return String(v);
}

export function cellText(c: Cell): string {
  if (c === null) return "";
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c).trim();
}

const isTextCell = (c: Cell) => typeof c === "string" && c.trim() !== "" && !/^[-+£$€]?[\d,.\s]+%?$/.test(c.trim());
const nonEmpty = (row: Cell[]) => row.filter((c) => cellText(c) !== "").length;
const TOTAL_RE = /^(grand\s+|sub)?totals?:?$/i;
const distinct = (row: Cell[]) => new Set(row.map(cellText).filter(Boolean)).size;

/** Finds the header row(s) and data rows of the densest table in a sheet. */
export function detectTable(sheet: Sheet): Table {
  const grid = sheet.grid;
  const scan = grid.slice(0, 30);
  const maxWidth = Math.max(0, ...scan.map(nonEmpty));
  const threshold = Math.max(2, Math.ceil(maxWidth * 0.5));

  let h = scan.findIndex((row) => {
    const n = nonEmpty(row);
    // A title merged across the sheet fills every cell with one value, so demand distinct labels.
    return n >= threshold && distinct(row) >= 2 && row.every((c) => cellText(c) === "" || isTextCell(c));
  });
  if (h < 0) throw new Error(`No header row found in sheet "${sheet.name}"`);

  let headerIdx = [h];
  const hasAdjacentDupes = (row: Cell[]) =>
    row.some((c, i) => i > 0 && cellText(c) !== "" && cellText(c) === cellText(row[i - 1]));
  const allText = (row: Cell[] | undefined) =>
    !!row && nonEmpty(row) >= threshold && row.every((c) => cellText(c) === "" || isTextCell(c));

  if (hasAdjacentDupes(grid[h]) && allText(grid[h + 1])) {
    // Merged group row (values filled across the merge) with the real header below it.
    headerIdx = [h, h + 1];
  } else if (allText(grid[h + 1]) && nonEmpty(grid[h]) * 1.5 <= nonEmpty(grid[h + 1])) {
    // Sparse group row that happened to clear the density threshold (few columns); the
    // margin keeps a header with a single blank column from being mistaken for one.
    headerIdx = [h, h + 1];
  } else if (h > 0) {
    // Sparse group row above the header (e.g. CSV export of a two-row header).
    const above = grid[h - 1];
    if (distinct(above) >= 2 && above.every((c) => cellText(c) === "" || isTextCell(c))) headerIdx = [h - 1, h];
  }

  const last = headerIdx[headerIdx.length - 1];
  const width = Math.max(...grid.slice(last).map((r) => lastNonEmptyIndex(r) + 1));
  let headers: string[];
  if (headerIdx.length === 2) {
    const group = forwardFill(grid[headerIdx[0]].slice(0, width).map(cellText));
    const sub = grid[headerIdx[1]].slice(0, width).map(cellText);
    headers = sub.map((s, i) => {
      const g = group[i] ?? "";
      if (!g || g === s) return s || g;
      if (!s) return g;
      return `${g} ${s}`;
    });
  } else {
    headers = grid[h].slice(0, width).map(cellText);
  }
  headers = dedupeHeaders(headers.map((x, i) => x || `Column ${i + 1}`));

  const rows: SourceRow[] = [];
  const skipped: Table["skipped"] = [];
  for (let r = last + 1; r < grid.length; r++) {
    const cells = Array.from({ length: width }, (_, i) => grid[r][i] ?? null);
    if (nonEmpty(cells) === 0) {
      skipped.push({ sourceRow: r + 1, reason: "blank" });
    } else if (TOTAL_RE.test(cellText(cells.find((c) => cellText(c) !== "") ?? null))) {
      skipped.push({ sourceRow: r + 1, reason: "total" });
    } else {
      rows.push({ sourceRow: r + 1, cells });
    }
  }
  return { sheetName: sheet.name, headerRows: headerIdx.map((i) => i + 1), headers, rows, skipped };
}

/** Picks the sheet whose detected table has the most data rows. */
export function detectBestTable(sheets: Sheet[]): Table {
  let best: Table | null = null;
  let lastErr: unknown;
  for (const s of sheets) {
    try {
      const t = detectTable(s);
      if (!best || t.rows.length > best.rows.length) best = t;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!best) throw lastErr instanceof Error ? lastErr : new Error("No table found");
  return best;
}

export async function parseFile(buf: Buffer, filename: string): Promise<Table> {
  return detectBestTable(await readSheets(buf, filename));
}

function lastNonEmptyIndex(row: Cell[]): number {
  for (let i = row.length - 1; i >= 0; i--) if (cellText(row[i]) !== "") return i;
  return -1;
}

function forwardFill(xs: string[]): string[] {
  let prev = "";
  return xs.map((x) => (x ? (prev = x) : prev));
}

function dedupeHeaders(hs: string[]): string[] {
  const seen = new Map<string, number>();
  return hs.map((h) => {
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n === 0 ? h : `${h} (${n + 1})`;
  });
}

export function columnLetter(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
