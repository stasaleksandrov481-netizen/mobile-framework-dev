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
