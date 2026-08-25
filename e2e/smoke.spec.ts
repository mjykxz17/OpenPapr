import { expect, test } from "@playwright/test";

test("login, module grid, module detail, mail", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");

  // Home is now the draggable module grid — each tile is a link to its module.
  await expect(page.getByText("CS2103T").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /ST2334/ })).toHaveAttribute("href", "/modules/2");

  // The module detail page carries the weightage table and the manual-add form.
  await page.goto("/modules/2");
  await expect(page.getByText(/Components/i)).toBeVisible();
  await expect(page.getByText(/manual/i).first()).toBeVisible();

  // Reminders have their own tab; the seed carries an overdue deliverable.
  await page.goto("/reminders");
  await expect(page.getByRole("heading", { name: "Reminders" })).toBeVisible();
  await expect(page.getByText(/overdue/i).first()).toBeVisible();

  // Mail lives behind the rail now; its triaged content is on /mail.
  await page.goto("/mail");
  await expect(page.getByText(/filtered/i)).toBeVisible();
});
