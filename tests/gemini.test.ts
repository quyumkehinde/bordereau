import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { suggestMapping } from "@/lib/suggest";
import { manifest, parsePath } from "./helpers";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("google-auth-library", () => ({ GoogleAuth: class { request = request; } }));

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");
  request.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const file = manifest.files.find((f) => f.insurer === "C" && f.kind === "claim")!;
const valid = {
  default_currency: "GBP",
  columns: [{ source: "Clm No", target: "claim_ref", transform: "none", date_order: "n/a", enum_values: [], confidence: 0.9, note: "" }],
};
const response = (text: string, finishReason = "STOP") => ({ data: { candidates: [{ finishReason, content: { parts: [{ text }] } }] } });

it("requests structured Gemini output using only the changed headers and 20 sample rows", async () => {
  request.mockResolvedValue(response(JSON.stringify(valid)));
  const table = await parsePath(file.path);
  const result = await suggestMapping({ kind: "claim", table, onlyHeaders: ["Clm No"] });
  expect(result.source).toBe("gemini");
  expect(result.mapping.columns).toHaveLength(1);
  expect(result.mapping.columns[0].target).toBe("claim_ref");
  const args = request.mock.calls[0][0];
  expect(args.url).toContain("projects/test-project/locations/global/publishers/google/models/gemini-3-flash-preview:generateContent");
  expect(args.data.generationConfig.responseMimeType).toBe("application/json");
  expect(args.data.generationConfig.responseJsonSchema.properties.columns).toBeDefined();
  const prompt = args.data.contents[0].parts[0].text;
  const samples = JSON.parse(prompt.split("Sample rows (JSON, same column order):\n")[1]);
  expect(samples).toHaveLength(Math.min(20, table.rows.length));
  expect(samples.every((row: string[]) => row.length === 1)).toBe(true);
});

it.each([
  ["malformed JSON", response("not json")],
  ["invalid target", response(JSON.stringify({ ...valid, columns: [{ ...valid.columns[0], target: "invented_field" }] }))],
  ["truncated output", response(JSON.stringify(valid), "MAX_TOKENS")],
  ["blocked output", { data: { promptFeedback: { blockReason: "SAFETY" } } }],
  ["empty output", response("")],
])("falls back visibly on %s", async (_name, value) => {
  request.mockResolvedValue(value);
  const result = await suggestMapping({ kind: "claim", table: await parsePath(file.path) });
  expect(result.source).toBe("heuristic");
  expect(result.warning).toContain("Gemini suggestion unavailable");
  expect(result.mapping.columns.length).toBeGreaterThan(0);
});

it("handles quota/auth failures without exposing the provider error or credentials", async () => {
  request.mockRejectedValue(new Error("sensitive bearer token and spreadsheet samples"));
  const result = await suggestMapping({ kind: "claim", table: await parsePath(file.path) });
  expect(result.source).toBe("heuristic");
  expect(result.warning).not.toContain("sensitive");
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sensitive");
});

it("does not call Vertex when no project is configured", async () => {
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
  const result = await suggestMapping({ kind: "claim", table: await parsePath(file.path) });
  expect(result.source).toBe("heuristic");
  expect(result.warning).toBeUndefined();
  expect(request).not.toHaveBeenCalled();
});
