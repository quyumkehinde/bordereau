"use client";

import { useActionState } from "react";
import { login } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />
      <label className="field">
        Password
        <input type="password" name="password" autoFocus required />
      </label>
      {state?.error && <div className="alert error">{state.error}</div>}
      <button className="btn primary" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
