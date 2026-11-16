import test from "node:test";
import assert from "node:assert/strict";
import { completion } from "./provider.ts";
import { visualFormat } from "./visual.ts";

test("Haiku 5.5 receives no incompatible sampling or disabled-thinking settings", async () => {
  let sent: Record<string, any> | null = null;
  const network = async (_url: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: "{}" } }] });
  };
  const response = await completion(network as typeof fetch, "test-paid-key", ["anthropic/claude-haiku-5.5"],
    [{ role: "user", content: "Нажми кнопку на экране" }], false, 740, new AbortController().signal,
    false, false, 12_000, true, false,
    async () => ({ maxOutput: 740, finish: async () => null }), { response_format: visualFormat }, 0.60);
  assert.equal(sent?.model, "anthropic/claude-haiku-5.5");
  assert.equal(sent?.max_tokens, 740);
  assert.equal(sent?.provider.max_price.prompt, 0.60);
  assert.equal(sent?.provider.max_price.completion, 0.60);
  assert.equal(sent?.provider.require_parameters, true);
  assert.equal(sent?.response_format.type, "json_schema");
  assert.equal(Object.hasOwn(sent!, "temperature"), false);
  assert.equal(Object.hasOwn(sent!, "top_p"), false);
  assert.equal(Object.hasOwn(sent!, "reasoning"), false);
  response.releaseDeadline();
  await response.finish();
});

test("free models keep bounded deterministic sampling and no paid price", async () => {
  let sent: Record<string, any> | null = null;
  const response = await completion(async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: "OK" } }] });
  }, "test-free-key", ["example/model:free"], [{ role: "user", content: "Привет" }],
  false, 740, new AbortController().signal, false, false, 12_000, true);
  assert.equal(sent?.temperature, 0.42);
  assert.equal(sent?.top_p, 0.9);
  assert.deepEqual(sent?.reasoning, { effort: "none", exclude: true });
  assert.equal(sent?.provider.max_price.completion, 0);
  response.releaseDeadline();
});
