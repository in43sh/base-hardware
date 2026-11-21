import { test, expect, type Page } from "@playwright/test";

// Backlog item "Admin edits rewrite product URLs": saving a product used to
// regenerate its slug from the title, which turned /product/foo-3 into
// /product/foo. The test edits only the stock of the first catalog product and
// restores it afterwards, so it leaves the seeded data as it found it.

async function signInAsAdmin(page: Page) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill("admin@homebuzz.test");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);
}

async function setStock(page: Page, title: string, stock: string) {
  await page.goto("/admin/products");
  await page
    .getByRole("row")
    .filter({ hasText: title })
    .getByRole("link", { name: "Edit" })
    .click();
  await page.getByLabel("Stock").fill(stock);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/products$/);
}

test("editing only the stock keeps the product URL", async ({ page }) => {
  await page.goto("/store");
  const card = page.locator("article").first();
  const title = (await card.getByRole("img").getAttribute("alt")) ?? "";
  const href = await card.getByRole("link").first().getAttribute("href");
  expect(title).not.toBe("");
  expect(href).toMatch(/^\/product\//);

  await signInAsAdmin(page);
  try {
    await setStock(page, title, "77");

    await page.goto(href!);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
  } finally {
    // Restore the seeded stock even when an assertion above fails.
    await setStock(page, title, "100");
  }
});
