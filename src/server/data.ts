// Reads loaded policies and claims back into canonical records.
import { and, asc, eq } from "drizzle-orm";
import type { ClaimRecord, PolicyRecord } from "@/lib/canonical";
import { db, schema } from "@/db";

const { policies, claims } = schema;

export async function policyMap(insurerId: number): Promise<Map<string, PolicyRecord>> {
  const rows = await db.select().from(policies).where(eq(policies.insurerId, insurerId));
  return new Map(
    rows.map((p) => [
      p.policyRef,
      {
        policy_ref: p.policyRef,
        insured_name: p.insuredName,
        inception_date: p.inceptionDate,
        expiry_date: p.expiryDate,
        product: p.product,
        destination: p.destination,
        sum_insured: p.sumInsured,
        gross_premium: p.grossPremium,
        currency: p.currency,
      },
    ]),
  );
}

export async function claimsFor(insurerId: number, month: string): Promise<ClaimRecord[]> {
  const rows = await db
    .select()
    .from(claims)
    .where(and(eq(claims.insurerId, insurerId), eq(claims.reportingMonth, month)))
    .orderBy(asc(claims.claimRef));
  return rows.map((c) => ({
    claim_ref: c.claimRef,
    policy_ref: c.policyRef,
    date_of_loss: c.dateOfLoss,
    date_notified: c.dateNotified,
    status: c.status,
    cause: c.cause,
    paid_this_month: c.paidThisMonth,
    paid_to_date: c.paidToDate,
    reserve_movement: c.reserveMovement,
    outstanding_reserve: c.outstandingReserve,
    currency: c.currency,
  }));
}

/** Months with loaded claims for an insurer, oldest first. */
export async function claimMonths(insurerId: number): Promise<string[]> {
  const rows = await db.selectDistinct({ m: claims.reportingMonth }).from(claims).where(eq(claims.insurerId, insurerId)).orderBy(asc(claims.reportingMonth));
  return rows.map((r) => r.m);
}
