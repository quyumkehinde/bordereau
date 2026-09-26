import Link from "next/link";
import { notFound } from "next/navigation";
import { CRS_FIELDS_CONFIRMED, CRS_VERSION } from "@/lib/crs-fields";
import { isMonth } from "@/lib/dates";
import { formatMoney, formatMonth } from "@/lib/format";
import { claimsReport, verifyMonth } from "@/server/reporting";
import { getInsurer } from "@/server/queries";

export const dynamic = "force-dynamic";

const ICON = { pass: "✓", fail: "✗", skipped: "–" } as const;

export default async function MonthPage({ params }: { params: Promise<{ id: string; month: string }> }) {
  const { id: idParam, month } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || !isMonth(month)) notFound();
  const insurer = await getInsurer(id);
  if (!insurer) notFound();
  const [report, checks] = await Promise.all([claimsReport(id, month), verifyMonth(id, month)]);
  const failed = checks.filter((c) => c.status === "fail").length;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            <Link href="/">Insurers</Link> / <Link href={`/insurers/${id}`}>{insurer.name}</Link> /
          </div>
          <h1>Claims bordereau, {formatMonth(month)}</h1>
          <p className="sub">Lloyd&apos;s CRS v{CRS_VERSION} layout, travel / A&amp;H subset · {report.rows.length} claims</p>
        </div>
        <div className="row">
          <a className="btn" href={`/insurers/${id}/months/${month}/report?format=csv`}>Download CSV</a>
          <a className="btn primary" href={`/insurers/${id}/months/${month}/report?format=xlsx`}>Download XLSX</a>
        </div>
      </div>

      {!CRS_FIELDS_CONFIRMED && (
        <div className="alert warning" style={{ marginBottom: 16 }}>Field names are provisional until checked against the London Market Group glossary export.</div>
      )}

      <div className="card flush">
        <div className="row" style={{ padding: "14px 16px 10px" }}>
          <h2 style={{ margin: 0 }}>Verify</h2>
          <span className={`badge ${failed ? "error" : "ok"}`}>{failed ? `${failed} check${failed === 1 ? "" : "s"} failed` : "All checks pass"}</span>
          <span className="spacer" />
          <span className="faint" style={{ fontSize: 12.5 }}>Same checks as <code>npm run verify</code></span>
        </div>
        {checks.map((c) => (
          <div key={c.name} className={`check ${c.status}`}>
            <span className="icon">{ICON[c.status]}</span>
            <div><strong>{c.name}</strong> <span className="muted">· {c.summary}</span></div>
            {c.diffs.length > 0 && <pre>{c.diffs.join("\n")}</pre>}
          </div>
        ))}
      </div>

      <div className="card flush scroll-x" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>{report.columns.map((c) => <th key={c.name} className={c.kind === "money" ? "num" : undefined}>{c.name}</th>)}</tr>
          </thead>
          <tbody>
            {report.rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j} className={report.columns[j].kind === "money" ? "num" : undefined} style={{ whiteSpace: "nowrap" }}>
                    {report.columns[j].kind === "money" ? formatMoney(Number(v)) : v ?? ""}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="total">
              {report.columns.map((c, j) => (
                <td key={c.name} className={c.kind === "money" ? "num" : undefined}>{j === 0 ? "Total" : c.kind === "money" ? formatMoney(report.totals[c.name]) : ""}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
