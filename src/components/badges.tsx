const IMPORT_STATUS: Record<string, { label: string; cls: string }> = {
  imported: { label: "Imported", cls: "ok" },
  needs_mapping: { label: "Needs mapping", cls: "warning" },
  failed: { label: "Failed", cls: "error" },
  superseded: { label: "Superseded", cls: "neutral" },
};

export function ImportStatus({ status }: { status: string }) {
  const s = IMPORT_STATUS[status] ?? { label: status, cls: "neutral" };
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export function Severity({ severity }: { severity: string }) {
  return <span className={`badge ${severity === "error" ? "error" : "warning"}`}>{severity === "error" ? "Error" : "Warning"}</span>;
}

export const KIND_LABEL = { policy: "Policies", claim: "Claims" } as const;
