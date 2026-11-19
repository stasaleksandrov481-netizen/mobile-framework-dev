import { test, expect } from "@playwright/test";

const sizes = [{ width: 393, height: 852 }, { width: 360, height: 640 }, { width: 320, height: 568 }, { width: 844, height: 390 }];

async function boot(page) {
  await page.addInitScript(() => {
    localStorage.setItem("cortex:onboarding:v4", "done");
    localStorage.setItem("cortex.interface.v2", JSON.stringify({
      account: { id: "qa-local", name: "Тест", provider: "Email", email: "qa@example.invalid" },
      preferences: { reduceMotion: true, energy: "balanced" }
    }));
    // Fixture only: exercises actual WebView assets, not a real Android controller.
    window.__nativeRequests = [];
    window.CortexDevice = { postMessage(raw) { window.__nativeRequests.push(JSON.parse(raw)); } };
    window.CortexIslandControl = { postMessage(raw) { window.__nativeRequests.push(JSON.parse(raw)); } };
  });
  await page.goto("/");
  await page.waitForFunction(() => window.CortexFirstExperience && document.getElementById("splash").hidden);
}

async function nativeState(page, extra = {}) {
  await page.evaluate(extra => window.dispatchEvent(new MessageEvent("cortex-native", { data: JSON.stringify({
    type: "first-experience", phase: "offer", session: "qa-session", active: false, ready: true,
    accessibility: true, overlay: true, brightnessPermission: false, notices: [], ...extra
  }) })), extra);
}

for (const viewport of sizes) {
  test(`real WebView pages fit ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await boot(page);
    const phases = [
      ["offer", {}], ["number", { phase: "number", active: true }], ["sealed", { phase: "sealed", active: true }],
      ["reveal", { phase: "reveal", predictionDone: true }],
      ["finish", { phase: "finish", exampleDone: true, brightnessDone: true, predictionDone: true }],
      ["stopped", { phase: "stopped", recoveryNeeded: true, message: "Нужно восстановить яркость. Разрешите изменение системных настроек." }]
    ];
    for (const [name, extra] of phases) {
      await nativeState(page, extra);
      if (name === "number") {
        await page.locator("#experience-number").fill("17");
        await nativeState(page, extra);
        await expect(page.locator("#experience-number")).toHaveValue("17");
      }
      const layout = await page.locator(".cortex-experience").evaluate(el => ({
        width: el.scrollWidth,
        buttons: [...el.querySelectorAll(".experience-actions button")].map(button => button.getBoundingClientRect().toJSON())
      }));
      expect(layout.width, name).toBeLessThanOrEqual(viewport.width);
      for (const rect of layout.buttons) {
        expect(rect.y, name).toBeGreaterThanOrEqual(0);
        expect(rect.bottom, name).toBeLessThanOrEqual(viewport.height + 1);
      }
      await page.screenshot({ path: info.outputPath(`${name}-${viewport.width}x${viewport.height}.png`), animations: "disabled" });
    }
    await nativeState(page, { phase: "idle" });
    await page.evaluate(() => { location.hash = "settings"; });
    await page.getByText("Повторить знакомство с CORTEX", { exact: true }).click();
    expect(await page.evaluate(() => window.__nativeRequests.some(x => x.operation === "first-experience-offer"))).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("Show and number entry send native commands without faking any calculator result", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await boot(page);
  await nativeState(page);
  await page.getByRole("button", { name: "Показать", exact: true }).click();
  await expect(page.getByRole("button", { name: "Показать", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__nativeRequests.filter(x => x.operation === "first-experience-start").length)).toBe(1);
  await expect(page.locator(".experience-card")).toHaveCount(0);
  await nativeState(page, { phase: "number", active: true });
  const input = page.locator("#experience-number");
  await input.fill("0");
  await expect(page.getByRole("button", { name: "Продолжить", exact: true })).toBeDisabled();
  await input.fill("99");
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  expect(await page.evaluate(() => window.__nativeRequests.find(x => x.operation === "first-experience-number")?.number)).toBe("99");
  await nativeState(page, { phase: "sealed", active: true });
  await expect(page.locator(".experience-card strong")).toHaveText("?");
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
  expect(await page.evaluate(() => window.__nativeRequests.at(-1).operation)).toBe("first-experience-stop");
  await expect(page.locator(".experience-card strong")).toHaveText("?");
});
