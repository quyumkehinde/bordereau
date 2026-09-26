import { isMonth } from "@/lib/dates";
import { reportToCsv, reportToXlsx } from "@/lib/report";
import { hasSession } from "@/server/auth";
import { getInsurer } from "@/server/queries";
import { claimsReport } from "@/server/reporting";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; month: string }> }) {
  if (!(await hasSession())) return new Response("Not signed in", { status: 401 });
  const { id: idParam, month } = await params;
  const id = Number(idParam);
  const insurer = Number.isInteger(id) ? await getInsurer(id) : undefined;
  if (!insurer || !isMonth(month)) return new Response("Not found", { status: 404 });

  const format = new URL(req.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const report = await claimsReport(id, month);
  const base = `${insurer.name}-claims-bordereau-${month}`.replace(/[^\w.\-]+/g, "_");
  if (format === "xlsx") {
    return new Response(new Uint8Array(await reportToXlsx(report)), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${base}.xlsx"`,
      },
    });
  }
  return new Response(reportToCsv(report), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${base}.csv"` },
  });
}
