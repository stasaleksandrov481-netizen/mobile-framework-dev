// Local design review helper: captures every main route of the WebView UI.
// Usage: node shots.mjs <outDir> [routes...]   (server on 127.0.0.1:3124 must be running)
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

const out = process.argv[2] || "shots";
const routes = process.argv.slice(3).length ? process.argv.slice(3) : [
  "splash", "home", "chats", "chat/chat-qa", "phone-tools", "scenarios", "profile", "settings",
  "permissions", "memory", "support", "about", "account-signin"
];
mkdirSync(out, { recursive: true });
const showcase = readFileSync(new URL("../fixtures/markdown-showcase.md", import.meta.url), "utf8");

const browser = await chromium.launch();
for (const route of routes) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
  const signedOut = route === "account-signin";
  await page.addInitScript(({ md, signedOut }) => {
    window.__nativeRequests = [];
    window.CortexDevice = { postMessage(raw) { window.__nativeRequests.push(JSON.parse(raw)); } };
    window.CortexIslandControl = { postMessage(raw) { window.__nativeRequests.push(JSON.parse(raw)); } };
    localStorage.setItem("cortex:onboarding:v4", "done");
    localStorage.setItem("cortex.interface.v2", JSON.stringify({
      ...(signedOut ? {} : { account: { id: "qa-local", name: "Алексей", provider: "Email", email: "qa@example.invalid" } }),
      preferences: { reduceMotion: true, energy: "balanced" },
      chats: [
        { id: "chat-qa", saved: true, title: "Возможности Markdown", updated: "2026-11-20T10:00:00.000Z",
          messages: [{ role: "user", text: "покажи все твои способности с markdown" }, { role: "assistant", text: md }] },
        { id: "chat-2", saved: true, title: "Будильник на завтра", updated: "2026-11-19T21:00:00.000Z",
          messages: [{ role: "user", text: "поставь будильник на 7:30" }, { role: "assistant", text: "Готово: будильник на **7:30**." }] }
      ]
    }));
  }, { md: showcase, signedOut });
  const hash = route === "splash" ? "" : route === "account-signin" ? "#account" : "#" + route;
  await page.goto("http://127.0.0.1:3124/index.html" + hash);
  if (route === "splash") await page.waitForTimeout(400);
  else {
    await page.waitForFunction(() => document.getElementById("splash")?.hidden, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.screenshot({ path: `${out}/${route.replace(/\//g, "_")}.png` });
  await page.close();
}
await browser.close();
console.log("done", routes.length);
