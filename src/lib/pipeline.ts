// The pure core of an import: mapped table in, rows to load and issues out. No I/O, so tests
// and the import service run exactly the same code.
import type { ClaimRecord, PolicyRecord } from "./canonical";
import type { Issue } from "./issues";
import { applyMapping, type Mapping, type MappedRow } from "./mapping";
import type { Table } from "./parse";
import { partition, validateClaims, validatePolicies, type ClaimContext, type PolicyContext } from "./validate";

export interface PipelineResult<T> {
  rows: MappedRow<T>[];
  load: MappedRow<T>[];
  quarantined: MappedRow<T>[];
  issues: Issue[];
}

const bySourcePosition = (a: Issue, b: Issue) => a.sourceRow - b.sourceRow || (a.sourceColumn ?? "").localeCompare(b.sourceColumn ?? "");

export function runPolicyPipeline(table: Table, mapping: Mapping, ctx: PolicyContext): PipelineResult<PolicyRecord> {
  const { rows, issues: parseIssues } = applyMapping(table, mapping, "policy");
  const issues = [...parseIssues, ...validatePolicies(rows, ctx)].sort(bySourcePosition);
  return { rows, issues, ...partition(rows, issues) };
}

export function runClaimPipeline(table: Table, mapping: Mapping, ctx: ClaimContext): PipelineResult<ClaimRecord> {
  const { rows, issues: parseIssues } = applyMapping(table, mapping, "claim");
  const issues = [...parseIssues, ...validateClaims(rows, ctx)].sort(bySourcePosition);
  return { rows, issues, ...partition(rows, issues) };
}
