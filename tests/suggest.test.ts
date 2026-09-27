// The no-Vertex fallback should get the obvious columns right on every generated layout, and the
// sample check must flag a wrong date order instead of letting it through.
import { describe, expect, it } from "vitest";
import { checkAgainstSamples, suggestMapping } from "@/lib/suggest";
import { manifest, parsePath } from "./helpers";

describe("heuristic suggestions", () => {
  delete process.env.GOOGLE_CLOUD_PROJECT;
  it.each(manifest.files.map((f) => [f.path, f] as const))("%s matches the ground-truth mapping", async (_p, file) => {
    const table = await parsePath(file.path);
    const { mapping, source } = await suggestMapping({ kind: file.kind, table });
    expect(source).toBe("heuristic");
    const simplify = (m: typeof mapping) =>
      Object.fromEntries(m.columns.map((c) => [c.source, c.target ? `${c.target}:${c.transform.kind}${c.transform.kind === "date" ? c.transform.order : ""}` : null]));
    expect(simplify(mapping)).toEqual(simplify(file.mapping));
  });
});

it("flags a date order that doesn't fit the samples", async () => {
  const file = manifest.files.find((f) => f.insurer === "B" && f.kind === "policy")!;
  const table = await parsePath(file.path);
  const wrong = {
    ...file.mapping,
    columns: file.mapping.columns.map((c) => (c.transform.kind === "date" ? { ...c, transform: { kind: "date" as const, order: "DMY" as const } } : c)),
  };
  const checked = checkAgainstSamples(wrong, table);
  const start = checked.columns.find((c) => c.target === "inception_date")!;
  expect(start.confidence).toBeLessThanOrEqual(0.3);
  expect(start.note).toMatch(/don't parse/);
});
