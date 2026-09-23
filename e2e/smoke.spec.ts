import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

// Must match playwright.config.ts's webServer env.
const SECRET_KEY = "ab".repeat(32);

// Mints the same cookie /api/login issues. Signing in for real would require a
// live Canvas to validate the token against, which a smoke test should not
// depend on — the sign-in flow itself is covered by the rejection test below
// and by unit tests around resolveCanvasUser.
function session(userId: number): string {
  const payload = `${userId}.${Date.now() + 3_600_000}`;
  return `${payload}.${createHmac("sha256", Buffer.from(SECRET_KEY, "hex")).update(payload).digest("hex")}`;
}

test("anonymous visitors are sent to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  // Returning visitors are the common case, so username/password is the
  // default; the token fields live behind "First time".
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByLabel("Canvas access token")).toBeHidden();

  await page.getByRole("button", { name: "First time" }).click();
  await expect(page.getByLabel("Invite code")).toBeVisible();
  await expect(page.getByLabel("Canvas access token")).toBeVisible();
});

test("a wrong username or password is refused", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("nobody");
  await page.getByLabel("Password").fill("not-the-password");
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/wrong username or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("a wrong invite code is refused before Canvas is ever contacted", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "First time" }).click();
  await page.getByLabel("Username").fill("someone");
  await page.getByLabel("Password").fill("a-password");
  await page.getByLabel("Invite code").fill("not-the-code");
  await page.getByLabel("Canvas access token").fill("irrelevant");
  await page.locator('button[type="submit"]').click();
  // Not getByRole("alert") — Next renders its own empty route-announcer with
  // that role, and it wins the locator.
  await expect(page.getByText(/invite code is not valid/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("a session reaches the dashboard, modules, reminders and mail", async ({ page, context }) => {
  await context.addCookies([{ name: "session", value: session(1), url: "http://localhost:3777" }]);

  await page.goto("/");
  await expect(page).toHaveURL("/");
  await expect(page.getByText("CS2103T").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /ST2334/ })).toHaveAttribute("href", "/modules/2");

  await page.goto("/modules/2");
  await expect(page.getByRole("heading", { name: "Assessment" })).toBeVisible();
  // The manual-weightage form is folded into a disclosure now; assert the
  // control exists rather than the fields, which are collapsed by default.
  await expect(page.getByText(/^Add component$/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Materials" })).toBeVisible();
  // Not getByRole by name: the rail's "Study guides" link matches the same words.
  await expect(page.locator('main a[href="/modules/2/guide"]')).toContainText(/study guide/i);

  // The guide has its own page; the demo module has none yet, so it offers
  // to generate one and links back to the overview.
  await page.goto("/modules/2/guide");
  // Without an AI provider the button is replaced by a link to add a key.
  await expect(page.getByRole("button", { name: /generate study guide/i })
    .or(page.getByRole("link", { name: /add an ai key/i }))).toBeVisible();
  await expect(page.getByRole("link", { name: /overview/i })).toHaveAttribute("href", "/modules/2");

  await page.goto("/reminders");
  await expect(page.getByRole("heading", { name: "Reminders" })).toBeVisible();
  await expect(page.getByText(/overdue/i).first()).toBeVisible();

  await page.goto("/mail");
  await expect(page.getByText(/filtered/i)).toBeVisible();
});

test("an unsigned session cannot reach the dashboard", async ({ page, context }) => {
  await context.addCookies([{ name: "session", value: "1.9999999999999.deadbeef", url: "http://localhost:3777" }]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});
