import Papa from "papaparse";
import { RULES, type Rule } from "@/lib/issues";
import { hasSession } from "@/server/auth";
import { loadImport } from "@/server/imports";
import { getInsurer, importIssues } from "@/server/queries";

// Issues in a form the insurer can act on: one line per problem, pointing at their own row and column.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return new Response("Not signed in", { status: 401 });
  const id = Number((await params).id);
  const imp = await loadImport(id);
  const [insurer, issues] = await Promise.all([getInsurer(imp.insurerId), importIssues(id)]);
  const csv = Papa.unparse({
    fields: ["file", "row", "column", "rule", "severity", "problem"],
    data: issues.map((i) => [imp.filename, i.sourceRow, i.sourceColumn ?? "", RULES[i.rule as Rule]?.label ?? i.rule, i.severity, i.message]),
  });
  const name = `${insurer?.name ?? "insurer"}-${imp.fileKind}-${imp.reportingMonth}-issues.csv`.replace(/[^\w.\-]+/g, "_");
  return new Response(csv + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` },
  });
}
