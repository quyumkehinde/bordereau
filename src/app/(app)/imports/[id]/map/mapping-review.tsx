"use client";

import { useMemo, useState, useTransition } from "react";
import type { CanonicalField, FileKind } from "@/lib/canonical";
import type { ColumnMapping, Mapping, Transform } from "@/lib/mapping";
import { approveMappingAction } from "../../../../actions";

export interface ColumnInfo {
  header: string;
  samples: string[];
  /** every distinct value when there are few enough to map one by one (enums) */
  distinct: string[];
}

interface Props {
  importId: number;
  kind: FileKind;
  fields: CanonicalField[];
  columns: ColumnInfo[];
  initial: Mapping;
  toReview: string[];
  carriedVersion: number | null;
}

const STATUSES = ["open", "closed", "reopened"] as const;

function defaultTransform(field: CanonicalField | undefined, prev: Transform, distinct: string[]): Transform {
  if (!field) return { kind: "none" };
  switch (field.type) {
    case "date":
      return prev.kind === "date" ? prev : { kind: "date", order: "DMY" };
    case "amount":
      return { kind: "amount" };
    case "currency":
      return { kind: "currency" };
    case "claim_status":
      return prev.kind === "enum" ? prev : { kind: "enum", values: Object.fromEntries(distinct.map((d) => [d, guessStatus(d)])) };
    default:
      return { kind: "none" };
  }
}

function guessStatus(v: string): string {
  const s = v.toLowerCase();
  if (/re-?open/.test(s)) return "reopened";
  if (/^(c|closed?|y|yes)$/.test(s)) return "closed";
  return "open";
}

