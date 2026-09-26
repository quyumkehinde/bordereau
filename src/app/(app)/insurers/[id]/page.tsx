import Link from "next/link";
import { notFound } from "next/navigation";
import { ImportStatus, KIND_LABEL } from "@/components/badges";
import { formatDuration, formatMonth, formatTimestamp } from "@/lib/format";
import { getInsurer, importsForInsurer, mappingVersions, monthsWithClaims, onboardingTime } from "@/server/queries";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

export default async function InsurerPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const insurer = await getInsurer(id);
  if (!insurer) notFound();
  const [imports, versions, months, onboarding] = await Promise.all([importsForInsurer(id), mappingVersions(id), monthsWithClaims(id), onboardingTime(id)]);
  const latestMonth = imports[0]?.reportingMonth;
  const defaultMonth = latestMonth ?? new Date().toISOString().slice(0, 7);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs"><Link href="/">Insurers</Link> /</div>
          <h1>{insurer.name}</h1>
          <p className="sub">
            {onboarding !== null ? <>Onboarded: first bordereau loaded <strong>{formatDuration(onboarding)}</strong> after the insurer was created.</> : "Not onboarded yet: upload a first bordereau."}
          </p>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Upload a bordereau</h2>
          <UploadForm insurerId={id} defaultMonth={defaultMonth} />
        </div>
        <div className="card flush">
          <h2>Claims reports</h2>
          {months.length === 0 ? (
            <div className="empty">No claims loaded yet.</div>
          ) : (
            <table>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month}>
                    <td>{formatMonth(m.month)}</td>
                    <td className="num muted">{m.n} claims</td>
                    <td className="num"><Link href={`/insurers/${id}/months/${m.month}`}>Report and verify →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card flush scroll-x" style={{ marginTop: 16 }}>
        <h2>Imports</h2>
        {imports.length === 0 ? (
          <div className="empty">Nothing uploaded yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Type</th>
                <th>File</th>
                <th>Status</th>
                <th>Mapping</th>
                <th className="num">Loaded</th>
                <th className="num">Issues</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.id}>
                  <td>{i.reportingMonth}</td>
                  <td>{KIND_LABEL[i.fileKind]}</td>
                  <td><Link href={i.status === "needs_mapping" ? `/imports/${i.id}/map` : `/imports/${i.id}`}>{i.filename}</Link></td>
                  <td><ImportStatus status={i.status} /></td>
                  <td>{i.version ? `v${i.version}` : <span className="faint">–</span>}</td>
                  <td className="num">{i.loadedCount !== null ? `${i.loadedCount} / ${i.rowCount}` : <span className="faint">–</span>}</td>
                  <td className="num">
                    <span className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                      {i.errors > 0 && <Link className="badge error" href={`/imports/${i.id}?severity=error`} aria-label={`View ${i.errors} errors in ${i.filename}`} title="View errors">{i.errors}</Link>}
                      {i.warnings > 0 && <Link className="badge warning" href={`/imports/${i.id}?severity=warning`} aria-label={`View ${i.warnings} warnings in ${i.filename}`} title="View warnings">{i.warnings}</Link>}
                      {i.errors === 0 && i.warnings === 0 && i.status === "imported" && <span className="faint">0</span>}
                    </span>
                  </td>
                  <td className="muted">{formatTimestamp(i.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {versions.length > 0 && (
        <div className="card">
          <details>
            <summary>Saved mappings ({versions.length} versions)</summary>
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>Type</th><th>Version</th><th>Columns</th><th>Approved</th></tr></thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>{KIND_LABEL[v.fileKind]}</td>
                    <td>v{v.version}</td>
                    <td className="muted" style={{ fontSize: 12.5 }}>{v.headers.join(" · ")}</td>
                    <td className="muted">{formatTimestamp(v.approvedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </>
  );
}
