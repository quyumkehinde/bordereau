import { describe, expect, it } from "vitest";
import { detectTable, readCsv } from "@/lib/parse";

describe("detectTable", () => {
  it("finds a header below a preamble and skips blank and total rows, but not causes that start with 'Total'", () => {
    const t = detectTable(
      readCsv(["Acme claims extract", "Period: 2026-08", "", "Clm No,Cause,Pd", "C1,Total loss of baggage,10", "", "C2,Delay,5", "Total,,15"].join("\n")),
    );
    expect(t.headerRows).toEqual([4]);
    expect(t.headers).toEqual(["Clm No", "Cause", "Pd"]);
    expect(t.rows.map((r) => r.sourceRow)).toEqual([5, 7]);
    expect(t.skipped).toEqual([{ sourceRow: 6, reason: "blank" }, { sourceRow: 8, reason: "total" }]);
  });

  it("combines a sparse group row above the header", () => {
    const t = detectTable(readCsv(["Policy,,Cover,", "Number,Holder,Start,End", "P1,Ann,01/07/2026,10/07/2026"].join("\n")));
    expect(t.headers).toEqual(["Policy Number", "Policy Holder", "Cover Start", "Cover End"]);
  });

  it("doesn't mistake a header with one blank column for a group row", () => {
    const t = detectTable(readCsv(["Ref,Name,,Dest,Product", "A1,Ann Lee,x,SPAIN,Gold", "A2,Bo Chan,y,JAPAN,Silver"].join("\n")));
    expect(t.headerRows).toEqual([1]);
    expect(t.rows).toHaveLength(2);
  });

  it("names blank headers and de-duplicates repeated ones", () => {
    const t = detectTable(readCsv(["Ref,Amount,,Amount", "A,1,x,2"].join("\n")));
    expect(t.headers).toEqual(["Ref", "Amount", "Column 3", "Amount (2)"]);
  });
});
