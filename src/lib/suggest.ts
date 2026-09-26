// Mapping suggestions. Claude reads headers plus a few sample rows and proposes a mapping; code
// validates it, checks it against the samples, and a human approves it. The model never touches
// row data at scale.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { fieldsFor, type FileKind } from "./canonical";
import { MappingSchema, normalizeHeader, parseAmount, parseDate, type ColumnMapping, type Mapping, type Transform } from "./mapping";
import { cellText, type Cell, type Table } from "./parse";

export const SUGGEST_MODEL = "claude-sonnet-5";
const SAMPLE_ROWS = 20;

export interface Suggestion {
  mapping: Mapping;
  source: "claude" | "heuristic";
  /** set when Claude was configured but failed and header matching was used instead */
  warning?: string;
}

export interface SuggestInput {
  kind: FileKind;
  table: Table;
  /** only suggest for these headers (layout change); others are left out of the result */
  onlyHeaders?: string[];
}

export async function suggestMapping(input: SuggestInput): Promise<Suggestion> {
  const headers = input.onlyHeaders ?? input.table.headers;
  let result: Suggestion;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      result = { mapping: await suggestWithClaude(input.kind, input.table, headers), source: "claude" };
    } catch (e) {
      // A reviewer can always map by hand; don't let an API problem block onboarding.
      console.error("Claude mapping suggestion failed; falling back to header matching", e);
      const reason = e instanceof Anthropic.APIError ? `API error ${e.status ?? ""}`.trim() : e instanceof Error ? e.message : String(e);
      result = { mapping: suggestHeuristically(input.kind, input.table, headers), source: "heuristic", warning: `Claude suggestion failed (${reason}); showing header matching instead.` };
    }
  } else {
    result = { mapping: suggestHeuristically(input.kind, input.table, headers), source: "heuristic" };
  }
  return { ...result, mapping: checkAgainstSamples(result.mapping, input.table) };
}

// ---------------------------------------------------------------- Claude

// Structured outputs don't accept records or numeric bounds, so the wire shape is flat and
// converted to the internal Mapping afterwards.
function wireSchema(kind: FileKind) {
  const targets: [string, ...string[]] = ["ignore", ...fieldsFor(kind).map((f) => f.name)];
  return z.object({
    columns: z.array(
      z.object({
        source: z.string().describe("Source header, copied exactly"),
        target: z.enum(targets).describe('Canonical field, or "ignore" if no field fits'),
        transform: z.enum(["none", "date", "amount", "currency", "enum"]),
        date_order: z.enum(["DMY", "MDY", "YMD", "n/a"]).describe("Day/month/year order for date columns"),
        enum_values: z.array(z.object({ raw: z.string(), value: z.string() })).describe("Raw value to canonical value, for enum columns"),
        confidence: z.number().describe("0 to 1"),
        note: z.string().describe("One short sentence on anything a reviewer should check; empty if none"),
      }),
    ),
    default_currency: z.string().describe("ISO 4217 code if the file implies one currency (e.g. £ amounts, no currency column); empty otherwise"),
  });
}

const SYSTEM = `You map insurance bordereau spreadsheets onto a canonical schema for a claims administrator.
You are given the file's headers, sample rows, and the canonical fields. For every header, choose the canonical field it holds, or "ignore".
Rules:
- Map each canonical field from at most one column. Leave a column "ignore" rather than guess.
- Dates: infer day/month/year order from the samples (a first part above 12 means DMY; a middle part above 12 means MDY). Say so in the note when the samples are ambiguous.
- Amounts: transform "amount"; currency symbols and thousands separators are handled by code.
- Claim status: transform "enum", mapping every raw value seen to one of open, closed, reopened. A yes/no "closed" flag maps Y to closed and N to open.
- Confidence reflects how sure you are from the header and the values together.`;

