export default function Loading() {
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h2>Reading the file and proposing a mapping…</h2>
      <p className="muted">Headers and a few sample rows go to Claude; the proposal comes back for you to review. Nothing is imported until you approve.</p>
    </div>
  );
}
