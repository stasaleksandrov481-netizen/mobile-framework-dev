import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../app/src/main/assets/web/", import.meta.url);
const content = file => readFileSync(new URL(file, root), "utf8");

function markdown() {
  const context = vm.createContext({ URL, window: {}, CortexIcons: name => `<svg data-cortex-icon="${name}"></svg>` });
  vm.runInContext(content("vendor/markdown-it-15.0.3.js"), context);
  context.window.markdownit = context.markdownit;
  vm.runInContext(content("icons.js").replace("const CortexIcons", "const OriginalCortexIcons"), context);
  vm.runInContext(content("markdown.js"), context);
  return text => vm.runInContext(`CortexMarkdown.render(${JSON.stringify(text)})`, context);
}

test("assistant Markdown renders useful inline SVG icons from a fixed whitelist", () => {
  const render = markdown();
  const result = render("Готово :icon[check]:. Сеть :icon[globe]:. Неизвестно :icon[untrusted]:.");
  assert.match(result, /class="markdown-inline-icon" role="img" aria-label="Готово"/);
  assert.match(result, /data-cortex-icon="check"/);
  assert.match(result, /data-cortex-icon="globe"/);
  assert.match(result, /:icon\[untrusted\]:/);
  assert.doesNotMatch(result, /data-cortex-icon="untrusted"/);
});

test("Markdown keeps callouts legible and does not execute arbitrary markup", () => {
  const render = markdown();
  const result = render("> [!TIP]\n> Могу запускать приложения и создавать напоминания.\n\n" +
    "> [!IMPORTANT] Проверьте доступ к уведомлениям.\n\n" +
    "```text\n:icon[check]:\n```\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))");
  assert.equal((result.match(/class="cortex-callout"/g) || []).length, 2);
  assert.match(result, /class="callout-title"/);
  assert.match(result, /Могу запускать приложения/);
  assert.match(result, /Проверьте доступ к уведомлениям/);
  assert.doesNotMatch(result, /<script>/);
  assert.doesNotMatch(result, /href="javascript:/);
  assert.match(result, /<code>:icon\[check\]:/);
});

test("assistant messages render without a bubble background or frame", () => {
  const css = content("style.css");
  assert.match(css, /Chat: the assistant writes on the canvas/);
  assert.match(css, /\.message\.assistant:not\(\.pending\) \.message-body\s*\{[^}]*border:\s*0;/s);
  assert.match(css, /\.markdown \.cortex-callout\s*\{[^}]*width:\s*100%/s);
  const provider = readFileSync(new URL("../supabase/functions/cortex/provider.ts", import.meta.url), "utf8");
  assert.match(provider, /Без Unicode-эмодзи/);
  assert.match(provider, /:face\[joy\]:/);
});

test("replies turn emoji graphemes and expressions into trusted Cortex faces", () => {
  const render = markdown();
  const markup = render("Готово ✅, думаю :face[think]:. Ура 👍🏻. В коде `😀`. Неизвестно :face[nope]:.");
  assert.match(markup, /data-emotion="done"/);
  assert.match(markup, /data-emotion="think"/);
  assert.match(markup, /data-emotion="joy"/);
  assert.doesNotMatch(markup, /✅|👍|🏻/u);
  assert.match(markup, /<code>😀<\/code>/u);
  assert.match(markup, /:face\[nope\]:/);
});
