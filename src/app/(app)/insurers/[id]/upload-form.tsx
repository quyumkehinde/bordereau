"use client";

import { useActionState } from "react";
import { uploadBordereau } from "../../../actions";

export function UploadForm({ insurerId, defaultMonth }: { insurerId: number; defaultMonth: string }) {
  const [state, action, pending] = useActionState(uploadBordereau, undefined);
  return (
    <form action={action} style={{ display: "grid", gap: 12 }}>
      <input type="hidden" name="insurerId" value={insurerId} />
      <div className="row">
        <div className="segmented" role="radiogroup" aria-label="Bordereau type">
          <label><input type="radio" name="kind" value="policy" defaultChecked /> Policies</label>
          <label><input type="radio" name="kind" value="claim" /> Claims</label>
        </div>
        <label className="field" style={{ gridAutoFlow: "column", alignItems: "center", gap: 8 }}>
          Month
          <input type="month" name="month" defaultValue={defaultMonth} required />
        </label>
      </div>
      <input type="file" name="file" accept=".csv,.xlsx" required />
      <div className="row">
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "Reading file…" : "Upload"}</button>
        <span className="faint">CSV or XLSX. Header rows, merged headers, blank and total rows are handled.</span>
      </div>
      {state?.error && <div className="alert error">{state.error}</div>}
    </form>
  );
}
