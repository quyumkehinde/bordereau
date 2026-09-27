# Bordereau

Onboard a new insurer's messy bordereau in minutes, catch every data problem before it reaches a claim, and produce a reconciled Lloyd's-format claims report.

> **All data is synthetic.** The generator starts from the public [Kaggle travel insurance dataset](https://www.kaggle.com/datasets/mhdzahier/travel-insurance) (63,326 policies from a Singapore travel insurance servicer) for realistic products, trip lengths and destinations, and invents everything else: three fictional insurers, names, sums insured, claims and their reserves. No real insurer, policyholder or claim appears anywhere. Report field names follow Lloyd's Coverholder Reporting Standards v5.2 but are **provisional** until checked against the London Market Group glossary export (see [`src/lib/crs-fields.ts`](src/lib/crs-fields.ts)).

## How it works

```
 upload (CSV/XLSX)
      │
      ▼
 parse ─────────── find the header row (preambles, merged two-row headers),
      │            skip blank and total rows, pick the right sheet
      ▼
 mapping? ──known layout (header hash)──────────────▶ zero-click import
      │
      ├─ layout changed ─▶ carry the saved mapping over; review only new columns
      │
      └─ new insurer ───▶ Gemini proposes a mapping from headers + 20 sample rows
                           (Zod-validated JSON, checked against the samples)
                           ─▶ human accepts / edits / ignores ─▶ versioned config
      ▼
 validate (plain code) ─── every rule is a pure function returning issues with row + column;
      │                    rows with errors are quarantined, warnings load
      ▼
 load (one transaction) ── a resend for the same insurer/month supersedes the earlier file
      ▼
 report ────────────────── monthly claims bordereau, CRS v5.2 layout, CSV and XLSX
      ▼
 verify ────────────────── claims tie to live policies · movement reconciles per claim and in
                           total · report totals equal the rows · readable diff, nonzero exit
```

The model never touches row data at scale: it proposes a mapping and code applies it.

| Where | What |
| --- | --- |
| `src/lib/` | Pure domain code: parser, mapping + transforms, validation rules, report, verify, suggestions |
| `src/server/` | Import service (transactions, superseding, versioned mappings), storage (local disk / GCS), queries |
| `src/app/` | Next.js App Router UI and route handlers |
| `scripts/generate.ts` | Builds the three insurers' files and `data/generated/manifest.json`, the list of every planted error |
| `scripts/verify.ts` | `npm run verify` |
| `infra/` | Terraform: Cloud Run, Cloud SQL (Postgres 17), GCS, Secret Manager |

## The demo insurers

| Insurer | Format | Mess |
| --- | --- | --- |
| A · Albion Travel Underwriting | CSV | Clean-ish, UK dates, "Policy Number" |
| B · Brightwater Assistance MGA | XLSX | Title row, merged two-row header, US dates, `£1,200.00` strings, totals row, a Notes sheet |
| C · Cobalt Travel Insurance | CSV | Preamble lines, abbreviated headers (`Pol No`, `DOL`, `Pd`), 2-digit years, a Y/N closed flag, columns reordered in month 2 and `Pd` renamed to `Paid TD` |

Two months each (July and August 2026), with 33 planted errors across 13 rules (duplicates, loss before cover start, orphan claims, missing refs, paid over sum insured, and more) and one planted movement break in C's August claims, plus C's corrected resend.

## Run locally

Requires Node 22+ and Docker.

```bash
docker compose up -d                 # Postgres on :5433
cp .env.example .env                 # optionally configure Gemini on Vertex AI (below)
npm ci
npm run db:migrate
npm run seed                         # A and B loaded; C created empty, ready to onboard
npm run dev                          # http://localhost:3000, password "demo"
```

For Gemini suggestions, enable Vertex AI in your Google Cloud project and authenticate locally:

```bash
gcloud services enable aiplatform.googleapis.com --project=YOUR_PROJECT_ID
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

Set `GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID` in `.env`; your identity needs `roles/aiplatform.user`. Suggestions use Gemini 3 Flash on Vertex AI. Without a project, or if the request fails, the app uses header matching.

| Command | |
| --- | --- |
| `npm run generate` | Regenerate `data/generated/` (needs the Kaggle CSV at `data/raw/travel_insurance.csv`) |
| `npm run seed -- --all` | Also load C, using its corrected August resend |
| `npm run seed -- --all --broken` | Load C's original August file; `verify` then fails on the planted break |
| `npm run verify [-- --insurer cobalt --month 2026-08]` | Exit 0 when everything reconciles, 1 with a diff when not |
| `npm test` | Unit tests, including the planted-error oracle |
| `npm run e2e` | Playwright: the full demo flow in a browser |

## Tests

- **Planted-error oracle** (`tests/planted.test.ts`): every generated file goes through the real pipeline and must report exactly the manifest's planted issues. A miss fails, and so does any extra issue on a clean row.
- **Verify** (`tests/verify.test.ts`): passes on clean data, fails on exactly the planted claim with the planted amounts, and passes after the resend.
- **E2E** (`e2e/demo.spec.ts`): onboard C from scratch, fix a mapping, click through to a source cell, import month 2 on the saved mapping with the renamed column flagged, fail verify, load the resend, pass verify.
- CI (`.github/workflows/ci.yml`) runs all of the above against Postgres, plus `npm run verify` on seeded data. It also asserts that `verify` exits 1 on the broken file.

## Deploy (GCP)

```bash
cd infra
terraform init
terraform apply -var project_id=<project> -var image=<region>-docker.pkg.dev/<project>/bordereau/app:<tag>
# build and push the image to the repository in the `image_repository` output, then:
gcloud run jobs execute bordereau-prepare-db --region europe-west2 --wait   # migrate + seed
gcloud secrets versions access latest --secret bordereau-demo-password     # the login
```

The first `apply` needs the Artifact Registry repository before the image exists: apply with `-target=google_artifact_registry_repository.app` first, push, then apply the rest.

## Known limits

- Claims are validated against every policy on file for the insurer, not only those sent up to the claim's month.
- An insurer's first month on file is taken as the opening position: movement checks start from its second month.
- One shared demo login; no users or permissions (a non-goal).
- The CRS v5.2 field list is provisional until confirmed against the LMG export.

## Update the demo

Commit changes, then run from the project root with Docker running:

```bash
IMAGE="europe-west2-docker.pkg.dev/bordereau-demo/bordereau/app:$(git rev-parse --short HEAD)"
gcloud auth configure-docker europe-west2-docker.pkg.dev
docker buildx build --platform linux/amd64 --tag "$IMAGE" --push .
terraform -chdir=infra plan -var project_id=bordereau-demo -var "image=$IMAGE" -out=tf.plan
terraform -chdir=infra apply tf.plan
```

Review the plan before applying. Terraform configures `GOOGLE_CLOUD_PROJECT`, Vertex AI access, and the Cloud Run image.

Do not run `bordereau-prepare-db` unless you want to reset the demo data. Test a fresh import and confirm **Proposed by Gemini**.
