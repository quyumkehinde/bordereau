// verify: independent correctness checks over what was loaded and what was reported.
// Pure functions; the CLI (npm run verify) and the UI both call runChecks.
import type { ClaimRecord, PolicyRecord } from "./canonical";
import { CRS_TOTAL_CHECKS } from "./crs-fields";
import { fromPence, parseReportCsv, toPence } from "./report";

export interface CheckResult {
  name: string;
  status: "pass" | "fail" | "skipped";
  summary: string;
  /** one readable line per mismatch */
  diffs: string[];
}

export interface VerifyInput {
  month: string;
  claims: ClaimRecord[];
  /** last month's loaded claims; null when this is the first month on file */
  previous: ClaimRecord[] | null;
  policies: Map<string, PolicyRecord>;
  /** the exported claims bordereau CSV, exactly as written */
  reportCsv: string;
}

const p = (n: number | null | undefined) => toPence(n ?? 0);
const money = (pence: number) => fromPence(pence).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (pence: number) => (pence >= 0 ? `+${money(pence)}` : `-${money(-pence)}`);

function result(name: string, diffs: string[], passSummary: string, failNoun: string): CheckResult {
  return diffs.length === 0
    ? { name, status: "pass", summary: passSummary, diffs }
    : { name, status: "fail", summary: `${diffs.length} ${failNoun}${diffs.length === 1 ? "" : "es"}`, diffs };
}

export function checkClaimsTieToPolicies(input: VerifyInput): CheckResult {
  const diffs: string[] = [];
  for (const c of input.claims) {
    const pol = input.policies.get(c.policy_ref ?? "");
    if (!pol) diffs.push(`${c.claim_ref}: policy ${c.policy_ref} not on file`);
    else if (c.date_of_loss && pol.inception_date && pol.expiry_date && (c.date_of_loss < pol.inception_date || c.date_of_loss > pol.expiry_date)) {
      diffs.push(`${c.claim_ref}: loss ${c.date_of_loss} outside ${c.policy_ref} cover ${pol.inception_date} to ${pol.expiry_date}`);
    }
  }
  return result("Every claim ties to a live policy", diffs, `${input.claims.length} claims tie to policies in force`, "mismatch");
}

export function checkMovementPerClaim(input: VerifyInput): CheckResult[] {
  const name = "Movement reconciles per claim";
  if (!input.previous) {
    return [{ name, status: "skipped", summary: "First month on file: opening balances are taken from this bordereau", diffs: [] }];
  }
  const prev = new Map(input.previous.map((c) => [c.claim_ref, c]));
  const current = new Set(input.claims.map((c) => c.claim_ref));
  const os: string[] = [];
  const paid: string[] = [];
  for (const c of input.claims) {
    const before = prev.get(c.claim_ref);
    const openingOs = p(before?.outstanding_reserve);
    const expectedOs = openingOs + p(c.reserve_movement) - p(c.paid_this_month);
    if (expectedOs !== p(c.outstanding_reserve)) {
      os.push(
        `${c.claim_ref}: last month ${money(openingOs)} + movement ${money(p(c.reserve_movement))} - paid ${money(p(c.paid_this_month))}` +
          ` = ${money(expectedOs)}, reported ${money(p(c.outstanding_reserve))} (${signed(p(c.outstanding_reserve) - expectedOs)})`,
      );
    }
    const expectedPaid = p(before?.paid_to_date) + p(c.paid_this_month);
    if (expectedPaid !== p(c.paid_to_date)) {
      paid.push(`${c.claim_ref}: paid to date ${money(p(before?.paid_to_date))} + ${money(p(c.paid_this_month))} = ${money(expectedPaid)}, reported ${money(p(c.paid_to_date))}`);
    }
  }
  const dropped = input.previous
    .filter((c) => p(c.outstanding_reserve) !== 0 && !current.has(c.claim_ref))
    .map((c) => `${c.claim_ref}: open last month with ${money(p(c.outstanding_reserve))} outstanding, missing this month`);
  return [
    result(name, os, `${input.claims.length} claims: last month + movement - paid = this month`, "mismatch"),
    result("Paid to date reconciles per claim", paid, "last month's paid to date + paid this month = paid to date", "mismatch"),
    result("No open claims dropped", dropped, "every claim open last month is reported this month", "mismatch"),
  ];
}

export function checkMovementTotal(input: VerifyInput): CheckResult {
  const name = "Movement reconciles in total";
  if (!input.previous) return { name, status: "skipped", summary: "First month on file", diffs: [] };
  const sum = (xs: ClaimRecord[], f: (c: ClaimRecord) => number | null) => xs.reduce((s, c) => s + p(f(c)), 0);
  const opening = sum(input.previous, (c) => c.outstanding_reserve);
  const movement = sum(input.claims, (c) => c.reserve_movement);
  const paid = sum(input.claims, (c) => c.paid_this_month);
  const closing = sum(input.claims, (c) => c.outstanding_reserve);
  const expected = opening + movement - paid;
  const line = `opening ${money(opening)} + movement ${money(movement)} - paid ${money(paid)} = ${money(expected)}, reported ${money(closing)}`;
  return expected === closing
    ? { name, status: "pass", summary: line, diffs: [] }
    : { name, status: "fail", summary: `off by ${signed(closing - expected)}`, diffs: [line] };
}

export function checkReportTotals(input: VerifyInput): CheckResult {
  const { header, rows, totals } = parseReportCsv(input.reportCsv);
  const diffs: string[] = [];
  if (rows.length !== input.claims.length) diffs.push(`report has ${rows.length} rows, ${input.claims.length} claims are loaded`);
  if (!totals) diffs.push("report has no totals row");
  const loaded = {
    paidThisMonth: input.claims.reduce((s, c) => s + p(c.paid_this_month), 0),
    outstanding: input.claims.reduce((s, c) => s + p(c.outstanding_reserve), 0),
    incurred: input.claims.reduce((s, c) => s + p(c.paid_to_date) + p(c.outstanding_reserve), 0),
  };
  for (const [key, column] of Object.entries(CRS_TOTAL_CHECKS) as [keyof typeof loaded, string][]) {
    const i = header.indexOf(column);
    if (i < 0) {
      diffs.push(`report is missing column "${column}"`);
      continue;
    }
    const rowSum = rows.reduce((s, r) => s + toPence(Number(r[i] || 0)), 0);
    const stated = totals ? toPence(Number(totals[i] || 0)) : NaN;
    if (rowSum !== stated) diffs.push(`${column}: totals row ${money(stated)}, rows sum to ${money(rowSum)}`);
    if (rowSum !== loaded[key]) diffs.push(`${column}: report rows sum to ${money(rowSum)}, loaded claims sum to ${money(loaded[key])}`);
  }
  return result("Report totals equal the underlying rows", diffs, "paid, outstanding and incurred totals match rows and loaded claims", "mismatch");
}

export function runChecks(input: VerifyInput): CheckResult[] {
  return [checkClaimsTieToPolicies(input), ...checkMovementPerClaim(input), checkMovementTotal(input), checkReportTotals(input)];
}

export function formatResults(title: string, results: CheckResult[]): string {
  const icon = { pass: "✓", fail: "✗", skipped: "–" } as const;
  const lines = [title];
  for (const r of results) {
    lines.push(`  ${icon[r.status]} ${r.name}: ${r.summary}`);
    for (const d of r.diffs.slice(0, 20)) lines.push(`      ${d}`);
    if (r.diffs.length > 20) lines.push(`      ... and ${r.diffs.length - 20} more`);
  }
  return lines.join("\n");
}
