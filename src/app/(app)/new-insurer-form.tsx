"use client";

import { useActionState } from "react";
import { createInsurer } from "../actions";

export function NewInsurerForm() {
  const [state, action, pending] = useActionState(createInsurer, undefined);
  return (
    <form action={action} className="row">
      <input type="text" name="name" placeholder="Insurer or MGA name" required style={{ flex: "1 1 260px" }} />
      <button className="btn primary" type="submit" disabled={pending}>{pending ? "Creating…" : "Create insurer"}</button>
      {state?.error && <div className="alert error" style={{ flexBasis: "100%" }}>{state.error}</div>}
    </form>
  );
}
