// Generates 3 synthetic insurers x 2 months of policy and claims bordereaux from the Kaggle base,
// each messy in its own way, plus data/generated/manifest.json listing every planted error.
//
//   npm run generate            (expects data/raw/travel_insurance.csv)
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FileKind } from "../src/lib/canonical";
import { RULES } from "../src/lib/issues";
import type { Manifest, ManifestFile, MovementBreak, PlantedIssue } from "../src/lib/manifest";
import { loadBase, type BasePolicy } from "./gen/base";
import { groundTruthMapping, makeLayouts, type ClaimRow, type Column, type InsurerLayout, type PolicyRow, type Row } from "./gen/layouts";
import { plantClaim, plantPolicy, type PlantContext } from "./gen/plants";
import { buildPortfolio, type GenClaim, type GenPolicy, type Portfolio } from "./gen/portfolio";
import { Rng } from "./gen/rng";

const SEED = 20260926;
const MONTHS = ["2026-07", "2026-08"];
const BASE_PATH = "data/raw/travel_insurance.csv";
const OUT = "data/generated";

// Each insurer's book is drawn from different agencies in the base data, so products and claim rates differ.
const AGENCIES: Record<string, (agency: string) => boolean> = {
  A: (a) => a === "EPX",
  B: (a) => a === "C2B" || a === "SSI",
  C: (a) => !["EPX", "C2B", "SSI"].includes(a),
};

type PlantFn<R> = (ctx: PlantContext, rows: R[]) => void;

/** Which errors go where. Month keys are indexes into MONTHS. */
const PLAN: Record<string, { policy: PlantFn<PolicyRow>[][]; claim: PlantFn<ClaimRow>[][] }> = {
  A: {
    policy: [
      [plantPolicy.duplicate, plantPolicy.missingRef, plantPolicy.badDate],
      [(ctx, rows) => plantPolicy.duplicateFromEarlierMonth(ctx, rows, MONTHS[0])],
    ],
    claim: [
      [plantClaim.orphan, plantClaim.lossBeforeCover, plantClaim.duplicate, plantClaim.paidOverSumInsured],
      [plantClaim.missingClaimRef, plantClaim.futureLoss],
    ],
  },
  B: {
    policy: [
      [plantPolicy.duplicate, plantPolicy.missingRef],
      [plantPolicy.duplicate, plantPolicy.badAmount],
    ],
    claim: [
      [plantClaim.orphan, plantClaim.lossBeforeCover, plantClaim.duplicate, plantClaim.paidOverSumInsured, plantClaim.negativeReserve],
      [plantClaim.missingPolicyRef, plantClaim.orphan],
    ],
  },
  C: {
    policy: [
      [plantPolicy.duplicate, plantPolicy.missingRef, plantPolicy.expiryBeforeInception],
      [(ctx, rows) => plantPolicy.duplicateFromEarlierMonth(ctx, rows, MONTHS[0])],
    ],
    claim: [
      [plantClaim.orphan, plantClaim.lossBeforeCover, plantClaim.duplicate, plantClaim.paidOverSumInsured, plantClaim.notifiedBeforeLoss],
      [plantClaim.missingClaimRef, plantClaim.duplicate, plantClaim.currencyMismatch],
    ],
  },
};

/** Insurer C's month-2 claims file carries one claim whose outstanding doesn't reconcile. */
const MOVEMENT_BREAK = { insurer: "C", month: MONTHS[1], errorPence: 25_000 };

async function main() {
  const rng = new Rng(SEED);
  const { rows: base, total } = loadBase(BASE_PATH);
  const layouts = makeLayouts(rng, MONTHS);

  rmSync(OUT, { recursive: true, force: true });
  const manifest: Manifest = {
    seed: SEED,
    base: { source: "kaggle:mhdzahier/travel-insurance", rows: total },
    months: MONTHS,
    insurers: layouts.map((l) => ({ id: l.id, name: l.name })),
    files: [],
    planted: [],
    movementBreaks: [],
  };

  for (const layout of layouts) {
    const book = base.filter((b: BasePolicy) => AGENCIES[layout.id](b.agency));
    const portfolio = buildPortfolio(rng, book, MONTHS, {
      currency: layout.currency,
      policiesPerMonth: 150,
      newClaimsPerMonth: 14,
      allowReopen: layout.allowReopen,
      policyRef: layout.policyRef,
      claimRef: layout.claimRef,
    });

    for (const [mi, month] of MONTHS.entries()) {
      const ctx: PlantContext = {
        rng,
        month,
        portfolio,
        inForce: MONTHS.slice(0, mi + 1).flatMap((m) => portfolio.policies[m]),
        policyRef: layout.policyRef,
        claimRef: layout.claimRef,
      };

      const policyRows: PolicyRow[] = portfolio.policies[month].map((v) => ({ v, plants: [] }));
      for (const plant of PLAN[layout.id].policy[mi]) plant(ctx, policyRows);
      await emit(manifest, layout, "policy", month, layout.columns("policy", month), policyRows);

      const claimRows: ClaimRow[] = portfolio.claims[month].map((v) => ({ v, plants: [] }));
      for (const plant of PLAN[layout.id].claim[mi]) plant(ctx, claimRows);
      const brk = layout.id === MOVEMENT_BREAK.insurer && month === MOVEMENT_BREAK.month
        ? breakMovement(rng, portfolio, month, claimRows)
        : undefined;
      await emit(manifest, layout, "claim", month, layout.columns("claim", month), claimRows, brk);
    }
  }

  writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const byRule = new Map<string, number>();
  for (const p of manifest.planted) byRule.set(p.rule, (byRule.get(p.rule) ?? 0) + 1);
  console.log(`Wrote ${manifest.files.length} files to ${OUT}/ from ${base.length} usable base rows.`);
  console.log(`Planted ${manifest.planted.length} issues:`, Object.fromEntries(byRule));
  console.log(`Planted ${manifest.movementBreaks.length} movement break(s).`);
}

