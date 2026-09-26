// The demo script, end to end: onboard Insurer C from scratch, see the planted errors, import month 2
// on the saved mapping with the changed column flagged, then fail and pass verify.
import { expect, test, type Page } from "@playwright/test";

const C = "data/generated/C";

async function upload(page: Page, kind: "Policies" | "Claims", month: string, file: string) {
  await page.getByRole("link", { name: "Cobalt Travel Insurance" }).first().click();
  await page.locator("label", { hasText: kind }).click();
  await page.locator('input[name="month"]').fill(month);
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: "Upload" }).click();
}

test("onboard Insurer C, catch planted errors, reconcile month 2", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD ?? "demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Insurers" })).toBeVisible();

  // Month 1 policies: new insurer, so the whole mapping is proposed for review.
  await upload(page, "Policies", "2026-07", `${C}/policies_2026-07.csv`);
  await expect(page.getByRole("heading", { name: "Review mapping" })).toBeVisible();
  await expect(page.getByText("header on row 4")).toBeVisible();
  // Fix one suggestion: the reviewer maps and then un-maps a column, proving edits stick.
  const agt = page.getByLabel("Target for Agt");
  await agt.selectOption("product");
  await expect(page.getByText("Mapped from more than one column")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Approve and import" })).toBeDisabled();
  await agt.selectOption("");
  await page.getByRole("button", { name: "Approve and import" }).click();
  await expect(page.getByText("Rows in file")).toBeVisible();
  await expect(page.getByRole("link", { name: /^All 3$/ })).toBeVisible();

  // Click through to the source cell of an issue.
  await page.getByRole("link", { name: "View cell" }).first().click();
  await expect(page.locator("td.cell-hit")).toHaveCount(1);

  // Month 1 claims: Y/N closed flag, abbreviated headers.
  await upload(page, "Claims", "2026-07", `${C}/claims_2026-07.csv`);
  await expect(page.getByRole("heading", { name: "Review mapping" })).toBeVisible();
  await page.getByRole("button", { name: "Approve and import" }).click();
  await expect(page.getByRole("link", { name: /^All 5$/ })).toBeVisible();

  // Month 2 policies: columns reordered, same headers. Imports on the saved mapping, no review.
  await upload(page, "Policies", "2026-08", `${C}/policies_2026-08.csv`);
  await expect(page.getByText("Rows in file")).toBeVisible();
  await expect(page.getByText("mapping v1")).toBeVisible();

  // Month 2 claims: "Pd" became "Paid TD". Only that column needs a decision.
  await upload(page, "Claims", "2026-08", `${C}/claims_2026-08.csv`);
  await expect(page.getByText("Only the new column needs a decision")).toBeVisible();
  await expect(page.getByText("New column", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Pd", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve as v2 and import" }).click();
  await expect(page.getByText("mapping v2")).toBeVisible();

  // Report and verify: the planted movement break fails.
  await page.getByRole("link", { name: "Cobalt Travel Insurance" }).click();
  await expect(page.getByText(/first bordereau loaded .* after the insurer was created/)).toBeVisible();
  await page.getByRole("row", { name: /August 2026/ }).getByRole("link", { name: /Report and verify/ }).click();
  await expect(page.getByText("2 checks failed")).toBeVisible();
  await expect(page.locator(".check.fail pre").first()).toContainText("CC-1006");

  // The insurer's corrected resend replaces the month and verify passes.
  await upload(page, "Claims", "2026-08", `${C}/claims_2026-08.corrected.csv`);
  await expect(page.getByText("mapping v2")).toBeVisible();
  await page.getByRole("link", { name: "Cobalt Travel Insurance" }).click();
  await expect(page.getByText("Superseded")).toBeVisible();
  await page.getByRole("row", { name: /August 2026/ }).getByRole("link", { name: /Report and verify/ }).click();
  await expect(page.getByText("All checks pass")).toBeVisible();

  const csv = await page.request.get(page.url() + "/report?format=csv");
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("Total Incurred - Indemnity");
  const xlsx = await page.request.get(page.url() + "/report?format=xlsx");
  expect(xlsx.status()).toBe(200);
});

test("pages and downloads require the demo login", async ({ request }) => {
  const res = await request.get("/insurers/1/months/2026-07/report?format=csv", { maxRedirects: 0 });
  expect([302, 307, 401]).toContain(res.status());
});
