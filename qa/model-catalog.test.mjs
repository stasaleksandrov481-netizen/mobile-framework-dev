import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = file => readFileSync(new URL(file, root), "utf8");

test("Android model picker and server catalog agree on every provider model", () => {
  const ui = read("app/src/main/assets/web/model.js");
  const provider = read("supabase/functions/cortex/provider.ts");
  const options = ui.split("const aiModels = [")[1]?.split("\n  ];")[0];
  assert.ok(options, "The user-visible model catalog must be defined");
  const ids = [...options.matchAll(/\{ id: "([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 22);
  assert.equal(new Set(ids).size, ids.length, "No duplicate models in the picker");
  const backend = provider.split("export const MODEL_PRICE_CEILINGS:")[1]?.split("\n};")[0];
  assert.ok(backend);
  const paid = new Set([...backend.matchAll(/"([a-z0-9._-]+\/[a-z0-9._-]+)": \{/g)].map(match => match[1]));
  assert.equal(paid.size, 17);
  for (const id of ids.filter(id => id !== "auto")) {
    assert.ok(id.endsWith(":free") || paid.has(id), `Not allowed on server: ${id}`);
  }
  const uiPaid = new Set([...options.matchAll(/\{ id: "([^"]+)",[^\n]*paid: true/g)].map(match => match[1]));
  assert.deepEqual(uiPaid, paid, "Every billed model must be labeled PRO in the picker");
});

test("selection goes to chat and native island without giving the client control of price", () => {
  const app = read("app/src/main/assets/web/app.js");
  const native = read("app/src/main/java/app/cortex/assistant/IslandAssistant.kt");
  const handler = read("supabase/functions/cortex/handler.ts");
  assert.match(app, /model_id: S\.preferences\.aiModel/);
  assert.match(app, /modelId: S\.preferences\.aiModel/);
  assert.match(native, /payload\.put\("model_id", modelId\)/);
  assert.match(handler, /MODEL_PRICE_CEILINGS\[model\]/);
  assert.doesNotMatch(app, /provider\.max_price|p_cost|p_input.*p_output/);
});
