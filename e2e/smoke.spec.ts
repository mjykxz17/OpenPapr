import { expect, test } from "@playwright/test";

test("login, home sections, mail, module detail", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("New since your last visit")).toBeVisible();
  await expect(page.getByText("Deadline moved", { exact: false })).toBeVisible();
  await expect(page.getByText(/overdue/i).first()).toBeVisible();
  await expect(page.getByText(/filtered/i)).toBeVisible();          // filtered-mail count link
  await expect(page.getByText(/Unaccounted/)).toBeVisible();        // honest weightage row
  await expect(page.getByText(/syllabus\*/).first()).toBeVisible(); // source label
  await page.getByText(/filtered/i).click();
  await expect(page).toHaveURL(/\/mail/);
  await page.goto("/modules/1");
  await expect(page.getByText(/manual/i).first()).toBeVisible();
});
