import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="login">
      <div className="card">
        <h1 style={{ marginBottom: 4 }}>Bordereau</h1>
        <p className="muted" style={{ marginBottom: 16 }}>Demo login. All data here is synthetic.</p>
        <LoginForm next={next ?? "/"} />
      </div>
    </main>
  );
}
