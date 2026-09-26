import Link from "next/link";
import { formatMonth } from "@/lib/format";
import { listInsurers } from "@/server/queries";
import { NewInsurerForm } from "./new-insurer-form";

export const dynamic = "force-dynamic";

export default async function Home() {
  const insurers = await listInsurers();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Insurers</h1>
          <p className="sub">Each insurer sends policy and claims bordereaux in its own layout. Map once, then every month imports on the saved mapping.</p>
        </div>
      </div>
      <div className="card flush scroll-x">
        {insurers.length === 0 ? (
          <div className="empty">No insurers yet. Add one below, or run <code>npm run seed</code>.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Insurer</th>
                <th className="num">Imports</th>
                <th className="num">Policies</th>
                <th className="num">Rows quarantined</th>
                <th>Latest claims month</th>
              </tr>
            </thead>
            <tbody>
              {insurers.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/insurers/${i.id}`}>{i.name}</Link></td>
                  <td className="num">{i.imports}</td>
                  <td className="num">{i.policies}</td>
                  <td className="num">{i.openIssues > 0 ? <span className="badge error">{i.openIssues}</span> : <span className="faint">0</span>}</td>
                  <td>{i.lastMonth ? formatMonth(i.lastMonth) : <span className="faint">None yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h2>Onboard a new insurer</h2>
        <NewInsurerForm />
      </div>
    </>
  );
}
