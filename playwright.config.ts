import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  // First visits to a page compile it under `next dev`; give assertions room for that.
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    // CI runs against a production build; locally, dev is fine.
    command: process.env.CI ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Deterministic: header-matching suggestions, not the model.
    env: { ANTHROPIC_API_KEY: "", DEMO_PASSWORD: "demo", SESSION_SECRET: "e2e-secret" },
  },
});
