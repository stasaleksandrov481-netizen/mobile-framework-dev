import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const web = new URL("../app/src/main/assets/web/", import.meta.url);
const android = new URL("../app/src/main/java/app/cortex/assistant/", import.meta.url);
const source = name => readFileSync(new URL(name, web), "utf8");
const kotlin = name => readFileSync(new URL(name, android), "utf8");
const sandbox = vm.createContext({});
vm.runInContext(source("island-command.js"), sandbox);
const parse = (text, style, mode) => vm.runInContext("CortexIslandCommands", sandbox).parse(text, style, mode);

test("CORTEX changes island appearance locally with bounded direct commands", () => {
  const smaller = parse("Уменьши островок", { size: 100, widthScale: 100 }, "wake");
  assert.equal(smaller.style.size, 90);
  const width = parse("Кортекс, уменьши ширину островка до 85%", smaller.style);
  assert.equal(width.style.widthScale, 85);
  assert.equal(width.style.size, 90);
  const reset = parse("Верни стандартный островок", width.style);
  assert.equal(reset.style.size, 100);
  assert.equal(reset.style.widthScale, 100);
  const moved = parse("Сдвинь островок вправо", { offsetX: 72 });
  assert.equal(moved.style.offsetX, 75);
});

test("island widgets, transparency, colors, border and mode have explicit controls", () => {
  assert.equal(parse("Убери рамку островка").style.borderWidth, 0);
  assert.equal(parse("Выключи статус островка").style.status, false);
  assert.equal(parse("Включи прогресс на островке").style.progress, true);
  assert.equal(parse("Сделай островок прозрачнее", { opacity: 70 }).style.opacity, 55);
  assert.equal(parse("Сделай островок белым").style.background, "#e7e7e7");
  assert.equal(parse("Выключи островок", undefined, "wake").mode, "off");
  assert.equal(parse("Включи островок", undefined, "off").mode, "wake");
});

test("questions and unrelated commands cannot silently change the island", () => {
  for (const phrase of ["Как уменьшить островок?", "Как дела", "Удаляй файлы", "Что делает островок", "Сделай островок :icon[script]:"]) {
    assert.equal(parse(phrase), null, phrase);
  }
  assert.match(parse("Поставь размер островка на 200%").reply, /80% до 125%/);
});

test("island editor and background voice share native settings", () => {
  assert.match(source("screens.js"), /tile\("Оформление островка"[^\n]+island-editor/);
  assert.doesNotMatch(source("setup.js"), /<h2>Оформление островка<\/h2>/);
  assert.match(source("planner.js"), /routes = new Set\(\["schedule", "scenarios", "island-editor", "energy"\]\)/);
  assert.match(source("app.js"), /islandCommand\(text\)/);
  assert.doesNotMatch(source("app.js"), /memoryReply/);
  assert.match(source("app.js"), /sendDevice\("island-style-ack"\)/);
  assert.match(source("app.js"), /if \(!hidden\) \{\s*\/\/ Pick up voice-only island changes/);
  assert.match(kotlin("IslandAssistant.kt"), /IslandAppearanceCommands\.apply\(context, text\)/);
  assert.match(kotlin("CortexIslandBridge.kt"), /island-style-sync/);
  assert.match(kotlin("CortexIslandBridge.kt"), /"island-style-ack" -> prefs\.edit\(\)/);
});

test("navigation uses blurred translucent glass with outlined selected tabs", () => {
  const css = source("style.css");
  assert.match(css, /Single translucent dock/);
  assert.match(css, /\.navigation \.nav-indicator \{ display: none; \}/);
  assert.match(css, /\.navigation \.dock-tab\[aria-current\],[\s\S]*border-color: #ffffff76;/);
  assert.match(css, /backdrop-filter: blur\(22px\)/);
});
