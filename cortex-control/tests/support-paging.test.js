import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUPPORT_PAGE_SIZE, supportPageBounds } from "../support-paging.js";

const client = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("support records paginate without a hard 100-ticket ceiling", () => {
  assert.equal(SUPPORT_PAGE_SIZE, 25);
  assert.match(client, /count: "exact"/);
  assert.match(client, /\.range\(offset, offset \+ SUPPORT_PAGE_SIZE - 1\)/);
  assert.doesNotMatch(client, /\.limit\(100\)/);
});

test("pagination covers all rows and clamps stale page selections", () => {
  assert.deepEqual(supportPageBounds(0, 10), { page: 0, pages: 1, offset: 0, end: 0 });
  assert.deepEqual(supportPageBounds(26, 0), { page: 0, pages: 2, offset: 0, end: 25 });
  assert.deepEqual(supportPageBounds(26, 1), { page: 1, pages: 2, offset: 25, end: 26 });
  assert.deepEqual(supportPageBounds(26, 999), { page: 1, pages: 2, offset: 25, end: 26 });
  assert.deepEqual(supportPageBounds(26, -7), { page: 0, pages: 2, offset: 0, end: 25 });
  assert.deepEqual(supportPageBounds(NaN, 1), { page: 0, pages: 1, offset: 0, end: 0 });
});

test("admin overview refreshes visibly without unnecessarily refreshing forms", () => {
  assert.match(client, /tab === "overview" && !signingOut/);
  assert.match(client, /document\.hidden/);
  assert.match(client, /Автообновление раз в минуту/);
});

test("administrative role, plan and funding changes require confirmation", () => {
  assert.match(client, /Изменить административную роль/);
  assert.match(client, /Изменить тариф/);
  assert.match(client, /Изменить бюджет ИИ/);
});
