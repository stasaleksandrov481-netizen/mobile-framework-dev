import test from "node:test";
import assert from "node:assert/strict";
import { ChatFlights, chatFlightKey } from "./singleflight.ts";

const simple = (query = "Что такое системный кэш?") => ({
  messages: [{ role: "user" as const, content: query }], limit: 1450,
  device: false, repair: false, plan: false, visual: false, webSearch: false,
});

test("only stateless generic prompts can share across accounts", () => {
  assert.deepEqual(chatFlightKey(simple(), "user-a", "guest"), chatFlightKey(simple(), "user-b", "guest"));
  assert.notDeepEqual(chatFlightKey({ ...simple(), messages: [
    { role: "system", content: "My private name is Alice" }, ...simple().messages,
  ] }, "user-a", "guest"), chatFlightKey({ ...simple(), messages: [
    { role: "system", content: "My private name is Alice" }, ...simple().messages,
  ] }, "user-b", "guest"));
  assert.notDeepEqual(chatFlightKey(simple(), "user-a", "pro"), chatFlightKey(simple(), "user-b", "pro"));
  assert.equal(chatFlightKey({ ...simple(), device: true }, "user-a", "guest"), null);
  assert.equal(chatFlightKey({ ...simple(), webSearch: true }, "user-a", "guest"), null);
  assert.equal(chatFlightKey(simple("Что такое моя подписка?"), "user-a", "guest")?.public, false);
  assert.equal(chatFlightKey(simple("Сколько сейчас стоит доллар?"), "user-a", "guest")?.public, false);
  assert.equal(chatFlightKey(simple("Что такое функция?"), "user-a", "guest")?.public, true);
  assert.notDeepEqual(chatFlightKey(simple("Что такое функция?"), "user-a", "guest"),
    chatFlightKey(simple("Что такое метод?"), "user-a", "guest"));
});

test("simultaneous followers receive text only, never another user's quota", async () => {
  const flights = new ChatFlights();
  const fingerprint = chatFlightKey(simple(), "a", "guest");
  assert.ok(fingerprint);
  let produceCalls = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const producer = async () => {
    produceCalls++;
    await ready;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"status":"quota","quota":{"id":"SECRET-USER-ID"}}\n\n'));
        setTimeout(() => {
          controller.enqueue(encoder.encode('data: {"delta":"Привет"}\n\ndata: [DONE]\n\n'));
          controller.close();
        }, 5);
      },
    }), { headers: { "content-type": "text/event-stream", "x-cortex-quota": "SECRET-USER-ID" } });
  };
  const first = flights.run(fingerprint, producer);
  const second = flights.run(fingerprint, producer);
  const third = flights.run(fingerprint, producer);
  release();
  const [leader, follower1, follower2] = await Promise.all([first, second, third]);
  assert.equal(produceCalls, 1);
  const [original, replay1, replay2] = await Promise.all([leader.text(), follower1.text(), follower2.text()]);
  assert.match(original, /SECRET-USER-ID/);
  for (const result of [replay1, replay2]) {
    assert.equal(result, 'data: {"delta":"Привет"}\n\ndata: [DONE]\n\n');
    assert.doesNotMatch(result, /SECRET|quota/i);
  }
  assert.equal(follower1.headers.has("x-cortex-quota"), false);
  assert.equal(follower2.headers.has("x-cortex-quota"), false);
});

test("private prompts never share across accounts, nor cache after completion", async () => {
  const flights = new ChatFlights();
  const personalized = { ...simple(), messages: [
    { role: "system" as const, content: "Personal preferences" }, ...simple().messages,
  ] };
  const left = chatFlightKey(personalized, "alice", "free");
  const right = chatFlightKey(personalized, "bob", "free");
  assert.ok(left && right);
  let count = 0;
  const produce = async () => {
    count++;
    return new Response('data: {"delta":"OK"}\n\ndata: [DONE]\n\n', {
      headers: { "content-type": "text/event-stream" },
    });
  };
  await Promise.all([(await flights.run(left, produce)).text(), (await flights.run(right, produce)).text()]);
  assert.equal(count, 2);
  await (await flights.run(left, produce)).text();
  assert.equal(count, 3);
});

test("upstream failure is not cached or silently transformed into success", async () => {
  const flights = new ChatFlights();
  const key = chatFlightKey(simple(), "a", "guest");
  let count = 0;
  const bad = async () => {
    count++;
    return new Response('data: {"delta":"Partial"}\n\ndata: {"error":"provider_limit"}\n\n', {
      headers: { "content-type": "text/event-stream" },
    });
  };
  await (await flights.run(key, bad)).text();
  await Promise.resolve();
  await (await flights.run(key, bad)).text();
  assert.equal(count, 2);
});
