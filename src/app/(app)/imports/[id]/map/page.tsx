import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { KIND_LABEL } from "@/components/badges";
import { fieldsFor } from "@/lib/canonical";
import { formatMonth } from "@/lib/format";
import { cellText } from "@/lib/parse";
import { SUGGEST_MODEL } from "@/lib/suggest";
import { loadImport, loadTable, mappingDraft, UserError } from "@/server/imports";
import { getInsurer } from "@/server/queries";
import { MappingReview, type ColumnInfo } from "./mapping-review";

export const dynamic = "force-dynamic";

export default async function MapPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const imp = await loadImport(id).catch((e) => (e instanceof UserError ? null : Promise.reject(e)));
  if (!imp) notFound();
  if (imp.status !== "needs_mapping") redirect(`/imports/${id}`);

  const [insurer, table, draft] = await Promise.all([getInsurer(imp.insurerId), loadTable(imp.storagePath, imp.filename), mappingDraft(id)]);

  const columns: ColumnInfo[] = table.headers.map((h, i) => {
    const values = table.rows.map((r) => cellText(r.cells[i])).filter(Boolean);
    const distinct = [...new Set(values)];
    return { header: h, samples: distinct.slice(0, 4), distinct: distinct.length <= 12 ? distinct : [] };
  });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            <Link href="/">Insurers</Link> / <Link href={`/insurers/${imp.insurerId}`}>{insurer?.name}</Link> /
          </div>
          <h1>Review mapping</h1>
          <p className="sub">
            {imp.filename} · {KIND_LABEL[imp.fileKind]} bordereau for {formatMonth(imp.reportingMonth)} · {table.rows.length} rows, header on row {table.headerRows.join("–")}
            {table.sheetName !== "csv" && <> of sheet “{table.sheetName}”</>}
          </p>
        </div>
      </div>
      {draft.warning && <div className="alert error" style={{ marginBottom: 16 }}>{draft.warning}</div>}
      {draft.carriedFrom ? (
        <div className="alert warning" style={{ marginBottom: 16 }}>
          This file&apos;s layout differs from mapping v{draft.carriedFrom.version}.{" "}
          {draft.toReview.length > 0 ? <>Only the {draft.toReview.length === 1 ? "new column needs" : `${draft.toReview.length} new columns need`} a decision; everything else carries over.</> : "No new columns; confirm to save the new layout."}
          {draft.removed.length > 0 && <> No longer present: {draft.removed.map((h) => <code key={h}> {h}</code>)}.</>}
        </div>
      ) : (
        <div className="alert info" style={{ marginBottom: 16 }}>
          {draft.source === "claude" ? <>Proposed by Claude (<code>{SUGGEST_MODEL}</code>) from the headers and {Math.min(20, table.rows.length)} sample rows.</> : <>Proposed by header matching (no <code>ANTHROPIC_API_KEY</code> set).</>}{" "}
          Every proposal was also checked against the sample values. Accept, change or ignore each column, then approve.
        </div>
      )}
      <MappingReview importId={id} kind={imp.fileKind} fields={fieldsFor(imp.fileKind)} columns={columns} initial={draft.mapping} toReview={draft.toReview} carriedVersion={draft.carriedFrom?.version ?? null} />
    </>
  );
}
