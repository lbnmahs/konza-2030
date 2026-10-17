import { expect, test } from "@playwright/test";

// The resident app is public and the panel is not. Signed out: /sia renders with the
// disclosure, a resident route without the session cookie is refused, and the panel's pages and
// APIs still need a panel user.
test("signed out: /sia is public, resident routes need a session, the panel stays closed", async ({ page, request, baseURL }) => {
  const sia = await page.goto("/sia");
  expect(sia?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/sia");
  await expect(page.getByText("Savannah is an AI assistant from an independent open-source project", { exact: false }).first())
    .toBeVisible();

  expect((await request.get("/api/resident/events?after=0")).status()).toBe(401);
  const act = await request.post("/api/resident/act", { headers: { origin: baseURL! }, data: {} });
  expect(act.status()).toBe(401);
  const foreign = await request.post("/api/resident/start", { headers: { origin: "https://elsewhere.example" } });
  expect(foreign.status()).toBe(403);

  const handset = await request.get("/handset", { maxRedirects: 0 });
  expect(handset.status()).toBe(307);
  expect(new URL(handset.headers().location, baseURL).pathname).toBe("/signin");
  expect((await request.post("/api/handset/start", { headers: { origin: baseURL! }, data: {} })).status()).toBe(401);
});