async function suggestWithClaude(kind: FileKind, table: Table, headers: string[]): Promise<Mapping> {
  const client = new Anthropic();
  const idx = headers.map((h) => table.headers.indexOf(h));
  const samples = table.rows.slice(0, SAMPLE_ROWS).map((r) => idx.map((i) => cellText(r.cells[i])));
  const fields = fieldsFor(kind).map((f) => `- ${f.name} (${f.type}${f.required ? ", required" : ""}): ${f.description}`).join("\n");

  const response = await client.messages.parse({
    model: SUGGEST_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `File kind: ${kind} bordereau\n\nCanonical fields:\n${fields}\n\nHeaders (JSON):\n${JSON.stringify(headers)}\n\nSample rows (JSON, same column order):\n${JSON.stringify(samples)}`,
      },
    ],
    output_config: { format: zodOutputFormat(wireSchema(kind)) },
  });

  if (response.stop_reason === "refusal") throw new Error("Mapping suggestion was declined by the model");
  if (response.stop_reason === "max_tokens") throw new Error("Mapping suggestion was cut off (max_tokens)");
  const out = response.parsed_output;
  if (!out) throw new Error("Mapping suggestion did not match the expected schema");

  return wireToMapping(headers, out);
}

export type WireSuggestion = z.infer<ReturnType<typeof wireSchema>>;

/** Converts the model's flat output to a validated Mapping, one column per header, in header order. */
export function wireToMapping(headers: string[], out: WireSuggestion): Mapping {
  const byHeader = new Map(out.columns.map((c) => [normalizeHeader(c.source), c]));
  const mapping: Mapping = {
    defaultCurrency: /^[A-Z]{3}$/.test(out.default_currency) ? out.default_currency : null,
    columns: headers.map((h): ColumnMapping => {
      const c = byHeader.get(normalizeHeader(h));
      if (!c) return { source: h, target: null, transform: { kind: "none" }, confidence: 0, note: "No suggestion returned for this column" };
      const confidence = Math.min(1, Math.max(0, c.confidence));
      const note = c.note || undefined;
      if (c.target === "ignore") return { source: h, target: null, transform: { kind: "none" }, confidence, note };
      return { source: h, target: c.target, transform: toTransform(c.transform, c.date_order, c.enum_values), confidence, note };
    }),
  };
  return MappingSchema.parse(dedupeTargets(mapping));
}

function toTransform(kind: string, order: string, values: { raw: string; value: string }[]): Transform {
  if (kind === "date") return { kind: "date", order: order === "MDY" || order === "YMD" ? order : "DMY" };
  if (kind === "amount") return { kind: "amount" };
  if (kind === "currency") return { kind: "currency" };
  if (kind === "enum") return { kind: "enum", values: Object.fromEntries(values.map((v) => [v.raw, v.value])) };
  return { kind: "none" };
}

/** If two columns claim one field, keep the more confident and flag the other for review. */
function dedupeTargets(m: Mapping): Mapping {
  const best = new Map<string, ColumnMapping>();
  for (const c of m.columns) {
    if (!c.target) continue;
    const prev = best.get(c.target);
    if (!prev || (c.confidence ?? 0) > (prev.confidence ?? 0)) best.set(c.target, c);
  }
  return {
    ...m,
    columns: m.columns.map((c) =>
      c.target && best.get(c.target) !== c
        ? { ...c, target: null, transform: { kind: "none" }, confidence: 0, note: `Also looked like ${c.target}; left unmapped` }
        : c,
    ),
  };
}

// ---------------------------------------------------------------- heuristic fallback (no API key)

const SYNONYMS: Record<FileKind, Record<string, string[]>> = {
  policy: {
    policy_ref: ["policy number", "policy no", "policy ref", "pol no", "certificate", "cert no", "policy"],
    insured_name: ["insured name", "insured", "policy holder", "holder", "name", "policyholder"],
    inception_date: ["inception", "incep", "start date", "cover start", "start", "effective"],
    expiry_date: ["expiry", "exp", "end date", "cover end", "end"],
    product: ["product", "prod", "plan", "scheme"],
    destination: ["destination", "dest", "region", "territory"],
    sum_insured: ["sum insured", "si", "limit"],
    gross_premium: ["gross premium", "premium", "gwp", "gross written premium"],
    currency: ["currency", "ccy", "cur"],
  },
  claim: {
    claim_ref: ["claim number", "claim no", "claim ref", "clm no", "claim"],
    policy_ref: ["policy number", "policy no", "pol no", "policy ref", "certificate"],
    date_of_loss: ["date of loss", "dol", "loss date", "loss", "incident date"],
    date_notified: ["date reported", "date notified", "don", "advised", "notified", "reported"],
    status: ["claim status", "status", "sts", "clsd", "closed"],
    cause: ["cause of loss", "cause", "loss description", "peril"],
    paid_this_month: ["paid this month", "pd mth", "paid month", "this month"],
    paid_to_date: ["paid to date", "paid td", "pd", "to date", "paid"],
    reserve_movement: ["reserve movement", "res mvt", "movement", "incurred movement"],
    outstanding_reserve: ["outstanding reserve", "o/s", "outstanding", "reserve"],
    currency: ["currency", "ccy", "cur"],
  },
};

