import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const web = readFileSync(new URL("../app/src/main/assets/web/app.js", import.meta.url), "utf8");
const native = readFileSync(new URL("../app/src/main/java/app/cortex/assistant/CortexDeviceBridge.kt", import.meta.url), "utf8");

// Exercise the shipped WebView function directly, with no DOM or Android emulator.
function exportSender(text, failAt = -1) {
  const begin = web.indexOf("  function sendChatExportChunk() {");
  const end = web.indexOf("\n  function exportChats()", begin);
  assert.ok(begin > -1 && end > begin, "export sender must be present in app.js");
  const received = [];
  const messages = [];
  const job = { id: "11111111-1111-4111-8111-111111111111", text, offset: 0, index: 0 };
  const context = vm.createContext({
    job,
    sendDevice(operation, data) {
      if (messages.length === failAt) return false;
      messages.push({ operation, data });
      if (operation === "export-chunk") received.push(data.text);
      return true;
    },
    flash(message) { messages.push({ operation: "flash", data: message }); },
  });
  vm.runInContext(`let activeChatExport = job;\n${web.slice(begin, end)}\nglobalThis.sendNext = sendChatExportChunk;`, context);
  return { context, received, messages, job };
}

test("Android JSON export streams large Unicode chats in ordered 64 Ki UTF-16 chunks", () => {
  // The surrogate pair straddles a naive 65,536-character boundary.
  const content = "Ж".repeat(65_535) + "📲" + "Э".repeat(2_200_000) + "\nконец";
  const sender = exportSender(content);
  for (let next = 0; next < 100; next++) {
    sender.context.sendNext();
    if (sender.messages.at(-1).operation === "export-end") break;
    const last = sender.messages.at(-1);
    assert.equal(last.operation, "export-chunk");
    assert.equal(last.data.index, next);
    assert.ok(last.data.text.length > 0 && last.data.text.length <= 65_536);
    const final = last.data.text.charCodeAt(last.data.text.length - 1);
    assert.ok(final < 0xD800 || final > 0xDBFF, "never cut a high surrogate at chunk end");
    const first = last.data.text.charCodeAt(0);
    assert.ok(first < 0xDC00 || first > 0xDFFF, "never start with a low surrogate");
  }
  assert.equal(sender.messages.at(-1).operation, "export-end");
  assert.equal(sender.messages.at(-1).data.id, sender.job.id);
  assert.equal(sender.received.join(""), content);
});

test("a failed native chunk send interrupts export rather than confirming success", () => {
  const sender = exportSender("x".repeat(70_000), 1);
  sender.context.sendNext();
  sender.context.sendNext();
  assert.deepEqual(sender.messages.map(item => item.operation), ["export-chunk", "flash"]);
  assert.match(sender.messages.at(-1).data, /Не удалось передать часть истории/);
  assert.equal(vm.runInContext("activeChatExport", sender.context), null);
});

test("the Android bridge saves actual JSON and validates streamed size and ordering", () => {
  assert.match(native, /"export-begin"\s*->/);
  assert.match(native, /"export-chunk"\s*->/);
  assert.match(native, /"export-end"\s*->/);
  assert.match(native, /session\.writtenChars \+ chunk\.length > session\.expectedChars/);
  assert.match(native, /next != session\.nextChunk/);
  assert.match(native, /session\.writtenChars != session\.expectedChars/);
  assert.match(native, /type = "application\/json"/);
  assert.match(native, /cortex-chats\.json/);
  assert.doesNotMatch(native, /pendingExport\s*=\s*body\.optString\("text"\)\.take/);
  assert.match(web, /chunkedChatExport = message\.chunkedChatExport === true/);
  assert.match(web, /Для экспорта большой истории обновите CORTEX/);
});
