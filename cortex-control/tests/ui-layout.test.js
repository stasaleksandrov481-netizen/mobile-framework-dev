import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");

test("support desk keeps the existing authenticated workflow and a bounded conversation", () => {
  assert.match(app, /async function support\(\)/);
  assert.match(app, /class="support-workspace"/);
  assert.match(app, /class="support-layout"/);
  assert.match(app, /class="conversation-panel"/);
  assert.match(app, /class="ticket-messages"/);
  assert.match(app, /class="conversation-actions"/);
  assert.match(app, /form\("reply"/);
  assert.match(app, /form\("ticket-status"/);
  assert.match(app, /escape\(current\.message\)/);
  assert.match(app, /escape\(reply\.message\)/);
  assert.match(css, /\.conversation-panel\s*\{[^}]*min-height:/);
  assert.match(css, /\.ticket-messages\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.ticket-list\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.ticket-item\[aria-current="true"\]/);
});

test("admin pages share compact responsive grids and accessible mobile navigation", () => {
  assert.match(app, /const pageDescriptions\s*=/);
  for (const key of ["overview", "site", "support", "updates", "maintenance", "beta", "roles", "quota", "billing", "audit"]) {
    assert.match(app, new RegExp("\\b" + key + ":"));
  }
  assert.match(app, /class="page-description"/);
  assert.match(app, /class="settings-grid"/);
  assert.match(app, /aria-current="page"/);
  assert.match(css, /\.metrics-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4/);
  assert.match(css, /@media\s*\(max-width:\s*700px\)/);
  assert.match(css, /\.layout > aside\s*\{\s*display:\s*none/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});
