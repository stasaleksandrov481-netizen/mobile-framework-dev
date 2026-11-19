import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("website metrics have their own role-restricted navigation page", () => {
  assert.match(client, /overview: "Обзор", site: "Сайт"/);
  assert.match(client, /role === "admin"\) return \["overview", "site"/);
  assert.match(client, /const views = \{ overview, site, support/);
});

test("website metrics come from authenticated aggregate RPC, not invented site traffic", () => {
  assert.match(client, /db\.rpc\("cortex_admin_site_metrics"\)/);
  assert.match(client, /Счётчик уникальных посетителей пока не подключён/);
  assert.doesNotMatch(client, /\.from\("cortex_preregistrations"\)/);
});
