import { defineConfig } from "@playwright/test";

// K8 S5 (MED-334): the accessibility suite and the access check, local only. It drives the
// installed Chrome (no browser download) against the dev server: the dev-only preview /dev/cards
// shows every card state from the spec's example events, so nothing needs a sign-in, a session or
// credits. Run: npm run test:a11y.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 2,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", channel: "chrome" },
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100/dev/cards?screen=home&theme=light",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