interface BreakPlan {
  claimRef: string;
  rowIndex: number;
  expected: number;
  reported: number;
}

function breakMovement(rng: Rng, portfolio: Portfolio, month: string, rows: ClaimRow[]): BreakPlan {
  const prevRefs = new Set(portfolio.claims[MONTHS[MONTHS.indexOf(month) - 1]].map((c) => c.claim_ref));
  const candidates = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.plants.length === 0 && prevRefs.has(r.v.claim_ref!) && (r.v.outstanding_reserve ?? 0) > 0);
  // Don't break a claim that a planted duplicate also points at; keep the break the only thing wrong with it.
  const duplicated = new Set(rows.filter((r) => r.plants.some((p) => p.rule === "duplicate_claim_ref")).map((r) => r.v.claim_ref));
  const { r, i } = rng.pick(candidates.filter(({ r }) => !duplicated.has(r.v.claim_ref)));
  const expected = r.v.outstanding_reserve!;
  return { claimRef: r.v.claim_ref!, rowIndex: i, expected, reported: expected + MOVEMENT_BREAK.errorPence };
}

async function emit<T extends GenPolicy | GenClaim>(
  manifest: Manifest,
  layout: InsurerLayout,
  kind: FileKind,
  month: string,
  columns: Column<T>[],
  rows: Row<T>[],
  brk?: BreakPlan,
) {
  const render = (rs: Row<T>[]) => rs.map((r) => columns.map((c) => c.render(r)));
  const dir = path.join(OUT, layout.id);
  mkdirSync(dir, { recursive: true });
  const stem = `${kind === "policy" ? "policies" : "claims"}_${month}`;
  const headerSpec = columns.map((c) => ({ header: c.header, group: c.group }));

  const correct = await layout.write(kind, month, headerSpec, render(rows));
  let file: ManifestFile;

  if (brk) {
    const brokenRows = rows.map((r, i) => (i === brk.rowIndex ? { ...r, v: { ...r.v, outstanding_reserve: brk.reported } } : r));
    const broken = await layout.write(kind, month, headerSpec, render(brokenRows as Row<T>[]));
    const p = path.join(dir, `${stem}.${broken.ext}`);
    const cp = path.join(dir, `${stem}.corrected.${correct.ext}`);
    writeFileSync(p, broken.buffer);
    writeFileSync(cp, correct.buffer);
    file = { insurer: layout.id, kind, month, path: p, correctedPath: cp, mapping: groundTruthMapping(columns, correct.headers, "GBP") };
    const mb: MovementBreak = {
      insurer: layout.id,
      month,
      path: p,
      correctedPath: cp,
      claimRef: brk.claimRef,
      expectedOutstanding: brk.expected / 100,
      reportedOutstanding: brk.reported / 100,
    };
    manifest.movementBreaks.push(mb);
  } else {
    const p = path.join(dir, `${stem}.${correct.ext}`);
    writeFileSync(p, correct.buffer);
    file = { insurer: layout.id, kind, month, path: p, mapping: groundTruthMapping(columns, correct.headers, "GBP") };
  }
  manifest.files.push(file);

  rows.forEach((r, i) => {
    for (const plant of r.plants) {
      const ci = plant.field === null ? -1 : columns.findIndex((c) => c.target === plant.field);
      if (plant.field !== null && ci < 0) throw new Error(`${layout.id} ${kind}: no column for ${plant.field}`);
      const issue: PlantedIssue = {
        insurer: layout.id,
        kind,
        month,
        path: file.path,
        rule: plant.rule,
        severity: RULES[plant.rule].severity,
        sourceRow: correct.sourceRows[i],
        sourceColumn: ci < 0 ? null : correct.headers[ci],
        note: plant.note,
      };
      manifest.planted.push(issue);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
