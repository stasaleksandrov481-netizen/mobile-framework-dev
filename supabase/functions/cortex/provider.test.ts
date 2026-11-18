import test from "node:test";
import assert from "node:assert/strict";
import { deviceTools, planGuide } from "./device.ts";
import { chatInput, completion, relay, SELECTABLE_MODELS } from "./provider.ts";
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

test("web search is an explicit opt-in with bounded per-answer tool calls", async () => {
  const input = chatInput({ messages: [{ role: "user", content: "Какие новости сегодня?" }], web_search: true });
  assert.equal(input.webSearch, true);
  assert.equal(chatInput({ messages: [{ role: "user", content: "Привет" }] }).webSearch, false);
  assert.equal(chatInput({ messages: [{ role: "user", content: "Нажми" }], web_search: true, device_tools: true }).webSearch, false);
  let sent: any;
  const response = await completion(async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response('data: {"choices":[{"delta":{"tool_calls":[{"type":"openrouter:web_search"}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"Источники: [сайт](https://example.com)"}}]}\n\n' +
      'data: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
  }, "test-free-key", ["example/model:free"], [{ role: "user", content: "Новости" }], true,
    740, new AbortController().signal, false, false, 25000, true, false, undefined, undefined, undefined, true);
  assert.equal(sent.tools[0].type, "openrouter:web_search");
  assert.equal(sent.max_tool_calls, 3);
  assert.equal(sent.tools[0].parameters.max_results, 4);
  assert.equal(sent.provider.require_parameters, true);
  assert.ok(sent.provider.max_price.web_search > 0);
  const reader = relay(response, async () => undefined).getReader();
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    body += new TextDecoder().decode(value);
  }
  assert.match(body, /"status":"web_ready"/);
  assert.match(body, /"status":"web_search"/);
  assert.match(body, /https:\/\/example.com/);
});

test("OpenRouter search does not fabricate model tokens in the user's balance", async () => {
  let estimate = 0;
  let charged: { input: number; output: number } | null = null;
  const response = await completion(async () => new Response(
    'data: {"choices":[{"delta":{"content":"Готово"}}]}\n\n' +
    'data: {"usage":{"prompt_tokens":40,"completion_tokens":12,"server_tool_use":{"web_search_requests":2}}}\n\n' +
    'data: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }),
  "test-free-key", ["example/model:free"], [{ role: "user", content: "Найди" }], true,
  740, new AbortController().signal, false, false, 25000, true, false,
  async (input, output) => {
    estimate = input;
    return { maxOutput: output, async finish(usage) {
      charged = usage;
      return null;
    } };
  }, undefined, undefined, true);
  const reader = relay(response, async () => undefined).getReader();
  while (!(await reader.read()).done) { /* Drain the completed stream. */ }
  assert.ok(estimate > 0);
  assert.deepEqual(charged && { input: charged.input, output: charged.output }, { input: 40, output: 12 });
});

test("paid settlement prefers OpenRouter generation cost over estimates or streamed prices", async () => {
  let charged: { input: number; output: number; costMicros: number | null } | null = null;
  let metadataReads = 0;
  const response = await completion(async (url, init) => {
    if (String(url).includes("/api/v1/generation?")) {
      metadataReads++;
      assert.match(String(url), /gen-test-1234/);
      return Response.json({ data: { native_tokens_prompt: 77, native_tokens_completion: 21,
        total_cost: 0.003412 } });
    }
    const sent = JSON.parse(String(init?.body));
    assert.deepEqual(sent.provider.max_price, { prompt: 8, completion: 40,
      request: 0, image: 0, audio: 0, web_search: 0 });
    return new Response('data: {"id":"gen-test-1234","choices":[{"delta":{"content":"OK"}}]}\n\n' +
      'data: {"usage":{"prompt_tokens":70,"completion_tokens":20,"cost":0.0001}}\n\n' +
      'data: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
  }, "test-paid-key", ["anthropic/claude-fable-5.2"], [{ role: "user", content: "Привет" }], true,
    740, new AbortController().signal, false, false, 12_000, false, false,
    async (_input, output) => ({ maxOutput: output, finish: async (usage) => { charged = usage; return null; } }),
    undefined, { prompt: 8, completion: 40 });
  const reader = relay(response, async () => undefined).getReader();
  while (!(await reader.read()).done) { /* Drain stream and settle. */ }
  assert.equal(metadataReads, 1);
  assert.deepEqual(charged, { input: 77, output: 21, costMicros: 3412 });
});

test("explicit model IDs use an audited server-side allowlist", () => {
  const messages = [{ role: "user", content: "Привет" }];
  assert.equal(SELECTABLE_MODELS.size, 21);
  for (const model_id of SELECTABLE_MODELS) {
    assert.equal(chatInput({ messages, model_id }).modelId, model_id);
  }
  for (const model_id of ["example/unauthorized", "openai/gpt-6-luna:free", "x/evil;drop"])
    assert.throws(() => chatInput({ messages, model_id }));
});

test("Android browser, store, recents and rotation tools have bounded schemas", () => {
  const names = new Set(deviceTools.map(tool => tool.function.name));
  for (const name of ["open_web_page", "find_app_in_store", "show_recent_apps", "set_auto_rotate"]) {
    assert.ok(names.has(name), `${name} must be exposed to the assistant`);
  }
  const open = deviceTools.find(tool => tool.function.name === "open_web_page")!;
  assert.match(open.function.parameters.properties.target.pattern || "", /https/);
  assert.ok(open.function.parameters.additionalProperties === false);
  assert.match(planGuide, /open_web\(/);
  assert.match(planGuide, /rotate\(/);
});
