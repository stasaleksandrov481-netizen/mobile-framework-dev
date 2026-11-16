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

test("multi-step planning retries only transient errors and retains confirmed progress", () => {
  const engine = kotlin("CortexActionEngine");
  assert.match(engine, /for \(attempt in 0\.\.1\) \{/);
  assert.match(engine, /result == null \|\| result\.optString\("error"\) in RETRYABLE_PLAN_ERRORS/);
  assert.match(engine, /setOf\("offline", "timeout", "server", "server_busy"\)/);
  assert.doesNotMatch(engine, /RETRYABLE_PLAN_ERRORS = setOf\([^\n]*(?:daily_limit|provider_budget|sign_in)/);
  assert.match(engine, /preserve = task\.completed > 0 \|\| task\.queue\.isNotEmpty\(\) \|\| task\.plans > 0/);
  assert.match(engine, /task\.verified\.addLast\(/);
  assert.match(engine, /if \(!task\.progress\.accept\(signature\)\)/);
  assert.match(engine, /private const val TASK_TIMEOUT_MS = 1_800_000L/);
});
