// The test oracle: running each generated file through the real pipeline must report exactly the
// planted issues from the manifest. Missing one is a miss; anything extra is a false positive.
import { describe, expect, it } from "vitest";
import type { PolicyRecord } from "@/lib/canonical";
import { monthEnd } from "@/lib/dates";
import { runClaimPipeline, runPolicyPipeline } from "@/lib/pipeline";
import { manifest, parsePath } from "./helpers";

const key = (i: { rule: string; sourceRow: number; sourceColumn: string | null }) => `${i.rule} @ row ${i.sourceRow} [${i.sourceColumn}]`;

describe.each(manifest.insurers.map((i) => i.id))("insurer %s", (insurer) => {
  it("reports exactly the planted issues, file by file, month by month", async () => {
    const policies = new Map<string, PolicyRecord>();
    for (const month of manifest.months) {
      for (const kind of ["policy", "claim"] as const) {
        const file = manifest.files.find((f) => f.insurer === insurer && f.month === month && f.kind === kind)!;
        const table = await parsePath(file.path);
        expect(table.headers.map((h) => h.toLowerCase()).sort()).toEqual(file.mapping.columns.map((c) => c.source.toLowerCase()).sort());

        const result =
          kind === "policy"
            ? runPolicyPipeline(table, file.mapping, { existingRefs: new Set(policies.keys()) })
            : runClaimPipeline(table, file.mapping, { policies, asOf: monthEnd(month) });
        if (kind === "policy") for (const r of result.load) policies.set((r.record as PolicyRecord).policy_ref!, r.record as PolicyRecord);

        const expected = manifest.planted.filter((p) => p.path === file.path).map(key).sort();
        const actual = result.issues.map(key).sort();
        expect(actual, file.path).toEqual(expected);
      }
    }
  });
});

it("the manifest covers every validation rule a travel bordereau can trip", () => {
  const rules = new Set(manifest.planted.map((p) => p.rule));
  for (const r of ["missing_required", "duplicate_policy_ref", "duplicate_claim_ref", "orphan_claim", "loss_outside_cover", "paid_exceeds_sum_insured"]) {
    expect(rules).toContain(r);
  }
});
