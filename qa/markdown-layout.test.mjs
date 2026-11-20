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
  const model = content("model.js");
  assert.match(model, /Не используй эмодзи/);
  assert.match(model, /:icon\[имя\]:/);
});

test("the entire app uses compact spacing and the composer exposes an accessible quota ring", () => {
  const screens = content("screens.js");
  const app = content("app.js");
  const css = content("style.css");
  assert.match(screens, /class="quota-ring"[^>]*aria-label="Остаток токенов"/);
  assert.match(app, /quotaRing\.style\.setProperty\("--quota-fraction"/);
  assert.match(app, /quotaRing\.setAttribute\("aria-label", label/);
  assert.match(css, /\.quota-ring-art\s*\{[^}]*conic-gradient/s);
  for (const selector of [".section-header", ".profile-scroll", ".tile", ".switch-row", ".navigation button", ".chat-header"]) {
    assert.ok(css.includes(selector), `missing application-wide density rule: ${selector}`);
  }
  assert.match(css, /\.app-shell \.tile\s*\{[^}]*min-height:\s*51px/s);
  assert.match(css, /\.app-shell \.switch-row, \.app-shell \.access-row\s*\{[^}]*min-height:\s*52px/s);
});

test("rich metrics are rendered as safe accessible progress bars", () => {
  const render = markdown();
  const result = render('```cortex-metrics\n' + JSON.stringify({
    title: "Сжатие голосовых", rows: [
      { label: "Раньше, PCM", value: "48 КБ/с", percent: 100 },
      { label: "Теперь, ADPCM", value: "12 КБ/с", percent: 25, tone: "success" },
    ], note: "На 75% меньше данных",
  }) + '\n```');
  assert.match(result, /class="cortex-metrics"/);
  assert.match(result, /aria-valuenow="25"/);
  assert.match(result, /width:25%/);
  assert.match(result, /cortex-metric-note/);
});

test("metrics reject untrusted markup, impossible values and oversized content", () => {
  const render = markdown();
  const bad = [
    { title: '<img src=x onerror=alert(1)>', rows: [{ label: '<script>', value: 'a', percent: 80 }] },
    { title: "Test", rows: [{ label: "A", value: "B", percent: '100; background:url(https://x)' }] },
    { title: "Test", rows: [{ label: "A", value: "B", percent: 200 }] },
  ];
  const escaped = render('```cortex-metrics\n' + JSON.stringify(bad[0]) + '\n```');
  assert.doesNotMatch(escaped, /<script>|<img src=x/);
  assert.match(escaped, /&lt;script&gt;/);
  for (const entry of bad.slice(1)) {
    const result = render('```cortex-metrics\n' + JSON.stringify(entry) + '\n```');
    assert.doesNotMatch(result, /class="cortex-metrics"/);
    assert.match(result, /class="code-block"/);
  }
});

test("rich metric cards and timelines render only trusted fields", () => {
  const render = markdown();
  const cards = render('```cortex-cards\n' + JSON.stringify({ cards: [
    { title: "Экономия", value: "75%", note: '<img src=x onerror=alert(1)>', tone: "success" },
  ] }) + '\n```');
  assert.match(cards, /cortex-answer-cards/);
  assert.match(cards, /75%/);
  assert.match(cards, /&lt;img src=x/);
  assert.doesNotMatch(cards, /<img src=x/);
  const steps = render('```cortex-steps\n' + JSON.stringify({ steps: [
    { title: "Поиск", state: "done", detail: "Данные проверены" },
    { title: "Ответ", state: "active" },
  ] }) + '\n```');
  assert.match(steps, /cortex-answer-steps/);
  assert.match(steps, /class="done"/);
  assert.match(steps, /class="active"/);
  assert.doesNotMatch(render('```cortex-steps\n{"steps":[{"title":"a","state":"anything"}]}\n```'), /cortex-answer-steps/);
});

test("Markdown adds same-origin site icon to safe citation links only", () => {
  const result = markdown()('[OpenRouter](https://openrouter.ai/docs) [unsafe](javascript:alert(1))');
  assert.match(result, /src="\/favicons\/openrouter\.ai"/);
  assert.doesNotMatch(result, /\/favicons\/javascript/);
  assert.doesNotMatch(result, /href="javascript:/);
});

test("assistant links are clickable only when Android can open them (HTTPS)", () => {
  const render = markdown();
  const result = render("[safe](https://cortexapp.ru/help) [plain](http://example.com/) http://example.org/x");
  assert.match(result, /href="https:\/\/cortexapp\.ru\/help"/);
  assert.doesNotMatch(result, /href="http:\/\//);
  assert.match(result, /example\.com/);
});
