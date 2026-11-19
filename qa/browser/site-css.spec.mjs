import { expect, test } from "@playwright/test";

// The live incident rendered unstyled HTML in an Android in-app browser.
// Simulate a CDN/embedded-browser stylesheet failure while keeping JS enabled.
for (const width of [320, 393, 768, 1280]) {
  test(`registration remains readable with blocked CSS at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width < 500 ? 720 : 900 });
    await page.route(/\/_next\/static\/.*\.css(?:\?.*)?$/, route => route.abort("failed"));
    await page.goto("/register", { waitUntil: "domcontentloaded" });

    const style = page.locator("#cortex-critical-styles");
    await expect(style).toHaveCount(1);
    await expect(page.locator(".auth-form-area h1")).toBeVisible();
    await expect(page.locator(".registration-form")).toBeVisible();

    const layout = await page.evaluate(() => {
      const page = document.querySelector(".auth-page");
      const form = document.querySelector(".auth-form-area");
      const box = form.getBoundingClientRect();
      return {
        background: getComputedStyle(page).backgroundColor,
        display: getComputedStyle(page).display,
        font: getComputedStyle(document.body).fontFamily,
        formLeft: box.left,
        formRight: box.right,
        documentWidth: document.documentElement.scrollWidth,
        windowWidth: innerWidth,
      };
    });
    expect(layout.background).toBe("rgb(8, 8, 8)");
    expect(layout.display).toBe("grid");
    expect(layout.font).not.toMatch(/Times New Roman/i);
    expect(layout.formLeft).toBeGreaterThanOrEqual(0);
    expect(layout.formRight).toBeLessThanOrEqual(width + 1);
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.windowWidth + 1);

    // Hydration must still provide working local interactions despite lost CSS.
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page.getByRole("heading", { name: "С возвращением." })).toBeVisible();
    await page.getByLabel("Электронная почта").fill("tester@example.invalid");
    await expect(page.getByLabel("Электронная почта")).toHaveValue("tester@example.invalid");

    await page.screenshot({ path: testInfo.outputPath(`auth-css-fallback-${width}.png`), fullPage: true });
  });
}

test("landing page retains readable layout without external CSS", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.route(/\/_next\/static\/.*\.css(?:\?.*)?$/, route => route.abort("failed"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#cortex-critical-styles")).toHaveCount(1);
  await expect(page.locator(".hero h1")).toBeVisible();
  const bodyStyle = await page.locator("body").evaluate(body => getComputedStyle(body).backgroundColor);
  expect(bodyStyle).toBe("rgb(5, 5, 5)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(394);
});

for (const pathname of ["/questions", "/support", "/privacy", "/pricing"]) {
  test(`information page ${pathname} remains readable without external CSS`, async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.route(/\/_next\/static\/.*\.css(?:\?.*)?$/, route => route.abort("failed"));
    await page.goto(pathname, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#cortex-critical-styles")).toHaveCount(1);
    const main = page.locator(".legal-page");
    await expect(main.locator("h1")).toBeVisible();
    expect(await main.evaluate(element => getComputedStyle(element).fontFamily)).not.toMatch(/Times New Roman/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(394);
    if (pathname === "/questions") await expect(page.locator('a[href*="github.com"]')).toHaveCount(0);
  });
}