function suggestHeuristically(kind: FileKind, table: Table, headers: string[]): Mapping {
  const fields = fieldsFor(kind);
  const used = new Set<string>();
  const columns = headers.map((h): ColumnMapping => {
    const norm = normalizeHeader(h);
    const values = sampleValues(table, h);
    let hit: { field: string; score: number } | null = null;
    for (const [field, names] of Object.entries(SYNONYMS[kind])) {
      if (used.has(field)) continue;
      for (const name of names) {
        const score = norm === name ? 1 : norm.endsWith(` ${name}`) || norm.startsWith(`${name} `) ? 0.7 : 0;
        if (score > (hit?.score ?? 0)) hit = { field, score };
      }
    }
    if (!hit) return { source: h, target: null, transform: { kind: "none" }, confidence: 0.5 };
    used.add(hit.field);
    const type = fields.find((f) => f.name === hit!.field)!.type;
    let transform: Transform = { kind: "none" };
    if (type === "date") transform = { kind: "date", order: inferDateOrder(values) };
    else if (type === "amount") transform = { kind: "amount" };
    else if (type === "currency") transform = { kind: "currency" };
    else if (type === "claim_status") transform = { kind: "enum", values: inferStatusValues(values, norm) };
    return { source: h, target: hit.field, transform, confidence: hit.score * 0.8 };
  });
  return { columns, defaultCurrency: inferCurrency(table) };
}

function sampleValues(table: Table, header: string): Cell[] {
  const i = table.headers.indexOf(header);
  return table.rows.slice(0, 200).map((r) => r.cells[i]).filter((c) => cellText(c) !== "");
}

export function inferDateOrder(values: Cell[]): "DMY" | "MDY" | "YMD" {
  const text = values.filter((v): v is string => typeof v === "string");
  if (text.some((v) => /^\d{4}-/.test(v))) return "YMD";
  const parts = text.map((v) => v.split(/[/.\-]/).map(Number)).filter((p) => p.length === 3);
  if (parts.some((p) => p[1] > 12)) return "MDY";
  return "DMY";
}

function inferStatusValues(values: Cell[], header: string): Record<string, string> {
  const distinct = [...new Set(values.map((v) => cellText(v)))];
  const out: Record<string, string> = {};
  const closedFlag = /clsd|closed/.test(header);
  for (const v of distinct) {
    const s = v.toLowerCase();
    if (closedFlag && /^(y|yes|1|true)$/.test(s)) out[v] = "closed";
    else if (closedFlag && /^(n|no|0|false)$/.test(s)) out[v] = "open";
    else if (/re-?open/.test(s)) out[v] = "reopened";
    else if (/^clos/.test(s) || s === "c") out[v] = "closed";
    else if (/^open/.test(s) || s === "o") out[v] = "open";
  }
  return out;
}

function inferCurrency(table: Table): string | null {
  const text = table.rows.slice(0, 50).flatMap((r) => r.cells.map(cellText)).join(" ");
  if (text.includes("£")) return "GBP";
  if (text.includes("€")) return "EUR";
  return null;
}

// ---------------------------------------------------------------- sample check

/**
 * Applies each column's transform to its sample values. Anything that fails to parse drops the
 * suggestion's confidence and adds a note, so a wrong date order can't slip through unreviewed.
 */
export function checkAgainstSamples(mapping: Mapping, table: Table): Mapping {
  return {
    ...mapping,
    columns: mapping.columns.map((c) => {
      if (!c.target) return c;
      const values = sampleValues(table, c.source);
      if (values.length === 0) return c;
      let failures = 0;
      for (const v of values) {
        const t = c.transform;
        if (t.kind === "date" && !parseDate(v, t.order).ok) failures++;
        if (t.kind === "amount" && !parseAmount(v).ok) failures++;
        if (t.kind === "enum" && !Object.keys(t.values).some((k) => k.toLowerCase() === cellText(v).toLowerCase())) failures++;
      }
      if (failures === 0) return c;
      const note = `${failures} of ${values.length} sample values don't parse with this transform`;
      return { ...c, confidence: Math.min(c.confidence ?? 1, 0.3), note: c.note ? `${c.note}. ${note}` : note };
    }),
  };
}