export function MappingReview({ importId, kind, fields, columns, initial, toReview, carriedVersion }: Props) {
  const [mapping, setMapping] = useState<Mapping>(initial);
  const [showCarried, setShowCarried] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const info = useMemo(() => new Map(columns.map((c) => [c.header, c])), [columns]);
  const review = new Set(toReview);
  const fieldByName = new Map(fields.map((f) => [f.name, f]));

  const update = (source: string, patch: (c: ColumnMapping) => ColumnMapping) =>
    setMapping((m) => ({ ...m, columns: m.columns.map((c) => (c.source === source ? patch(c) : c)) }));

  const setTarget = (source: string, target: string) =>
    update(source, (c) => {
      const field = fieldByName.get(target);
      return { ...c, target: field ? target : null, transform: defaultTransform(field, c.transform, info.get(source)?.distinct ?? []), confidence: undefined, note: undefined };
    });

  // Client-side checks mirror the server's (which re-validates on approve).
  const counts = new Map<string, number>();
  for (const c of mapping.columns) if (c.target) counts.set(c.target, (counts.get(c.target) ?? 0) + 1);
  const duplicates = new Set([...counts].filter(([, n]) => n > 1).map(([t]) => t));
  const missing = fields.filter((f) => f.required && !counts.has(f.name));
  const hasCurrencyColumn = counts.has("currency");
  const blocking = duplicates.size > 0 || missing.length > 0;

  const approve = () =>
    startTransition(async () => {
      setServerErrors([]);
      const res = await approveMappingAction(importId, mapping);
      if (res?.errors.length) setServerErrors(res.errors);
    });

  const visible = mapping.columns.filter((c) => showCarried || carriedVersion === null || review.has(c.source));
  const hiddenCount = mapping.columns.length - visible.length;

  return (
    <>
      <div className="card flush">
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Source column</th>
                <th>Sample values</th>
                <th>Maps to</th>
                <th>Transform</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const col = info.get(c.source)!;
                const field = c.target ? fieldByName.get(c.target) : undefined;
                const low = c.confidence !== undefined && c.confidence < 0.6;
                const cls = c.target && duplicates.has(c.target) ? "dup" : carriedVersion !== null && review.has(c.source) ? "review" : !c.target ? "ignored" : low ? "review" : "";
                return (
                  <tr key={c.source} className={cls}>
                    <td>
                      <code>{c.source}</code>
                      {carriedVersion !== null && review.has(c.source) && <> <span className="badge warning">New column</span></>}
                      {carriedVersion !== null && !review.has(c.source) && <div className="faint" style={{ fontSize: 12 }}>from v{carriedVersion}</div>}
                    </td>
                    <td>
                      {col.samples.map((s) => <div key={s} className="sample" title={s}>{s}</div>)}
                      {col.samples.length === 0 && <span className="faint">(empty)</span>}
                    </td>
                    <td>
                      <select className="compact" value={c.target ?? ""} onChange={(e) => setTarget(c.source, e.target.value)} aria-label={`Target for ${c.source}`}>
                        <option value="">Ignore</option>
                        {fields.map((f) => (
                          <option key={f.name} value={f.name}>{f.label}{f.required ? " *" : ""}</option>
                        ))}
                      </select>
                      {c.target && duplicates.has(c.target) && <div style={{ color: "var(--error)", fontSize: 12, marginTop: 4 }}>Mapped from more than one column</div>}
                    </td>
                    <td>
                      <TransformEditor field={field} transform={c.transform} distinct={col.distinct} onChange={(t) => update(c.source, (x) => ({ ...x, transform: t }))} />
                    </td>
                    <td style={{ minWidth: 160 }}>
                      {c.confidence !== undefined ? (
                        <span className="conf">
                          <span className={`conf-bar ${low ? "low" : ""}`}><span style={{ width: `${Math.round(c.confidence * 100)}%` }} /></span>
                          {Math.round(c.confidence * 100)}%
                        </span>
                      ) : (
                        <span className="faint" style={{ fontSize: 12 }}>{carriedVersion !== null && !review.has(c.source) ? "Approved before" : "Set by you"}</span>
                      )}
                      {c.note && <div className="muted" style={{ fontSize: 12, marginTop: 4, maxWidth: 260 }}>{c.note}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {carriedVersion !== null && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--line)" }}>
            <button className="btn small" type="button" onClick={() => setShowCarried((s) => !s)}>
              {showCarried ? "Hide carried-over columns" : `Show ${hiddenCount} carried-over columns`}
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="row">
          {!hasCurrencyColumn && (
            <label className="field" style={{ gridAutoFlow: "column", alignItems: "center", gap: 8 }}>
              Currency when not stated
              <input
                type="text"
                maxLength={3}
                style={{ width: 70, textTransform: "uppercase" }}
                value={mapping.defaultCurrency ?? ""}
                onChange={(e) => setMapping((m) => ({ ...m, defaultCurrency: e.target.value.toUpperCase() || null }))}
              />
            </label>
          )}
          <span className="spacer" />
          <span className="muted">{mapping.columns.filter((c) => c.target).length} of {mapping.columns.length} columns mapped</span>
          <button className="btn primary" type="button" onClick={approve} disabled={blocking || pending}>
            {pending ? "Importing…" : carriedVersion !== null ? `Approve as v${carriedVersion + 1} and import` : "Approve and import"}
          </button>
        </div>
        {missing.length > 0 && <div className="alert warning" style={{ marginTop: 12 }}>Still needed for a {kind} bordereau: {missing.map((f) => f.label).join(", ")}.</div>}
        {serverErrors.length > 0 && (
          <div className="alert error" style={{ marginTop: 12 }}>
            Not saved:
            <ul>{serverErrors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
      </div>
    </>
  );
}

function TransformEditor({ field, transform, distinct, onChange }: { field: CanonicalField | undefined; transform: Transform; distinct: string[]; onChange: (t: Transform) => void }) {
  if (!field) return <span className="faint">–</span>;
  if (field.type === "date") {
    const order = transform.kind === "date" ? transform.order : "DMY";
    return (
      <select className="compact" value={order} onChange={(e) => onChange({ kind: "date", order: e.target.value as "DMY" | "MDY" | "YMD" })} aria-label="Date order">
        <option value="DMY">Day/Month/Year</option>
        <option value="MDY">Month/Day/Year</option>
        <option value="YMD">Year-Month-Day</option>
      </select>
    );
  }
  if (field.type === "claim_status") {
    const values = transform.kind === "enum" ? transform.values : {};
    const raw = [...new Set([...distinct, ...Object.keys(values)])];
    if (raw.length === 0) return <span className="faint">No values seen</span>;
    return (
      <div style={{ display: "grid", gap: 4 }}>
        {raw.map((r) => (
          <div key={r} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
            <code style={{ minWidth: 70 }}>{r}</code>→
            <select className="compact" value={values[r] ?? ""} onChange={(e) => onChange({ kind: "enum", values: { ...values, [r]: e.target.value } })} aria-label={`Status for ${r}`}>
              <option value="" disabled>choose</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        ))}
      </div>
    );
  }
  const label = { amount: "Amount (symbols and commas stripped)", currency: "ISO currency code", string: "Text as-is" }[field.type];
  return <span className="muted" style={{ fontSize: 12.5 }}>{label}</span>;
}
