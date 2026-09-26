// Shape of data/generated/manifest.json: every generated file and every planted error.
// This is the test oracle: validation must report exactly these issues and verify must find the breaks.
import type { FileKind } from "./canonical";
import type { Rule, Severity } from "./issues";
import type { Mapping } from "./mapping";

export interface ManifestFile {
  insurer: string;
  kind: FileKind;
  month: string;
  path: string; // relative to repo root
  /** the mapping a reviewer should approve for this layout (ground truth for suggestions) */
  mapping: Mapping;
  /** for a file containing a planted movement break: the insurer's corrected resend */
  correctedPath?: string;
}

export interface PlantedIssue {
  insurer: string;
  kind: FileKind;
  month: string;
  path: string;
  rule: Rule;
  severity: Severity;
  sourceRow: number;
  sourceColumn: string | null;
  note: string;
}

export interface MovementBreak {
  insurer: string;
  month: string;
  path: string;
  correctedPath: string;
  claimRef: string;
  expectedOutstanding: number;
  reportedOutstanding: number;
}

export interface Manifest {
  seed: number;
  base: { source: string; rows: number };
  months: string[];
  insurers: { id: string; name: string }[];
  files: ManifestFile[];
  planted: PlantedIssue[];
  movementBreaks: MovementBreak[];
}
