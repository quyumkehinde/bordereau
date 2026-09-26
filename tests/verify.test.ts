// verify must pass on clean data, catch the planted movement break exactly, and pass on the resend.
import { describe, expect, it } from "vitest";
import type { ClaimRecord, PolicyRecord } from "@/lib/canonical";
import { monthEnd } from "@/lib/dates";
import { runClaimPipeline, runPolicyPipeline } from "@/lib/pipeline";
import { buildClaimsReport, reportToCsv } from "@/lib/report";
import { checkReportTotals, runChecks, type VerifyInput } from "@/lib/verify";
import { manifest, parsePath } from "./helpers";

/** Loads an insurer's months through the real pipeline, optionally swapping in a resend. */
async function load(insurer: string, useCorrected: boolean) {
  const policies = new Map<string, PolicyRecord>();
  const claimsByMonth = new Map<string, ClaimRecord[]>();
  for (const month of manifest.months) {
    const pf = manifest.files.find((f) => f.insurer === insurer && f.month === month && f.kind === "policy")!;
    const pr = runPolicyPipeline(await parsePath(pf.path), pf.mapping, { existingRefs: new Set(policies.keys()) });
    for (const r of pr.load) policies.set(r.record.policy_ref!, r.record);
    const cf = manifest.files.find((f) => f.insurer === insurer && f.month === month && f.kind === "claim")!;
    const path = useCorrected && cf.correctedPath ? cf.correctedPath : cf.path;
    const cr = runClaimPipeline(await parsePath(path), cf.mapping, { policies, asOf: monthEnd(month) });
    claimsByMonth.set(month, cr.load.map((r) => r.record));
  }
  return { policies, claimsByMonth };
}

function inputFor(month: string, data: Awaited<ReturnType<typeof load>>): VerifyInput {
  const i = manifest.months.indexOf(month);
  const claims = data.claimsByMonth.get(month)!;
  return {
    month,
    claims,
    previous: i > 0 ? data.claimsByMonth.get(manifest.months[i - 1])! : null,
    policies: data.policies,
    reportCsv: reportToCsv(buildClaimsReport(month, claims, data.policies)),
  };
}

const failures = (input: VerifyInput) => runChecks(input).filter((r) => r.status === "fail");

describe.each(manifest.insurers.map((i) => i.id))("insurer %s", (insurer) => {
  const breaks = manifest.movementBreaks.filter((b) => b.insurer === insurer);

  it.each(manifest.months)("%s passes verify once the insurer's resend is loaded", async (month) => {
    const data = await load(insurer, true);
    expect(failures(inputFor(month, data))).toEqual([]);
  });

  it.runIf(breaks.length > 0)("fails verify on the planted movement break, and only there", async () => {
    const data = await load(insurer, false);
    for (const b of breaks) {
      const failed = failures(inputFor(b.month, data));
      expect(failed.map((f) => f.name).sort()).toEqual(["Movement reconciles in total", "Movement reconciles per claim"]);
      const perClaim = failed.find((f) => f.name === "Movement reconciles per claim")!;
      expect(perClaim.diffs).toHaveLength(1);
      expect(perClaim.diffs[0]).toContain(b.claimRef);
      const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2 });
      expect(perClaim.diffs[0]).toContain(`= ${fmt(b.expectedOutstanding)}, reported ${fmt(b.reportedOutstanding)}`);
    }
  });
});

it("report totals check catches a tampered totals row", async () => {
  const data = await load("A", true);
  const input = inputFor(manifest.months[1], data);
  const lines = input.reportCsv.trimEnd().split("\n");
  const cells = lines[lines.length - 1].split(",");
  cells[cells.length - 1] = (Number(cells[cells.length - 1]) + 1).toFixed(2);
  lines[lines.length - 1] = cells.join(",");
  const r = checkReportTotals({ ...input, reportCsv: lines.join("\n") + "\n" });
  expect(r.status).toBe("fail");
  expect(r.diffs[0]).toMatch(/Total Incurred - Indemnity: totals row/);
});
