import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const kotlin = name => readFileSync(
  new URL(`../app/src/main/java/app/cortex/assistant/${name}.kt`, import.meta.url), "utf8");

test("accessibility feedback interruptions cannot silently cancel multi-step automation", () => {
  const screen = kotlin("CortexScreenService");
  const interrupt = screen.split("override fun onInterrupt()")[1].split("override fun onDestroy()")[0];
  assert.doesNotMatch(interrupt, /CortexActionState\.stop\(/);
  assert.match(screen, /override fun onInterrupt\(\) = Unit/);
  assert.match(screen, /override fun onDestroy\(\) \{[\s\S]*?CortexActionState\.stop\(\)/);
  assert.match(kotlin("CortexActionState"), /fun stop\(\) \{ cancel\?\.invoke\(\) \}/);
});

test("multi-step planning bounds provider calls and retains confirmed progress", () => {
  const engine = kotlin("CortexActionEngine");
  const plan = engine.split("private suspend fun plan(")[1]?.split("private fun manual()")[0];
  assert.ok(plan, "visual planner must be present");
  assert.match(plan, /val planTimeout = 22_000L/);
  assert.match(plan, /withTimeoutOrNull<JSONObject>\(planTimeout\)/);
  assert.doesNotMatch(plan, /for \(attempt in/);
  assert.match(plan, /"daily_limit" -> "Суточный лимит/);
  assert.match(plan, /"provider_budget", "provider_balance"/);
  assert.match(plan, /JSONArray\(task\.verified\)/);
  assert.match(engine, /preserve = task\.completed > 0 \|\| task\.queue\.isNotEmpty\(\) \|\| task\.plans > 0/);
  assert.match(engine, /task\.verified\.addLast\(/);
  assert.match(engine, /if \(!task\.progress\.accept\(signature\)\)/);
  assert.match(engine, /private const val TASK_TIMEOUT_MS = 1_800_000L/);
});
