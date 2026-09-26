import { previousMonth } from "@/lib/dates";
import { buildClaimsReport, reportToCsv, type ClaimsReport } from "@/lib/report";
import { runChecks, type CheckResult } from "@/lib/verify";
import { claimMonths, claimsFor, policyMap } from "./data";

export async function claimsReport(insurerId: number, month: string): Promise<ClaimsReport> {
  const [claims, policies] = await Promise.all([claimsFor(insurerId, month), policyMap(insurerId)]);
  return buildClaimsReport(month, claims, policies);
}

export async function verifyMonth(insurerId: number, month: string): Promise<CheckResult[]> {
  const prev = previousMonth(month);
  const months = await claimMonths(insurerId);
  const [claims, previous, policies] = await Promise.all([
    claimsFor(insurerId, month),
    months.includes(prev) ? claimsFor(insurerId, prev) : Promise.resolve(null),
    policyMap(insurerId),
  ]);
  // Verify what is actually exported, not an in-memory copy of it.
  const reportCsv = reportToCsv(buildClaimsReport(month, claims, policies));
  return runChecks({ month, claims, previous, policies, reportCsv });
}
