import { defineConfig } from "@playwright/test";

const PORT = 3100;
// Set E2E_BASE_URL (and E2E_PASSWORD) to run against a deployed instance instead of a local server.
// That run changes the deployment's data; reset it afterwards with the prepare-db job.
const remote = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  // First visits to a page compile it under `next dev`; give assertions room for that.
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"]],
  use: { baseURL: remote ?? `http://localhost:${PORT}`, trace: "retain-on-failure" },
  globalSetup: remote ? undefined : "./e2e/global-setup.ts",
  webServer: remote ? undefined : {
    // CI runs against a production build; locally, dev is fine.
    command: process.env.CI ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Deterministic: header-matching suggestions, not the model.
    env: { GOOGLE_CLOUD_PROJECT: "", DEMO_PASSWORD: "demo", SESSION_SECRET: "e2e-secret" },
  },
});
