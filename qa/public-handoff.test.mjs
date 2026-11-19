import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("public release handoff remains mandatory for all runtime PRs", () => {
  const workflow = source(".github/workflows/agent-handoff.yml");
  assert.match(workflow, /source_changes and "docs\/PUBLIC_HANDOFF\.md" not in changed/);
  assert.match(workflow, /if any\(name\.startswith\("supabase\/functions\/cortex\/"\) for name in changed\)/);
  assert.match(workflow, /"docs\/RELEASE_INVENTORY\.md" not in changed/);
  assert.doesNotMatch(workflow, /source_changes and "docs\/AGENT_HANDOFF\.md"/);
});

test("public beta handoff describes version and verification without tester data", () => {
  const note = source("docs/PUBLIC_HANDOFF.md");
  assert.match(note, /1\.0\.18-beta\.10/);
  assert.match(note, /versionCode 127/);
  assert.match(note, /не опубликован/);
  assert.doesNotMatch(note, /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  assert.doesNotMatch(note, /(?:service_role|sk_live_|ghp_|-----BEGIN PRIVATE KEY-----)/);
});
