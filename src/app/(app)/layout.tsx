import Link from "next/link";
import { logout } from "../actions";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">Bordereau</Link>
        <nav>
          <Link href="/">Insurers</Link>
        </nav>
        <span className="pill" title="Generated from a public travel insurance dataset. No real insurer, policyholder or claim.">Synthetic data</span>
        <form action={logout}>
          <button className="btn small" type="submit">Sign out</button>
        </form>
      </header>
      <main>{children}</main>
    </>
  );
}
