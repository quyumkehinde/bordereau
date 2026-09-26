import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ImportStatus, KIND_LABEL, Severity } from "@/components/badges";
import { RULES, type Rule } from "@/lib/issues";
import { formatMonth } from "@/lib/format";
import { cellText, columnLetter } from "@/lib/parse";
import { loadImport, loadTable, UserError } from "@/server/imports";
import { getInsurer, importIssueCounts, importIssues, mappingConfig } from "@/server/queries";

export const dynamic = "force-dynamic";

type Search = { severity?: string; rule?: string; row?: string; col?: string };

export default async function ImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  const imp = await loadImport(id).catch((e) => (e instanceof UserError ? null : Promise.reject(e)));
  if (!imp) notFound();
  if (imp.status === "needs_mapping") redirect(`/imports/${id}/map`);

  const [insurer, allIssues, counts, config] = await Promise.all([
    getInsurer(imp.insurerId),
    importIssues(id),
    importIssueCounts(id),
    imp.mappingConfigId ? mappingConfig(imp.mappingConfigId) : Promise.resolve(undefined),
  ]);

  const shown = allIssues.filter((i) => (!sp.severity || i.severity === sp.severity) && (!sp.rule || i.rule === sp.rule));
  const errors = counts.filter((c) => c.severity === "error").reduce((s, c) => s + c.n, 0);
  const warnings = counts.filter((c) => c.severity === "warning").reduce((s, c) => s + c.n, 0);
  const quarantined = (imp.rowCount ?? 0) - (imp.loadedCount ?? 0);
  const selectedRow = sp.row ? Number(sp.row) : null;

  const href = (patch: Partial<Search>) => {
    const next = { ...sp, ...patch };
    const q = new URLSearchParams(Object.entries(next).filter((e): e is [string, string] => !!e[1]));
    const s = q.toString();
    return s ? `?${s}` : "?";
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            <Link href="/">Insurers</Link> / <Link href={`/insurers/${imp.insurerId}`}>{insurer?.name}</Link> /
          </div>
          <h1>{imp.filename}</h1>
          <p className="sub">
            {KIND_LABEL[imp.fileKind]} bordereau for {formatMonth(imp.reportingMonth)} · <ImportStatus status={imp.status} />
            {config && <> · mapping v{config.version}</>}
          </p>
        </div>
        {allIssues.length > 0 && <a className="btn" href={`/imports/${id}/issues.csv`}>Download issues CSV</a>}
      </div>

      {imp.status === "failed" && <div className="alert error" style={{ marginBottom: 16 }}>{imp.error}</div>}
      {imp.layoutChange && (imp.layoutChange.added.length > 0 || imp.layoutChange.removed.length > 0) && (
        <div className="alert warning" style={{ marginBottom: 16 }}>
          Layout changed from the previous mapping.
          {imp.layoutChange.added.length > 0 && <> New: {imp.layoutChange.added.map((h) => <code key={h}> {h}</code>)}.</>}
          {imp.layoutChange.removed.length > 0 && <> Gone: {imp.layoutChange.removed.map((h) => <code key={h}> {h}</code>)}.</>}
        </div>
      )}

      {imp.status !== "failed" && (
        <div className="card">
          <div className="stats">
            <div className="stat"><div className="v">{imp.rowCount}</div><div className="k">Rows in file</div></div>
            <div className="stat"><div className="v">{imp.loadedCount}</div><div className="k">Loaded</div></div>
            <div className="stat"><div className="v" style={{ color: quarantined ? "var(--error)" : undefined }}>{quarantined}</div><div className="k">Quarantined (errors)</div></div>
            <div className="stat"><div className="v">{errors}</div><div className="k">Errors</div></div>
            <div className="stat"><div className="v">{warnings}</div><div className="k">Warnings</div></div>
          </div>
        </div>
      )}

      {selectedRow !== null && <SourcePanel storagePath={imp.storagePath} filename={imp.filename} row={selectedRow} column={sp.col ?? null} closeHref={href({ row: undefined, col: undefined })} />}

      {allIssues.length > 0 ? (
        <div className="card flush" style={{ marginTop: 16 }}>
          <div className="chips">
            <Link className={`chip ${!sp.severity && !sp.rule ? "on" : ""}`} href={href({ severity: undefined, rule: undefined })}>All {allIssues.length}</Link>
            {errors > 0 && <Link className={`chip ${sp.severity === "error" ? "on" : ""}`} href={href({ severity: "error", rule: undefined })}>Errors {errors}</Link>}
            {warnings > 0 && <Link className={`chip ${sp.severity === "warning" ? "on" : ""}`} href={href({ severity: "warning", rule: undefined })}>Warnings {warnings}</Link>}
            <span style={{ width: 8 }} />
            {counts.map((c) => (
              <Link key={c.rule} className={`chip ${sp.rule === c.rule ? "on" : ""}`} href={href({ rule: c.rule, severity: undefined })}>
                {RULES[c.rule as Rule]?.label ?? c.rule} {c.n}
              </Link>
            ))}
          </div>
          <div className="scroll-x">
            <table>
              <thead>
                <tr><th className="num">Row</th><th>Column</th><th>Rule</th><th>Severity</th><th>Problem</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className={selectedRow === i.sourceRow && (sp.col ?? null) === i.sourceColumn ? "selected" : undefined}>
                    <td className="num mono">{i.sourceRow}</td>
                    <td>{i.sourceColumn ? <code>{i.sourceColumn}</code> : <span className="faint">–</span>}</td>
                    <td>{RULES[i.rule as Rule]?.label ?? i.rule}</td>
                    <td><Severity severity={i.severity} /></td>
                    <td>{i.message}</td>
                    <td className="num"><Link href={href({ row: String(i.sourceRow), col: i.sourceColumn ?? undefined })}>View cell</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        imp.status === "imported" && <div className="alert ok" style={{ marginTop: 16 }}>No issues: every row loaded.</div>
      )}
    </>
  );
}

/** The offending row in its original context, re-read from the stored file. */
async function SourcePanel({ storagePath, filename, row, column, closeHref }: { storagePath: string; filename: string; row: number; column: string | null; closeHref: string }) {
  const table = await loadTable(storagePath, filename);
  const colIndex = column ? table.headers.indexOf(column) : -1;
  const idx = table.rows.findIndex((r) => r.sourceRow === row);
  const context = idx < 0 ? [] : table.rows.slice(Math.max(0, idx - 2), idx + 3);
  const address = `${table.sheetName !== "csv" ? `${table.sheetName}!` : ""}${colIndex >= 0 ? columnLetter(colIndex) : ""}${row}`;
  return (
    <div className="card flush" style={{ marginTop: 16 }}>
      <div className="row" style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
        <strong>Source {column ? "cell" : "row"} <code>{address}</code></strong>
        <span className="muted">as sent by the insurer · header on row {table.headerRows.join("–")}</span>
        <span className="spacer" />
        <Link className="btn small" href={closeHref}>Close</Link>
      </div>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th className="num">Row</th>
              {table.headers.map((h, i) => <th key={h} className={i === colIndex ? "cell-hit" : undefined}>{columnLetter(i)} · {h}</th>)}
            </tr>
          </thead>
          <tbody>
            {context.map((r) => (
              <tr key={r.sourceRow} className={r.sourceRow === row ? "selected" : undefined}>
                <td className="num mono">{r.sourceRow}</td>
                {r.cells.map((c, i) => (
                  <td key={i} className={`mono ${r.sourceRow === row && i === colIndex ? "cell-hit" : ""}`} style={{ whiteSpace: "nowrap" }}>
                    {cellText(c) || <span className="faint">(blank)</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
