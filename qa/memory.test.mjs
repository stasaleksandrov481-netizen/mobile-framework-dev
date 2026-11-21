import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app/src/main/assets/web/model.js", import.meta.url), "utf8");
function model() {
  const memory = new Map();
  const storage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: key => memory.delete(key),
  };
  const start = () => {
    const context = { localStorage: storage, Date, Math, crypto: globalThis.crypto, console };
    vm.runInNewContext(source + "\nglobalThis.CortexTest = Cortex;", context);
    return context.CortexTest;
  };
  return { start, memory };
}

test("facts survive restart, but never carry to another account", () => {
  const fixture = model();
  let cortex = fixture.start();
  assert.equal(cortex.memoryCommand("запомни что я предпочитаю короткие ответы"), "Запомнил. Этот факт можно удалить в разделе «Память».");
  assert.equal(cortex.learnFromUser("Меня зовут Константин"), true);
  cortex.save();
  cortex = fixture.start();
  assert.equal(cortex.memory().entries.length, 2);
  cortex.useAccount({ id: "account-A", provider: "Email", email: "a@example.test" });
  cortex.save();
  cortex.useAccount({ id: "account-B", provider: "Email", email: "b@example.test" });
  assert.equal(cortex.memory().entries.length, 0);
  cortex.useAccount({ id: "account-A", provider: "Email", email: "a@example.test" });
  assert.equal(cortex.memory().entries.length, 2);
  assert.match(cortex.memoryCommand("что ты обо мне помнишь"), /Константин/);
});

test("credentials are rejected and memory can be deleted without calling AI", () => {
  const cortex = model().start();
  assert.match(cortex.memoryCommand("запомни что мой пароль secret123"), /Не сохранил/);
  assert.equal(cortex.learnFromUser("Меня зовут admin@example.test"), false);
  assert.equal(cortex.memory().entries.length, 0);
  assert.equal(cortex.learnFromUser("Я люблю минимализм"), true);
  assert.equal(cortex.memory().entries.length, 1);
  assert.match(cortex.memoryCommand("забудь всё"), /Удалил/);
  assert.equal(cortex.memory().entries.length, 0);
});

test("sensitive local notification answers never persist or enter model context", () => {
  const fixture = model();
  const cortex = fixture.start();
  const chat = cortex.createChat(true);
  chat.saved = true;
  chat.messages.push(
    { role: "user", text: "Что написали?", local: true, ephemeral: true },
    { role: "assistant", text: "PERSONAL_NOTIFICATION_TEXT", local: true, ephemeral: true },
    { role: "user", text: "Привет" },
    { role: "assistant", text: "Здравствуйте" }
  );
  assert.ok(cortex.save());
  const serialized = fixture.memory.get("cortex.interface.v2");
  assert.doesNotMatch(serialized, /PERSONAL_NOTIFICATION_TEXT|Что написали/);
  assert.match(serialized, /Здравствуйте/);
  assert.doesNotMatch(JSON.stringify(cortex.turns(chat, "")), /PERSONAL_NOTIFICATION_TEXT/);
  const restarted = fixture.start();
  assert.equal(restarted.state.chats[0].messages.length, 2);
});

test("a long answer keeps the previous exchange in the follow-up context", () => {
  const cortex = model().start();
  const chat = cortex.createChat();
  const append = (role, text) => chat.messages.push({ role, text });
  append("user", "Назовём план «Вектор».");
  append("assistant", "Начало плана «Вектор». " + "Подробность. ".repeat(1_400) + " Итог: два этапа.");
  append("user", "Какой у него первый этап?");
  const turns = cortex.turns(chat, "Данные Android");
  assert.equal(turns.at(-3)?.content, "Назовём план «Вектор».");
  assert.match(turns.at(-2)?.content, /^Начало плана «Вектор»[\s\S]+Итог: два этапа\.$/);
  assert.equal(turns.at(-1)?.content, "Какой у него первый этап?");
  assert.ok(turns.reduce((length, turn) => length + turn.content.length, 0) <= 12_000);
});

test("a follow-up after a local exchange never enters public question sharing", () => {
  const cortex = model().start();
  const chat = cortex.createChat();
  const text = "Почему батарея так быстро садится?";
  chat.messages.push({ role: "user", text: "Сколько заряда", local: true }, { role: "assistant", text: "Заряд 50%", local: true }, { role: "user", text });
  assert.equal(cortex.canSharePublicQuestion(chat, text), false);
  assert.doesNotMatch(JSON.stringify(cortex.turns(chat, "")), /Заряд 50%/);
});
